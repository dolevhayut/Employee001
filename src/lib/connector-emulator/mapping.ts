// CompanySim records projected into what each connector would hold. Pure and
// deterministic: the same world always gives the same mailboxes, Slack
// history, Jira issues and files, with the same ids.
//
//   Slack      channels -> channels (members: the channel's team plus everyone
//              who wrote or took part in its conversations); messages -> channel
//              messages; messages of one conversation about one project in one
//              week form a thread, the earliest is its parent.
//   Email      CompanySim has no email entity, so threads are derived (see
//              ticketThread, renewalThread, documentShare): a customer contact
//              writes in about each ticket and the assignee answers according
//              to the ticket's status; the account owner hears from a contact
//              ahead of each renewal; authors mail project documents to the
//              project owner. Gmail and Outlook show the same mailbox.
//   Jira       projects -> Jira projects (key from the name's initials);
//              tickets -> issues, numbered by creation date within a project.
//   Drive /    documents -> files: company-visible ones for everyone, private
//   SharePoint ones for their author only.
//   Teams      teams -> Microsoft Teams teams; a team's channels -> its Teams
//              channels next to "General".

import {
  driveFileId, gmailId, guid, hash, outlookConversationId, outlookId,
  slackChannelId, slackTeamId, slackTs, slackUserId, teamsChannelId,
} from "./ids";
import { str, type Row, type World } from "./world";

export type Person = {
  id: string; name: string; first: string; last: string; email: string;
  role: string; teamId: string; team: string; department: string; managerId?: string;
};
export type Addr = { name: string; email: string; personId?: string };
export type Mail = {
  id: string; threadId: string; outlookId: string; conversationId: string;
  from: Addr; to: Addr[]; cc: Addr[]; subject: string; body: string; at: number;
  source: { kind: "ticket" | "renewal" | "document"; id: string };
};
export type MailboxEntry = Mail & { labels: string[] };
export type SlackChannel = {
  id: string; csId: string; name: string; isPrivate: boolean; created: number;
  teamId: string; members: Set<string>;
};
export type SlackMessage = {
  csId: string; channelId: string; ts: string; threadTs?: string; personId: string;
  user: string; text: string; at: number; replies: SlackMessage[];
};
export type JiraProject = { id: string; key: string; name: string; csId: string; leadPersonId: string; customerName: string };
export type JiraIssue = {
  id: string; key: string; project: JiraProject; csId: string; summary: string; description: string;
  status: string; statusCategory: "new" | "indeterminate" | "done"; priority: string;
  assigneeId?: string; created: number; updated: number; customerName: string; labels: string[];
};
export type DriveFile = {
  id: string; csId: string; title: string; name: string; mimeType: string; body: string;
  authorId: string; created: number; modified: number; visibility: string; project: string; customer: string;
};
export type MsChannel = { id: string; name: string; csChannelId?: string };
export type MsTeam = { id: string; csTeamId: string; name: string; description: string; members: Set<string>; channels: MsChannel[] };

