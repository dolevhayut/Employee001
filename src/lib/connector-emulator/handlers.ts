// One handler per emulated Composio slug. A handler gets the arguments (with
// contract defaults applied) and returns what Composio would put in `data`.
// Shapes follow the provider APIs (Gmail, Graph, Slack Web API, Jira REST v3,
// Drive v3, SharePoint search) plus the Composio-specific Gmail fields E001
// parses; Composio publishes no output schemas, so these are modelled, not
// captured (see evals/connectors/README.md).
//
// Reads are per person: their mailbox, the channels they can read, the files
// they can see. Writes never leave the machine: `ctx.write` puts them in the
// outbox and the handler returns a provider-shaped success.

import {
  formatAddr, mailboxFor, readableChannels, visibleFiles,
  type DriveFile, type Index, type JiraIssue, type MailboxEntry, type MsTeam, type Person, type SlackChannel, type SlackMessage,
} from "./mapping";
import { driveQuery, gmailQuery, jqlQuery, kqlQuery, odataFilter, slackQuery } from "./queries";
import { gmailId, guid, hash, jiraAccountId, slackTs, slackUserId } from "./ids";

export class ToolError extends Error {}

export type Ctx = {
  index: Index;
  me: Person;
  now: number;
  /** Record a write in the outbox; returns a sequence number for ids. */
  write: (args: Record<string, unknown>, result: unknown) => number;
  /** Writes so far for this slug (so created ids keep counting up). */
  writes: number;
};
type Args = Record<string, unknown>;
type Handler = (args: Args, ctx: Ctx) => unknown;

const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : d);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : typeof v === "string" && v ? v.split(",").map((x) => x.trim()) : []);
const iso = (ms: number) => new Date(ms).toISOString();
const cursorOf = (offset: number) => Buffer.from(`emu:${offset}`).toString("base64");
const offsetOf = (cursor: unknown) => {
  const c = s(cursor);
  if (!c) return 0;
  const m = /^emu:(\d+)$/.exec(Buffer.from(c, "base64").toString("utf8")) ?? /\$skip=(\d+)/.exec(c) ?? /^(\d+)$/.exec(c);
  if (!m) throw new ToolError(`Invalid page token: ${c}`);
  return Number(m[1]);
};
function page<T>(items: T[], offset: number, size: number): { items: T[]; next?: number } {
  const slice = items.slice(offset, offset + size);
  return { items: slice, next: offset + size < items.length ? offset + size : undefined };
}

// ─── Gmail ───────────────────────────────────────────────────────────────────

const b64url = (text: string) => Buffer.from(text).toString("base64url");
const searchable = (m: MailboxEntry) => ({
  from: formatAddr(m.from), to: m.to.map(formatAddr).join(", "), cc: m.cc.map(formatAddr).join(", "),
  subject: m.subject, body: m.body, labels: m.labels, at: m.at,
});

function gmailMessage(m: MailboxEntry, opts: { payload: boolean; text: boolean }) {
  const headers = [
    { name: "From", value: formatAddr(m.from) },
    { name: "To", value: m.to.map(formatAddr).join(", ") },
    ...(m.cc.length ? [{ name: "Cc", value: m.cc.map(formatAddr).join(", ") }] : []),
    { name: "Subject", value: m.subject },
    { name: "Date", value: new Date(m.at).toUTCString() },
    { name: "Message-ID", value: `<${m.id}@mail.gmail.com>` },
  ];
  return {
    messageId: m.id,
    threadId: m.threadId,
    messageTimestamp: iso(m.at),
    labelIds: m.labels,
    sender: formatAddr(m.from),
    to: m.to.map(formatAddr).join(", "),
    subject: m.subject,
    ...(opts.text ? { messageText: m.body } : {}),
    preview: { subject: m.subject, body: m.body.slice(0, 200) },
    attachmentList: [],
    display_url: `https://mail.google.com/mail/u/0/#all/${m.id}`,
    ...(opts.payload ? { payload: { partId: "", mimeType: "text/plain", filename: "", headers, body: { size: Buffer.byteLength(m.body), data: b64url(m.body) } } } : {}),
  };
}

function findMail(ctx: Ctx, pred: (m: MailboxEntry) => boolean): MailboxEntry {
  const m = mailboxFor(ctx.index, ctx.me.id).find(pred);
  if (!m) throw new ToolError("Requested entity was not found.");
  return m;
}

function recipients(...values: unknown[]): string[] {
  return values.flatMap((v) => list(v)).filter((e) => /@/.test(e));
}

