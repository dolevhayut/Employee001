// "Send to Roomate": a Team Meeting action item is filed to the dev team by
// its owner's twin, through a normal twin run (so approvals, tool policy,
// audit and the read scope all apply). These helpers are pure and safe to
// import from client components; the routes and UI do the I/O.

/** The custom MCP server the dev team's Roomate is connected through. */
export const ROOMATE_SERVER_NAME = "roomate";

type ServerLike = { name?: unknown; enabled?: unknown; url?: unknown };

/** True when an enabled org-wide custom MCP server named Roomate (any case) exists. */
export function roomateAvailable(servers: readonly ServerLike[]): boolean {
  return servers.some(
    (s) =>
      s.enabled === true &&
      typeof s.url === "string" &&
      s.url.trim() !== "" &&
      typeof s.name === "string" &&
      s.name.trim().toLowerCase() === ROOMATE_SERVER_NAME,
  );
}

export type MeetingPerson = { id: string; name: string };

type TurnLike = { kind: string; employeeId?: string; employeeName?: string };

/**
 * Everyone who can own a meeting action: the twins in the room plus any twin
 * who spoke (an @-tagged twin can be given an action without being a
 * participant). Deleted twins ("[deleted]") are left out.
 */
export function meetingPeople(participants: readonly MeetingPerson[], transcript: readonly TurnLike[]): MeetingPerson[] {
  const out = new Map<string, MeetingPerson>();
  for (const p of participants) if (p.id && !out.has(p.id)) out.set(p.id, p);
  for (const t of transcript) {
    if (t.kind !== "twin" || !t.employeeId || t.employeeId === "[deleted]" || out.has(t.employeeId)) continue;
    out.set(t.employeeId, { id: t.employeeId, name: t.employeeName || t.employeeId });
  }
  return [...out.values()];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^@/, "");

/**
 * The employee id that owns an action, from the meeting's people: by id
 * first, then by name (case-insensitive, full name or first name), since an
 * older or hand-edited summary may name the owner instead of giving an id.
 * Null when nobody matches, so the UI asks who should file it.
 */
export function resolveActionOwner(
  owner: string | undefined | null,
  people: readonly MeetingPerson[],
): string | null {
  if (!owner || !owner.trim()) return null;
  const byId = people.find((p) => p.id === owner);
  if (byId) return byId.id;
  const want = norm(owner);
  const byName = people.find((p) => norm(p.name) === want) ?? people.find((p) => norm(p.name).split(/\s+/)[0] === want);
  return byName?.id ?? null;
}

const TASK_ID_RE = /(?<![A-Za-z0-9_])tsk_[A-Za-z0-9]{4,64}(?![A-Za-z0-9_])/;

/** The first Roomate task id (tsk_…) a twin's reply mentions, or null. */
export function extractTaskId(text: string | undefined | null): string | null {
  return text ? (TASK_ID_RE.exec(text)?.[0] ?? null) : null;
}

/** True for a value that looks like a Roomate task id, nothing else around it. */
export function isTaskId(value: unknown): value is string {
  return typeof value === "string" && extractTaskId(value) === value;
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** The question the owner's twin is asked to file one action item. */
export function buildFilingPrompt(args: { meetingId: string; title: string; action: string; decision?: string }): string {
  const title = flat(args.title) || "Untitled meeting";
  const decision = flat(args.decision ?? "");
  return (
    `From Team Meeting '${title}' (${args.meetingId}), file this action to the dev team following your ` +
    `'Filing work to the dev team (Roomate)' skill: ${flat(args.action).replace(/[.\s]+$/, "")}.` +
    (decision ? ` Context: ${decision}` : "") +
    `\n\nWhen it's filed, end your reply with the Roomate task id (tsk_…).`
  );
}