export type Index = {
  domain: string;
  companyName: string;
  slackTeamId: string;
  people: Map<string, Person>;
  peopleBySlack: Map<string, Person>;
  mail: Mail[];
  threads: Map<string, Mail[]>;
  channels: SlackChannel[];
  slackMessages: SlackMessage[]; // top-level messages; replies hang off them
  jiraProjects: JiraProject[];
  issues: JiraIssue[];
  files: DriveFile[];
  teams: MsTeam[];
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const time = (v: unknown) => Date.parse(str(v)) || 0;
const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Stable pick: the same key always selects the same element. */
const pick = <T>(items: T[], key: string): T | undefined =>
  items.length ? items[parseInt(hash(`pick:${key}`, 8), 16) % items.length] : undefined;

function people(world: World): Map<string, Person> {
  const name = (rows: Row[], id: unknown) => str(rows.find((r) => r.id === id)?.name) || str(rows.find((r) => r.id === id)?.title);
  const out = new Map<string, Person>();
  for (const p of world.people) {
    out.set(p.id, {
      id: p.id,
      name: str(p.displayName),
      first: str(p.firstName),
      last: str(p.lastName),
      email: str(p.email),
      role: name(world.roles, p.currentRoleId),
      teamId: str(p.currentTeamId),
      team: name(world.teams, p.currentTeamId),
      department: name(world.departments, p.currentDepartmentId),
      managerId: str(p.managerPersonId) || undefined,
    });
  }
  return out;
}

const addrOf = (p: Person): Addr => ({ name: p.name, email: p.email, personId: p.id });

function mailOf(threadKey: string, n: number, m: Omit<Mail, "id" | "threadId" | "outlookId" | "conversationId">): Mail {
  return {
    ...m,
    id: gmailId(`${threadKey}#${n}`),
    threadId: gmailId(`${threadKey}#0`),
    outlookId: outlookId(`${threadKey}#${n}`),
    conversationId: outlookConversationId(threadKey),
  };
}

/** Message times inside a thread: never before the previous one, never after `last`. */
function between(start: number, end: number, offset: number): number {
  return end > start ? Math.min(start + offset, end - 60_000) : start + offset;
}

/** A customer contact writes in about a ticket; the assignee answers by status. */
function ticketThread(world: World, ppl: Map<string, Person>, t: Row): Mail[] {
  const assignee = ppl.get(str(t.assigneePersonId));
  const customer = world.customers.find((c) => c.id === t.customerId);
  const contact = pick(world.contacts.filter((c) => c.customerId === t.customerId).sort(byId), t.id);
  if (!assignee || !customer || !contact) return [];
  const project = world.projects.find((p) => p.id === t.projectId);
  const owner = ppl.get(str(customer.accountOwnerPersonId));
  const cc = owner && owner.id !== assignee.id ? [addrOf(owner)] : [];
  const them: Addr = { name: str(contact.name), email: str(contact.email) };
  const me = addrOf(assignee);
  const contactFirst = str(contact.name).split(" ")[0];
  const key = `ticket:${t.id}`;
  const subject = `${t.title}`;
  const created = time(t.createdAt);
  const updated = Math.max(time(t.updatedAt), created);
  const sig = `${them.name}\n${str(contact.title)}, ${str(customer.name)}`;
  const mySig = `${assignee.name}\n${assignee.role}, Acme Labs`;
  const out: Mail[] = [mailOf(key, 0, {
    from: them, to: [me], cc, subject, at: created, source: { kind: "ticket", id: t.id },
    body: `Hi ${assignee.first},\n\n${str(t.description)}${project ? ` This is for ${str(project.name)}.` : ""} For us this is ${str(t.priority)} priority.\n\n${sig}`,
  })];
  const status = str(t.status);
  const reply = (n: number, at: number, body: string) =>
    mailOf(key, n, { from: me, to: [them], cc, subject: `Re: ${subject}`, at, body: `Hi ${contactFirst},\n\n${body}\n\n${mySig}`, source: { kind: "ticket", id: t.id } });
  if (status === "open") return out;
  if (status === "waiting_on_customer") {
    out.push(reply(1, updated, `Thanks for the details. Before we go further, could you send the exact steps you followed and a screenshot of what you see? We'll pick it up as soon as we have them.`));
    return out;
  }
  out.push(reply(1, between(created, updated, 6 * HOUR), `Thanks, we're on it. I'll come back to you with an update${project ? ` on ${str(project.name)}` : ""} shortly.`));
  if (status === "in_progress") {
    out.push(mailOf(key, 2, {
      from: them, to: [me], cc, subject: `Re: ${subject}`, at: updated, source: { kind: "ticket", id: t.id },
      body: `Hi ${assignee.first},\n\nAny update on this? We'd like to close it out this week.\n\n${sig}`,
    }));
  } else {
    out.push(reply(2, updated, `This is now ${status === "closed" ? "closed" : "resolved"} on our side. Let me know if anything still looks off.`));
  }
  return out;
}

/** Ahead of a renewal the customer's first contact writes to the account owner. */
function renewalThread(world: World, ppl: Map<string, Person>, c: Row, now: number): Mail[] {
  const owner = ppl.get(str(c.accountOwnerPersonId));
  const contact = world.contacts.filter((x) => x.customerId === c.id).sort(byId)[0];
  const renewal = time(c.renewalDate);
  const at = renewal - 45 * DAY;
  if (!owner || !contact || !renewal || at > now) return [];
  const key = `renewal:${c.id}`;
  const them: Addr = { name: str(contact.name), email: str(contact.email) };
  const date = str(c.renewalDate).slice(0, 10);
  const out = [mailOf(key, 0, {
    from: them, to: [addrOf(owner)], cc: [], subject: `${str(c.name)} renewal on ${date}`, at, source: { kind: "renewal", id: c.id },
    body: `Hi ${owner.first},\n\nOur contract with Acme Labs renews on ${date}. Can we set up time to go over the terms and what's planned for next year?\n\n${them.name}\n${str(contact.title)}, ${str(c.name)}`,
  })];
  if (at + DAY <= now) {
    out.push(mailOf(key, 1, {
      from: addrOf(owner), to: [them], cc: [], subject: `Re: ${str(c.name)} renewal on ${date}`, at: at + DAY, source: { kind: "renewal", id: c.id },
      body: `Hi ${them.name.split(" ")[0]},\n\nHappy to. I'll send a few slots for next week and bring the roadmap.\n\n${owner.name}\n${owner.role}, Acme Labs`,
    }));
  }
  return out;
}

/** An author mails a company document to the project owner (or a teammate). */
function documentShare(world: World, ppl: Map<string, Person>, d: Row): Mail[] {
  const author = ppl.get(str(d.authorPersonId));
  const project = world.projects.find((p) => p.id === d.projectId);
  if (!author || !project || d.visibility !== "company") return [];
  let to = ppl.get(str(project.ownerPersonId));
  if (!to || to.id === author.id) {
    const teams = Array.isArray(project.teamIds) ? (project.teamIds as string[]) : [];
    to = pick([...ppl.values()].filter((p) => teams.includes(p.teamId) && p.id !== author.id).sort((a, b) => (a.id < b.id ? -1 : 1)), d.id);
  }
  if (!to) return [];
  return [mailOf(`document:${d.id}`, 0, {
    from: addrOf(author), to: [addrOf(to)], cc: [], subject: `Shared: ${str(d.title)}`, at: time(d.updatedAt), source: { kind: "document", id: d.id },
    body: `Hi ${to.first},\n\nSharing "${str(d.title)}" for ${str(project.name)}:\n\n${str(d.body)}\n\nIt's in Drive: https://drive.google.com/file/d/${driveFileId(d.id)}/view\n\n${author.name}`,
  })];
}

function slack(world: World, ppl: Map<string, Person>): { channels: SlackChannel[]; messages: SlackMessage[] } {
  const channels: SlackChannel[] = world.channels.map((c) => {
    const members = new Set<string>([...ppl.values()].filter((p) => p.teamId === c.teamId).map((p) => p.id));
    for (const conv of world.conversations.filter((v) => v.channelId === c.id)) {
      for (const id of (conv.participantPersonIds as string[] | undefined) ?? []) members.add(id);
      for (const m of world.messages.filter((x) => x.conversationId === conv.id)) members.add(str(m.senderPersonId));
    }
    members.delete("");
    return { id: slackChannelId(c.id), csId: c.id, name: str(c.name), isPrivate: c.kind !== "public", created: Math.floor(time(c.createdAt) / 1000), teamId: str(c.teamId), members };
  });
  const channelOfConv = new Map(world.conversations.map((v) => [v.id, slackChannelId(str(v.channelId))]));
  const threads = new Map<string, SlackMessage>();
  const top: SlackMessage[] = [];
  const sorted = [...world.messages].sort((a, b) => time(a.timestamp) - time(b.timestamp) || byId(a, b));
  for (const m of sorted) {
    const channelId = channelOfConv.get(str(m.conversationId));
    const sender = str(m.senderPersonId);
    if (!channelId || !ppl.has(sender)) continue;
    const at = time(m.timestamp);
    const msg: SlackMessage = { csId: m.id, channelId, ts: slackTs(str(m.timestamp), m.id), personId: sender, user: slackUserId(sender), text: str(m.body), at, replies: [] };
    const key = `${m.conversationId}|${str(m.projectId)}|${Math.floor(at / (7 * DAY))}`;
    const parent = threads.get(key);
    if (parent) {
      msg.threadTs = parent.ts;
      parent.threadTs = parent.ts;
      parent.replies.push(msg);
    } else {
      threads.set(key, msg);
      top.push(msg);
    }
  }
  return { channels, messages: top };
}

function jiraKey(name: string, taken: Set<string>): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  let key = words.map((w) => w[0]).join("");
  if (key.length < 2) key = (words[0] ?? "PRJ").slice(0, 3);
  let i = 1;
  const base = key;
  while (taken.has(key)) {
    key = `${base}${(words[0] ?? "X").slice(i, i + 1) || i}`;
    i++;
  }
  taken.add(key);
  return key;
}