const gmail: Record<string, Handler> = {
  GMAIL_FETCH_EMAILS(a, ctx) {
    const match = gmailQuery(s(a.query), ctx.now);
    const labels = list(a.label_ids).map((l) => l.toUpperCase());
    const all = mailboxFor(ctx.index, ctx.me.id).filter((m) => labels.every((l) => m.labels.includes(l)) && match(searchable(m)));
    const { items, next } = page(all, offsetOf(a.page_token), Math.min(n(a.max_results, 1), 500));
    const messages = a.ids_only === true
      ? items.map((m) => ({ messageId: m.id, threadId: m.threadId }))
      : items.map((m) => gmailMessage(m, { payload: a.include_payload !== false, text: a.verbose !== false }));
    return { messages, nextPageToken: next === undefined ? null : cursorOf(next), resultSizeEstimate: all.length };
  },
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID(a, ctx) {
    const m = findMail(ctx, (x) => x.id === s(a.message_id));
    return gmailMessage(m, { payload: s(a.format) !== "minimal", text: s(a.format) !== "minimal" });
  },
  GMAIL_FETCH_MESSAGE_BY_THREAD_ID(a, ctx) {
    const box = mailboxFor(ctx.index, ctx.me.id).filter((m) => m.threadId === s(a.thread_id));
    if (!box.length) throw new ToolError("Requested entity was not found.");
    return { id: s(a.thread_id), historyId: hash(s(a.thread_id), 6), messages: [...box].reverse().map((m) => gmailMessage(m, { payload: true, text: true })) };
  },
  GMAIL_SEND_EMAIL(a, ctx) {
    const to = recipients(a.recipient_email, a.extra_recipients);
    if (!to.length && !recipients(a.cc, a.bcc).length) throw new ToolError("At least one of recipient_email, extra_recipients, cc or bcc must be provided.");
    const id = gmailId(`sent:${ctx.me.id}:${ctx.writes}`);
    const result = { id, threadId: id, labelIds: ["SENT"] };
    ctx.write(a, result);
    return result;
  },
  GMAIL_REPLY_TO_THREAD(a, ctx) {
    const thread = mailboxFor(ctx.index, ctx.me.id).filter((m) => m.threadId === s(a.thread_id));
    if (!thread.length) throw new ToolError("Requested entity was not found.");
    const last = thread[0];
    const fallback = last.from.personId === ctx.me.id ? last.to[0]?.email : last.from.email;
    const to = recipients(a.recipient_email, a.extra_recipients);
    const result = { id: gmailId(`reply:${ctx.me.id}:${ctx.writes}`), threadId: s(a.thread_id), labelIds: ["SENT"] };
    ctx.write({ ...a, resolved_recipients: to.length ? to : [fallback].filter(Boolean), subject: last.subject.startsWith("Re:") ? last.subject : `Re: ${last.subject}` }, result);
    return result;
  },
  GMAIL_CREATE_EMAIL_DRAFT(a, ctx) {
    const id = gmailId(`draft:${ctx.me.id}:${ctx.writes}`);
    const result = { id: `r${hash(id, 18)}`, message: { id, threadId: s(a.thread_id) || id, labelIds: ["DRAFT"] } };
    ctx.write(a, result);
    return result;
  },
  GMAIL_WHO_AM_I(_a, ctx) {
    const box = mailboxFor(ctx.index, ctx.me.id);
    return { emailAddress: ctx.me.email, messagesTotal: box.length, threadsTotal: new Set(box.map((m) => m.threadId)).size, historyId: hash(ctx.me.id, 6) };
  },
};

// ─── Outlook (Microsoft Graph) ───────────────────────────────────────────────

const graphAddr = (a: { name: string; email: string }) => ({ emailAddress: { name: a.name, address: a.email } });

function graphMessage(m: MailboxEntry) {
  const folder = m.labels.includes("INBOX") ? "inbox" : "sentitems";
  return {
    id: m.outlookId,
    conversationId: m.conversationId,
    internetMessageId: `<${m.id}@acme-labs.test>`,
    subject: m.subject,
    bodyPreview: m.body.slice(0, 255),
    body: { contentType: "text", content: m.body },
    from: graphAddr(m.from),
    sender: graphAddr(m.from),
    toRecipients: m.to.map(graphAddr),
    ccRecipients: m.cc.map(graphAddr),
    receivedDateTime: iso(m.at).replace(/\.\d{3}Z$/, "Z"),
    sentDateTime: iso(m.at).replace(/\.\d{3}Z$/, "Z"),
    isRead: !m.labels.includes("UNREAD"),
    isDraft: false,
    hasAttachments: false,
    importance: "normal",
    categories: [],
    parentFolderId: folder,
    webLink: `https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(m.outlookId)}&exvsurl=1&viewmodel=ReadMessageItem`,
  };
}

