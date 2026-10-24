// CompanySim (https://github.com/dolevhayut/companysim) as the ground truth for
// the Relay eval: a local synthetic company with stable ids. Read-only REST.

export const COMPANYSIM_URL = process.env.COMPANYSIM_URL ?? "http://127.0.0.1:4545";

type Row = Record<string, unknown> & { id: string };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${COMPANYSIM_URL}/api/v1${path}`);
  if (!res.ok) throw new Error(`CompanySim ${path}: HTTP ${res.status}. Is it running (docker compose up in the companysim repo)?`);
  return (await res.json()) as T;
}

async function list(type: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: Row[]; nextCursor: string | null } = await get(`/${type}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export type World = Record<"people" | "roles" | "teams" | "departments" | "projects" | "customers" | "contacts" | "tickets" | "documents" | "tools" | "policies", Row[]>;

export async function loadWorld(): Promise<World> {
  const types = ["people", "roles", "teams", "departments", "projects", "customers", "contacts", "tickets", "documents", "tools", "policies"] as const;
  const rows = await Promise.all(types.map((t) => list(t)));
  return Object.fromEntries(types.map((t, i) => [t, rows[i]])) as World;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One fact the person knows, with the CompanySim ids that back it. */
export type Fact = { id: string; kind: "role" | "team" | "manager" | "project" | "customer" | "ticket" | "document" | "tool" | "policy" | "colleague"; text: string; refs: string[] };

export type Dossier = {
  personId: string;
  name: string;
  firstName: string;
  role: string;
  team: string;
  department: string;
  skills: string[];
  facts: Fact[];
};

export function dossierFor(world: World, personId: string): Dossier {
  const byId = new Map<string, Row>();
  for (const rows of Object.values(world)) for (const r of rows) byId.set(r.id, r);
  const name = (id: unknown) => str(byId.get(str(id))?.displayName) || str(byId.get(str(id))?.name) || str(byId.get(str(id))?.title);
  const p = byId.get(personId);
  if (!p) throw new Error(`No person ${personId} in CompanySim`);
  const teamId = str(p.currentTeamId);
  const facts: Fact[] = [];
  const add = (kind: Fact["kind"], text: string, refs: string[]) => facts.push({ id: `${kind}-${facts.length + 1}`, kind, text, refs });

  add("role", `${p.displayName} is ${name(p.currentRoleId)} in the ${name(teamId)} team (${name(p.currentDepartmentId)} department).`, [personId, str(p.currentRoleId), teamId]);
  if (p.managerPersonId) add("manager", `${p.firstName}'s manager is ${name(p.managerPersonId)}.`, [str(p.managerPersonId)]);

  const projects = world.projects.filter((pr) => pr.ownerPersonId === personId || (Array.isArray(pr.teamIds) && pr.teamIds.includes(teamId)));
  for (const pr of projects) {
    add("project", `${p.firstName} ${pr.ownerPersonId === personId ? "owns" : "works on"} the ${pr.name} project for ${name(pr.customerId)} (status ${pr.status}, priority ${pr.priority}, target ${str(pr.targetDate).slice(0, 10)}).`, [pr.id, str(pr.customerId)]);
  }
  for (const c of world.customers.filter((c) => c.accountOwnerPersonId === personId)) {
    add("customer", `${p.firstName} is the account owner for ${c.name} (${c.status}, health ${c.health}, renewal ${str(c.renewalDate).slice(0, 10)}, $${c.annualValue}/yr).`, [c.id]);
  }
  const projectIds = new Set(projects.map((pr) => pr.id));
  const customerIds = new Set(projects.map((pr) => str(pr.customerId)));
  for (const c of world.contacts.filter((c) => customerIds.has(str(c.customerId))).slice(0, 4)) {
    add("customer", `At ${name(c.customerId)}, the contact is ${c.name}, ${c.title}.`, [c.id, str(c.customerId)]);
  }
  for (const t of world.tickets.filter((t) => t.assigneePersonId === personId || projectIds.has(str(t.projectId))).slice(0, 6)) {
    add("ticket", `Ticket "${t.title}" for ${name(t.customerId)} is ${t.status} (${t.priority} priority)${t.assigneePersonId === personId ? `, assigned to ${p.firstName}` : `, assigned to ${name(t.assigneePersonId)}`}.`, [t.id]);
  }
  for (const d of world.documents.filter((d) => d.authorPersonId === personId).slice(0, 4)) {
    add("document", `${p.firstName} wrote the document "${d.title}".`, [d.id]);
  }
  for (const tool of world.tools.filter((t) => Array.isArray(t.adminPersonIds) && t.adminPersonIds.includes(personId))) {
    add("tool", `${p.firstName} is an admin of ${tool.name} (${tool.category}).`, [tool.id]);
  }
  for (const pol of world.policies.filter((x) => x.ownerPersonId === personId)) {
    add("policy", `${p.firstName} owns the ${pol.title}: ${pol.body}`, [pol.id]);
  }
  const teammates = world.people.filter((x) => x.currentTeamId === teamId && x.id !== personId).slice(0, 4);
  for (const m of teammates) add("colleague", `${m.displayName} (${name(m.currentRoleId)}) is on ${p.firstName}'s team.`, [m.id]);

  return {
    personId,
    name: str(p.displayName),
    firstName: str(p.firstName),
    role: name(p.currentRoleId),
    team: name(teamId),
    department: name(p.currentDepartmentId),
    skills: Array.isArray(p.skills) ? (p.skills as string[]) : [],
    facts,
  };
}

/** People with the most to hand over, one per team, best first. */
export function pickPeople(world: World, n: number): string[] {
  const scored = world.people
    .filter((p) => p.status === "active")
    .map((p) => {
      const d = dossierFor(world, p.id);
      const weight = d.facts.filter((f) => f.kind !== "colleague" && f.kind !== "role").length;
      return { id: p.id, team: str(p.currentTeamId), weight };
    })
    .sort((a, b) => b.weight - a.weight);
  const picked: string[] = [];
  const teams = new Set<string>();
  for (const s of scored) {
    if (teams.has(s.team)) continue;
    teams.add(s.team);
    picked.push(s.id);
    if (picked.length === n) break;
  }
  return picked;
}