const JIRA_STATUS: Record<string, [string, JiraIssue["statusCategory"]]> = {
  open: ["To Do", "new"],
  in_progress: ["In Progress", "indeterminate"],
  waiting_on_customer: ["Waiting for customer", "indeterminate"],
  resolved: ["Done", "done"],
  closed: ["Closed", "done"],
};

function jira(world: World): { projects: JiraProject[]; issues: JiraIssue[] } {
  const taken = new Set<string>();
  const customerName = (id: unknown) => str(world.customers.find((c) => c.id === id)?.name);
  const projects = [...world.projects].sort((a, b) => time(a.createdAt) - time(b.createdAt) || byId(a, b)).map((p, i) => ({
    id: String(10000 + i), key: jiraKey(str(p.name), taken), name: str(p.name), csId: p.id, leadPersonId: str(p.ownerPersonId), customerName: customerName(p.customerId),
  }));
  const support: JiraProject = { id: "10999", key: jiraKey("Support", taken), name: "Support", csId: "", leadPersonId: "", customerName: "" };
  const issues: JiraIssue[] = [];
  const counters = new Map<string, number>();
  const tickets = [...world.tickets].sort((a, b) => time(a.createdAt) - time(b.createdAt) || byId(a, b));
  tickets.forEach((t, i) => {
    const project = projects.find((p) => p.csId === t.projectId) ?? support;
    const n = (counters.get(project.key) ?? 0) + 1;
    counters.set(project.key, n);
    const [status, statusCategory] = JIRA_STATUS[str(t.status)] ?? ["To Do", "new"];
    const customer = customerName(t.customerId);
    issues.push({
      id: String(20000 + i), key: `${project.key}-${n}`, project, csId: t.id, summary: str(t.title), description: str(t.description),
      status, statusCategory, priority: { urgent: "Highest", high: "High", medium: "Medium", low: "Low" }[str(t.priority)] ?? "Medium",
      assigneeId: str(t.assigneePersonId) || undefined, created: time(t.createdAt), updated: time(t.updatedAt), customerName: customer,
      labels: customer ? [customer.toLowerCase().replace(/[^a-z0-9]+/g, "-")] : [],
    });
  });
  if (issues.some((x) => x.project === support)) projects.push(support);
  return { projects, issues };
}