function outlookFolder(folder: string, m: MailboxEntry): boolean {
  switch (folder.toLowerCase().replace(/\s+/g, "")) {
    case "inbox": return m.labels.includes("INBOX");
    case "sentitems": case "sent": return m.labels.includes("SENT");
    case "drafts": case "deleteditems": case "archive": case "junkemail": return false;
    default: throw new ToolError(`The specified folder could not be found in the store: ${folder}`);
  }
}

function orderMessages(items: ReturnType<typeof graphMessage>[], orderby: unknown) {
  const spec = (Array.isArray(orderby) ? s(orderby[0]) : s(orderby)) || "receivedDateTime desc";
  const [field, dir] = spec.split(/\s+/);
  const key = (x: Record<string, unknown>) => String(x[field] ?? "");
  return [...items].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0) * (dir?.toLowerCase() === "asc" ? 1 : -1));
}

function graphPage(items: ReturnType<typeof graphMessage>[], a: Args, defTop: number, select?: string[]) {
  const top = n(a.top, defTop);
  const offset = a.page_token ? offsetOf(a.page_token) : n(a.skip, 0);
  const { items: slice, next } = page(items, offset, top);
  const picked = select?.length ? slice.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k === "id" || select.includes(k)))) : slice;
  return {
    "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('me')/messages",
    value: picked,
    ...(next !== undefined ? { "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${s(a.folder) || "inbox"}/messages?$top=${top}&$skip=${next}` } : {}),
  };
}

const MINIMAL = ["id", "conversationId", "subject", "bodyPreview", "from", "receivedDateTime", "isRead", "hasAttachments", "webLink"];

const outlook: Record<string, Handler> = {
  OUTLOOK_QUERY_EMAILS(a, ctx) {
    const filter = odataFilter(s(a.filter));
    const folder = s(a.folder) || "inbox";
    const items = mailboxFor(ctx.index, ctx.me.id).filter((m) => outlookFolder(folder, m)).map(graphMessage).filter((m) => filter(m));
    return graphPage(orderMessages(items, a.orderby), a, 100, list(a.select));
  },
  OUTLOOK_LIST_MESSAGES(a, ctx) {
    const filter = odataFilter(s(a.filter));
    const folder = s(a.folder) || "inbox";
    const t = (v: unknown) => (s(v) ? Date.parse(s(v)) : undefined);
    const conds: ((m: ReturnType<typeof graphMessage>, raw: MailboxEntry) => boolean)[] = [];
    const lower = (v: string) => v.toLowerCase();
    if (typeof a.is_read === "boolean") conds.push((m) => m.isRead === a.is_read);
    if (s(a.from_address)) conds.push((m) => lower(m.from.emailAddress.address) === lower(s(a.from_address)));
    if (s(a.subject)) conds.push((m) => lower(m.subject) === lower(s(a.subject)));
    if (s(a.subject_contains)) conds.push((m) => lower(m.subject).includes(lower(s(a.subject_contains))));
    if (s(a.subject_startswith)) conds.push((m) => lower(m.subject).startsWith(lower(s(a.subject_startswith))));
    if (s(a.subject_endswith)) conds.push((m) => lower(m.subject).endsWith(lower(s(a.subject_endswith))));
    if (s(a.conversation_id)) conds.push((m) => m.conversationId === s(a.conversation_id));
    if (typeof a.has_attachments === "boolean") conds.push(() => a.has_attachments === false);
    if (s(a.importance)) conds.push(() => lower(s(a.importance)) === "normal");
    if (list(a.categories).length) conds.push(() => false);
    for (const [key, op] of [["received_date_time_ge", ">="], ["received_date_time_gt", ">"], ["received_date_time_le", "<="], ["received_date_time_lt", "<"], ["sent_date_time_gt", ">"], ["sent_date_time_lt", "<"]] as const) {
      const v = t(a[key]);
      if (v === undefined) continue;
      if (Number.isNaN(v)) throw new ToolError(`Invalid date for ${key}`);
      conds.push((_m, raw) => (op === ">=" ? raw.at >= v : op === ">" ? raw.at > v : op === "<=" ? raw.at <= v : raw.at < v));
    }
    if (s(a.search)) {
      const words = s(a.search).replace(/"/g, "").split(/\s+/).filter(Boolean).map(lower);
      conds.push((_m, raw) => words.every((w) => lower(`${raw.subject} ${raw.body} ${formatAddr(raw.from)}`).includes(w)));
    }
    const rows = mailboxFor(ctx.index, ctx.me.id).filter((m) => outlookFolder(folder, m));
    const items = rows.map((raw) => ({ raw, m: graphMessage(raw) })).filter(({ raw, m }) => filter(m) && conds.every((c) => c(m, raw))).map(({ m }) => m);
    const select = list(a.select).length ? list(a.select) : s(a.response_detail) === "full" ? undefined : MINIMAL;
    return graphPage(orderMessages(items, a.orderby), a, 10, select);
  },
  OUTLOOK_SEND_EMAIL(a, ctx) {
    if (!recipients(a.to).length) throw new ToolError("At least one valid recipient is required in 'to'.");
    ctx.write(a, {});
    return {};
  },
  OUTLOOK_REPLY_EMAIL(a, ctx) {
    const m = findMail(ctx, (x) => x.outlookId === s(a.message_id));
    const to = m.from.personId === ctx.me.id ? m.to.map((x) => x.email) : [m.from.email];
    ctx.write({ ...a, resolved_recipients: to, subject: `RE: ${m.subject}` }, {});
    return {};
  },
  OUTLOOK_GET_PROFILE(_a, ctx) {
    return {
      "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users/$entity",
      id: guid(`aad:${ctx.me.id}`), displayName: ctx.me.name, givenName: ctx.me.first, surname: ctx.me.last,
      mail: ctx.me.email, userPrincipalName: ctx.me.email, jobTitle: ctx.me.role, department: ctx.me.department,
      officeLocation: null, businessPhones: [], mobilePhone: null, preferredLanguage: "en-US",
    };
  },
};

// ─── Slack ───────────────────────────────────────────────────────────────────

const slackName = (p: Person) => `${p.first}.${p.last}`.toLowerCase().replace(/[^a-z0-9.]/g, "");

function slackUser(ix: Index, p: Person) {
  return {
    id: slackUserId(p.id), team_id: ix.slackTeamId, name: slackName(p), real_name: p.name, deleted: false,
    is_bot: false, is_admin: false, is_app_user: false, tz: "America/New_York",
    profile: { real_name: p.name, display_name: p.first, email: p.email, title: p.role, team: ix.slackTeamId },
  };
}

function slackChannel(ix: Index, c: SlackChannel, me: Person) {
  const team = [...ix.people.values()].find((p) => p.teamId === c.teamId)?.team ?? "";
  return {
    id: c.id, name: c.name, name_normalized: c.name, is_channel: true, is_group: false, is_im: false, is_private: c.isPrivate,
    is_archived: false, is_general: false, is_member: c.members.has(me.id), created: c.created, creator: "",
    num_members: c.members.size, topic: { value: "", creator: "", last_set: 0 }, purpose: { value: team ? `${team} team channel` : "", creator: "", last_set: 0 },
  };
}

function slackMessage(ix: Index, m: SlackMessage, parent?: SlackMessage) {
  const base = { type: "message", user: m.user, text: m.text, ts: m.ts, team: ix.slackTeamId };
  if (parent) return { ...base, thread_ts: parent.ts, parent_user_id: parent.user };
  if (!m.replies.length) return base;
  return { ...base, thread_ts: m.ts, reply_count: m.replies.length, reply_users: [...new Set(m.replies.map((r) => r.user))], latest_reply: m.replies.at(-1)!.ts };
}

function channelFor(ctx: Ctx, ref: string): SlackChannel {
  const name = ref.replace(/^#/, "");
  const c = readableChannels(ctx.index, ctx.me.id).find((x) => x.id === ref || x.name === name);
  if (!c) throw new ToolError("channel_not_found");
  return c;
}

const slackOk = <T extends object>(body: T) => ({ ok: true, ...body });

const slack: Record<string, Handler> = {
  SLACK_SEARCH_MESSAGES(a, ctx) {
    const match = slackQuery(s(a.query));
    const channels = new Map(readableChannels(ctx.index, ctx.me.id).map((c) => [c.id, c]));
    const rows: { m: SlackMessage; c: SlackChannel }[] = [];
    for (const top of ctx.index.slackMessages) {
      const c = channels.get(top.channelId);
      if (!c) continue;
      for (const m of [top, ...top.replies]) rows.push({ m, c });
    }
    const hits = rows.filter(({ m, c }) => match({ text: m.text, user: m.user, userName: ctx.index.people.get(m.personId)?.name ?? "", channelId: c.id, channelName: c.name, at: m.at }));
    hits.sort((x, y) => (s(a.sort_dir) === "asc" ? x.m.at - y.m.at : y.m.at - x.m.at));
    const perPage = Math.max(1, n(a.count, 1));
    const pageNo = Math.max(1, n(a.page, 1));
    const slice = hits.slice((pageNo - 1) * perPage, pageNo * perPage);
    const pages = Math.max(1, Math.ceil(hits.length / perPage));
    return slackOk({
      query: s(a.query),
      messages: {
        total: hits.length,
        matches: slice.map(({ m, c }) => {
          const p = ctx.index.people.get(m.personId);
          return {
            iid: hash(`iid:${m.csId}`, 8), type: "message", user: m.user, username: p ? slackName(p) : "", ts: m.ts, text: m.text, team: ctx.index.slackTeamId,
            channel: { id: c.id, name: c.name, is_channel: true, is_private: c.isPrivate },
            permalink: `https://acme-labs-sim.slack.com/archives/${c.id}/p${m.ts.replace(".", "")}`,
            ...(m.threadTs && m.threadTs !== m.ts ? { thread_ts: m.threadTs } : {}),
          };
        }),
        pagination: { total_count: hits.length, page: pageNo, per_page: perPage, page_count: pages, first: slice.length ? (pageNo - 1) * perPage + 1 : 0, last: (pageNo - 1) * perPage + slice.length },
        paging: { count: perPage, total: hits.length, page: pageNo, pages },
      },
    });
  },
  SLACK_FETCH_CONVERSATION_HISTORY(a, ctx) {
    const c = channelFor(ctx, s(a.channel));
    const latest = s(a.latest) ? Number(s(a.latest)) : Infinity;
    const oldest = s(a.oldest) ? Number(s(a.oldest)) : 0;
    const msgs = ctx.index.slackMessages.filter((m) => m.channelId === c.id && Number(m.ts) <= latest && Number(m.ts) >= oldest).reverse();
    const { items, next } = page(msgs, offsetOf(a.cursor), Math.min(n(a.limit, 100), 999));
    return slackOk({ messages: items.map((m) => slackMessage(ctx.index, m)), has_more: next !== undefined, pin_count: 0, response_metadata: { next_cursor: next === undefined ? "" : cursorOf(next) } });
  },
  SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION(a, ctx) {
    const c = channelFor(ctx, s(a.channel));
    const ts = s(a.ts);
    const parent = ctx.index.slackMessages.find((m) => m.channelId === c.id && (m.ts === ts || m.replies.some((r) => r.ts === ts)));
    if (!parent) throw new ToolError("thread_not_found");
    const all = [slackMessage(ctx.index, parent), ...parent.replies.map((r) => slackMessage(ctx.index, r, parent))];
    const { items, next } = page(all, offsetOf(a.cursor), Math.min(n(a.limit, 1000), 1000));
    return slackOk({ messages: items, has_more: next !== undefined, response_metadata: { next_cursor: next === undefined ? "" : cursorOf(next) } });
  },
  SLACK_LIST_ALL_CHANNELS(a, ctx) {
    const types = list(a.types);
    const channels = readableChannels(ctx.index, ctx.me.id).filter((c) => !types.length || types.includes(c.isPrivate ? "private_channel" : "public_channel"));
    const { items, next } = page(channels, offsetOf(a.cursor), Math.max(1, n(a.limit, 1)));
    return slackOk({ channels: items.map((c) => slackChannel(ctx.index, c, ctx.me)), response_metadata: { next_cursor: next === undefined ? "" : cursorOf(next) } });
  },
  SLACK_LIST_ALL_USERS(a, ctx) {
    const { items, next } = page([...ctx.index.people.values()], offsetOf(a.cursor), Math.max(1, n(a.limit, 1)));
    return slackOk({ members: items.map((p) => slackUser(ctx.index, p)), cache_ts: Math.floor(ctx.now / 1000), response_metadata: { next_cursor: next === undefined ? "" : cursorOf(next) } });
  },
  SLACK_SEND_MESSAGE(a, ctx) {
    const ref = s(a.channel);
    const dmTo = ctx.index.peopleBySlack.get(ref);
    let channelId: string;
    if (dmTo) channelId = `D${hash(`dm:${[ctx.me.id, dmTo.id].sort().join(":")}`, 10).toUpperCase()}`;
    else {
      const c = channelFor(ctx, ref);
      if (!c.members.has(ctx.me.id)) throw new ToolError("not_in_channel");
      channelId = c.id;
    }
    // `text` is not in the current contract (markdown_text replaced it); keep it so the outbox shows what was sent.
    const text = s(a.markdown_text) || s(a.text) || s(a.fallback_text) || (Array.isArray(a.blocks) && a.blocks.length ? JSON.stringify(a.blocks) : "");
    if (!text) throw new ToolError("no_text");
    const ts = slackTs(iso(ctx.now), `send:${ctx.me.id}:${ctx.writes}`);
    const result = slackOk({ channel: channelId, ts, message: { type: "message", user: slackUserId(ctx.me.id), text, ts, team: ctx.index.slackTeamId, ...(s(a.thread_ts) ? { thread_ts: s(a.thread_ts) } : {}) } });
    ctx.write(a, result);
    return result;
  },
  SLACK_WHO_AM_I(_a, ctx) {
    return slackOk({ url: "https://acme-labs-sim.slack.com/", team: ctx.index.companyName, user: slackName(ctx.me), team_id: ctx.index.slackTeamId, user_id: slackUserId(ctx.me.id), is_enterprise_install: false });
  },
};

// ─── Jira ────────────────────────────────────────────────────────────────────

const JIRA = "https://acme-labs-sim.atlassian.net";
const jiraDate = (ms: number) => iso(ms).replace("Z", "+0000");
const adf = (text: string) => ({ type: "doc", version: 1, content: text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [] });

function jiraUser(p: Person) {
  return {
    self: `${JIRA}/rest/api/3/user?accountId=${jiraAccountId(p.id)}`, accountId: jiraAccountId(p.id), accountType: "atlassian",
    emailAddress: p.email, displayName: p.name, active: true, timeZone: "America/New_York",
    avatarUrls: { "48x48": `https://avatar-management.example/${hash(p.id, 8)}.png` },
  };
}

function jiraIssue(ix: Index, i: JiraIssue, fields?: string[]) {
  const assignee = i.assigneeId ? ix.people.get(i.assigneeId) : undefined;
  const all: Record<string, unknown> = {
    summary: i.summary,
    description: adf(i.description),
    status: { name: i.status, statusCategory: { key: i.statusCategory, name: { new: "To Do", indeterminate: "In Progress", done: "Done" }[i.statusCategory] } },
    priority: { name: i.priority },
    assignee: assignee ? jiraUser(assignee) : null,
    reporter: null,
    project: { id: i.project.id, key: i.project.key, name: i.project.name, projectTypeKey: "software" },
    issuetype: { name: "Task", subtask: false },
    labels: i.labels,
    created: jiraDate(i.created),
    updated: jiraDate(i.updated),
    resolution: i.statusCategory === "done" ? { name: "Done" } : null,
    comment: { comments: [], total: 0, maxResults: 0, startAt: 0 },
  };
  const want = fields?.filter((f) => f && !f.startsWith("*"));
  return { id: i.id, key: i.key, self: `${JIRA}/rest/api/3/issue/${i.id}`, fields: want?.length ? Object.fromEntries(want.filter((f) => f in all).map((f) => [f, all[f]])) : all };
}

function findIssue(ix: Index, ref: string): JiraIssue {
  const i = ix.issues.find((x) => x.key.toLowerCase() === ref.toLowerCase() || x.id === ref);
  if (!i) throw new ToolError("Issue does not exist or you do not have permission to see it.");
  return i;
}

const jira: Record<string, Handler> = {
  JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET(a, ctx) {
    const { match, order } = jqlQuery(s(a.jql), { accountId: jiraAccountId(ctx.me.id), email: ctx.me.email, name: ctx.me.name }, ctx.now);
    const rows = ctx.index.issues.map((i) => {
      const p = i.assigneeId ? ctx.index.people.get(i.assigneeId) : undefined;
      return { i, q: { key: i.key, projectKey: i.project.key, projectName: i.project.name, summary: i.summary, description: i.description, status: i.status, statusCategory: i.statusCategory, priority: i.priority, labels: i.labels, type: "Task", created: i.created, updated: i.updated, assignee: p ? { accountId: jiraAccountId(p.id), email: p.email, name: p.name } : undefined } };
    }).filter((r) => match(r.q));
    const ord = order.length ? order : [{ field: "created", dir: "desc" as const }];
    rows.sort((x, y) => {
      for (const o of ord) {
        const get = (r: (typeof rows)[number]) => (o.field === "updated" ? r.q.updated : o.field === "priority" ? ["Lowest", "Low", "Medium", "High", "Highest"].indexOf(r.q.priority) : o.field === "key" ? Number(r.q.key.split("-")[1]) : r.q.created);
        const d = get(x) - get(y);
        if (d) return o.dir === "desc" ? -d : d;
      }
      return 0;
    });
    const { items, next } = page(rows.map((r) => r.i), offsetOf(a.next_page_token), Math.min(n(a.max_results, 50), 5000));
    return { issues: items.map((i) => jiraIssue(ctx.index, i, list(a.fields))), isLast: next === undefined, ...(next !== undefined ? { nextPageToken: cursorOf(next) } : {}) };
  },
  JIRA_GET_ISSUE(a, ctx) {
    return jiraIssue(ctx.index, findIssue(ctx.index, s(a.issue_id_or_key)), list(a.fields));
  },
  JIRA_CREATE_ISSUE(a, ctx) {
    const project = ctx.index.jiraProjects.find((p) => p.key.toLowerCase() === s(a.project_key).toLowerCase());
    if (!project) throw new ToolError("Specify a valid project ID or key");
    const existing = ctx.index.issues.filter((i) => i.project.key === project.key).length;
    const id = String(30000 + ctx.writes);
    const result = { id, key: `${project.key}-${existing + ctx.writes + 1}`, self: `${JIRA}/rest/api/3/issue/${id}` };
    ctx.write(a, result);
    return result;
  },
  JIRA_ADD_COMMENT(a, ctx) {
    const issue = findIssue(ctx.index, s(a.issue_id_or_key));
    const id = String(40000 + ctx.writes);
    const result = { id, self: `${JIRA}/rest/api/3/issue/${issue.id}/comment/${id}`, author: jiraUser(ctx.me), body: adf(s(a.comment)), created: jiraDate(ctx.now), updated: jiraDate(ctx.now) };
    ctx.write({ ...a, issue_key: issue.key }, result);
    return result;
  },
  JIRA_GET_CURRENT_USER(_a, ctx) {
    return { ...jiraUser(ctx.me), locale: "en_US", groups: { size: 1, items: [] }, applicationRoles: { size: 1, items: [] } };
  },
  JIRA_GET_ALL_PROJECTS(a, ctx) {
    const q = (s(a.query) || s(a.name)).toLowerCase();
    const rows = ctx.index.jiraProjects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
    const start = n(a.startAt, 0);
    const size = n(a.maxResults, 50);
    const slice = rows.slice(start, start + size);
    return {
      self: `${JIRA}/rest/api/3/project/search`, startAt: start, maxResults: size, total: rows.length, isLast: start + size >= rows.length,
      values: slice.map((p) => {
        const lead = ctx.index.people.get(p.leadPersonId);
        return { self: `${JIRA}/rest/api/3/project/${p.id}`, id: p.id, key: p.key, name: p.name, projectTypeKey: "software", simplified: false, style: "classic", isPrivate: false, ...(lead ? { lead: jiraUser(lead) } : {}) };
      }),
    };
  },
};

// ─── Google Drive ────────────────────────────────────────────────────────────

const FOLDER = `0A${hash("drive-folder:company", 20)}`;

function driveFile(ix: Index, f: DriveFile, me: Person) {
  const author = ix.people.get(f.authorId);
  return {
    kind: "drive#file", id: f.id, name: f.name, mimeType: f.mimeType, createdTime: iso(f.created), modifiedTime: iso(f.modified),
    owners: author ? [{ kind: "drive#user", displayName: author.name, emailAddress: author.email, me: author.id === me.id }] : [],
    parents: [FOLDER], webViewLink: `https://drive.google.com/file/d/${f.id}/view`, size: String(Buffer.byteLength(f.body)),
    shared: f.visibility === "company", trashed: false, starred: false,
  };
}

const drive: Record<string, Handler> = {
  GOOGLEDRIVE_FIND_FILE(a, ctx) {
    const match = driveQuery(s(a.q));
    const folder = s(a.folder_id);
    const rows = visibleFiles(ctx.index, ctx.me.id).filter((f) => {
      const author = ctx.index.people.get(f.authorId);
      return (!folder || folder === FOLDER) && match({ name: f.name, body: f.body, mimeType: f.mimeType, owners: author ? [author.email] : [], parents: [FOLDER], modified: f.modified, created: f.created, mine: f.authorId === ctx.me.id });
    });
    const [field, dir] = (s(a.orderBy) || "modifiedTime desc").split(/\s+/);
    rows.sort((x, y) => (field === "name" ? x.name.localeCompare(y.name) : field === "createdTime" ? x.created - y.created : x.modified - y.modified) * (dir === "desc" ? -1 : 1));
    const { items, next } = page(rows, offsetOf(a.pageToken), Math.min(n(a.pageSize, 100), 1000));
    return { kind: "drive#fileList", incompleteSearch: false, files: items.map((f) => driveFile(ctx.index, f, ctx.me)), ...(next !== undefined ? { nextPageToken: cursorOf(next) } : {}) };
  },
  GOOGLEDRIVE_DOWNLOAD_FILE(a, ctx) {
    const f = visibleFiles(ctx.index, ctx.me.id).find((x) => x.id === s(a.fileId));
    if (!f) throw new ToolError(`File not found: ${s(a.fileId)}.`);
    // Composio returns a presigned URL; a data: URL keeps the bytes local and fetch() reads it.
    return { downloaded_file_content: { name: f.name, mimetype: f.mimeType, s3url: `data:${f.mimeType};base64,${Buffer.from(f.body).toString("base64")}` } };
  },
};

// ─── SharePoint ──────────────────────────────────────────────────────────────

const SITE = "https://acmelabs.sharepoint.com/sites/company";

const sharepoint: Record<string, Handler> = {
  SHARE_POINT_SEARCH_FILES(a, ctx) {
    const match = kqlQuery(s(a.query));
    const rows = visibleFiles(ctx.index, ctx.me.id).filter((f) => match({ title: f.title, body: f.body, author: ctx.index.people.get(f.authorId)?.name ?? "", extension: "md", path: `${SITE}/Shared Documents/${f.name}` }));
    const start = n(a.from_index, 0);
    const slice = rows.slice(start, start + n(a.row_limit, 25));
    const cell = (Key: string, Value: string) => ({ Key, Value, ValueType: "Edm.String" });
    return {
      ElapsedTime: 12,
      PrimaryQueryResult: {
        RelevantResults: {
          RowCount: slice.length, TotalRows: rows.length, TotalRowsIncludingDuplicates: rows.length,
          Table: {
            Rows: slice.map((f) => ({
              Cells: [
                cell("Title", f.title), cell("Path", `${SITE}/Shared Documents/${encodeURIComponent(f.name)}`),
                cell("Author", ctx.index.people.get(f.authorId)?.name ?? ""), cell("LastModifiedTime", iso(f.modified)),
                cell("HitHighlightedSummary", f.body.slice(0, 300)), cell("FileExtension", "md"), cell("FileType", "md"),
                cell("Size", String(Buffer.byteLength(f.body))), cell("SiteName", SITE), cell("UniqueId", `{${guid(`sp:${f.csId}`)}}`),
              ],
            })),
          },
        },
      },
    };
  },
};

// ─── Microsoft Teams ─────────────────────────────────────────────────────────

function findTeam(ix: Index, id: string): MsTeam {
  const t = ix.teams.find((x) => x.id === id);
  if (!t) throw new ToolError(`NotFound: No team found with Group Id ${id}`);
  return t;
}

const teams: Record<string, Handler> = {
  MICROSOFT_TEAMS_TEAMS_LIST(a, ctx) {
    const filter = odataFilter(s(a.filter));
    const rows = ctx.index.teams.map((t) => ({ id: t.id, displayName: t.name, description: t.description, visibility: "private", isArchived: false })).filter((t) => filter(t));
    const { items, next } = page(rows, offsetOf(a.page_token), n(a.top, 100));
    return { "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#teams", ...(a.count === true ? { "@odata.count": rows.length } : {}), value: items, ...(next !== undefined ? { "@odata.nextLink": cursorOf(next) } : {}) };
  },
  MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS(a, ctx) {
    const t = findTeam(ctx.index, s(a.team_id));
    const filter = odataFilter(s(a.filter));
    const value = t.channels.map((c) => ({ id: c.id, displayName: c.name, description: c.name === "General" ? `${t.name} general channel` : null, membershipType: "standard", webUrl: `https://teams.microsoft.com/l/channel/${encodeURIComponent(c.id)}/${encodeURIComponent(c.name)}?groupId=${t.id}` })).filter((c) => filter(c));
    return { "@odata.context": `https://graph.microsoft.com/v1.0/$metadata#teams('${t.id}')/channels`, "@odata.count": value.length, value };
  },
  MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE(a, ctx) {
    const t = findTeam(ctx.index, s(a.team_id));
    const c = t.channels.find((x) => x.id === s(a.channel_id));
    if (!c) throw new ToolError(`NotFound: Channel ${s(a.channel_id)} not found in team ${t.id}`);
    if (!t.members.has(ctx.me.id)) throw new ToolError("Forbidden: the user is not a member of this team.");
    const id = String(ctx.now + ctx.writes);
    const result = {
      id, replyToId: null, etag: id, messageType: "message", createdDateTime: iso(ctx.now), lastModifiedDateTime: iso(ctx.now),
      subject: s(a.subject) || null, importance: s(a.importance) || "normal", locale: "en-us",
      webUrl: `https://teams.microsoft.com/l/message/${encodeURIComponent(c.id)}/${id}?groupId=${t.id}`,
      from: { application: null, device: null, user: { id: guid(`aad:${ctx.me.id}`), displayName: ctx.me.name, userIdentityType: "aadUser" } },
      body: { contentType: s(a.content_type) || "text", content: s(a.content) },
      channelIdentity: { teamId: t.id, channelId: c.id }, attachments: [], mentions: [], reactions: [],
    };
    ctx.write(a, result);
    return result;
  },
};

export const HANDLERS: Record<string, Handler> = { ...gmail, ...outlook, ...slack, ...jira, ...drive, ...sharepoint, ...teams };
export const EMULATED_SLUGS = Object.keys(HANDLERS).sort();

const PREFIXES: [string, string][] = [["SHARE_POINT_", "share_point"], ["MICROSOFT_TEAMS_", "microsoft_teams"], ["GOOGLEDRIVE_", "googledrive"], ["GMAIL_", "gmail"], ["OUTLOOK_", "outlook"], ["SLACK_", "slack"], ["JIRA_", "jira"]];
export function toolkitOfSlug(slug: string): string {
  return PREFIXES.find(([p]) => slug.startsWith(p))?.[1] ?? slug.split("_")[0].toLowerCase();
}