function files(world: World): DriveFile[] {
  const name = (rows: Row[], id: unknown) => str(rows.find((r) => r.id === id)?.name);
  return world.documents.map((d) => ({
    id: driveFileId(d.id), csId: d.id, title: str(d.title), name: `${str(d.title)}.md`, mimeType: str(d.mimeType) || "text/markdown",
    body: str(d.body), authorId: str(d.authorPersonId), created: time(d.createdAt), modified: time(d.updatedAt), visibility: str(d.visibility),
    project: name(world.projects, d.projectId), customer: name(world.customers, d.customerId),
  }));
}

function msTeams(world: World, ppl: Map<string, Person>): MsTeam[] {
  return [...world.teams].sort(byId).map((t) => ({
    id: guid(`team:${t.id}`), csTeamId: t.id, name: str(t.name), description: `${str(t.name)} team at Acme Labs`,
    members: new Set([...ppl.values()].filter((p) => p.teamId === t.id).map((p) => p.id)),
    channels: [
      { id: teamsChannelId(`general:${t.id}`), name: "General" },
      ...world.channels.filter((c) => c.teamId === t.id).sort(byId).map((c) => ({ id: teamsChannelId(c.id), name: str(c.name), csChannelId: c.id })),
    ],
  }));
}

const cache = new WeakMap<World, Index>();

/** Everything the connectors serve, derived once per world. `now` hides mail from the future. */
export function indexWorld(world: World, now = Date.now()): Index {
  const hit = cache.get(world);
  if (hit) return hit;
  const ppl = people(world);
  const first = [...ppl.values()][0];
  const domain = first?.email.split("@")[1] ?? "acme-labs.test";
  const mail = [
    ...world.tickets.flatMap((t) => ticketThread(world, ppl, t)),
    ...world.customers.flatMap((c) => renewalThread(world, ppl, c, now)),
    ...world.documents.flatMap((d) => documentShare(world, ppl, d)),
  ].filter((m) => m.at && m.at <= now).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
  const threads = new Map<string, Mail[]>();
  for (const m of [...mail].reverse()) threads.set(m.threadId, [...(threads.get(m.threadId) ?? []), m]);
  const { channels, messages } = slack(world, ppl);
  const { projects, issues } = jira(world);
  const index: Index = {
    domain,
    companyName: "Acme Labs",
    slackTeamId: slackTeamId(domain),
    people: ppl,
    peopleBySlack: new Map([...ppl.values()].map((p) => [slackUserId(p.id), p])),
    mail,
    threads,
    channels,
    slackMessages: messages,
    jiraProjects: projects,
    issues,
    files: files(world),
    teams: msTeams(world, ppl),
  };
  cache.set(world, index);
  return index;
}

/** One person's mailbox, newest first, with Gmail-style labels from their side. */
export function mailboxFor(index: Index, personId: string): MailboxEntry[] {
  const out: MailboxEntry[] = [];
  for (const m of index.mail) {
    const sent = m.from.personId === personId;
    const received = [...m.to, ...m.cc].some((a) => a.personId === personId);
    if (!sent && !received) continue;
    const labels: string[] = [];
    if (received) labels.push("INBOX");
    if (sent) labels.push("SENT");
    const thread = index.threads.get(m.threadId) ?? [];
    if (received && !sent && thread.at(-1)?.id === m.id) labels.push("UNREAD");
    if (received) labels.push("CATEGORY_PRIMARY");
    out.push({ ...m, labels });
  }
  return out;
}

/** Channels a person can read: every public one, private ones they belong to. */
export function readableChannels(index: Index, personId: string): SlackChannel[] {
  return index.channels.filter((c) => !c.isPrivate || c.members.has(personId));
}

/** Files a person can see: company-wide documents plus their own private ones. */
export function visibleFiles(index: Index, personId: string): DriveFile[] {
  return index.files.filter((f) => f.visibility === "company" || f.authorId === personId);
}

export const formatAddr = (a: Addr) => `${a.name} <${a.email}>`;
