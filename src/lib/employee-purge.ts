// Full deletion of one employee's data — what the consent screen promises.
//
// Removing data/employees/<id> alone leaves the twin's memory, chat runs,
// shifts, run logs, relay transcripts, feed items, routines, invites and audit
// inputs behind, plus live OAuth connections at Composio. purgeEmployee walks
// every place the app writes per-employee data and returns a report of what it
// removed. Keep PURGE_TARGETS in step with new dataDir() writers.

import "server-only";
import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";
import { listActiveRuns } from "./active-runs";
import { appendAuditEntry, redactEmployeeAudit, type AuditRedaction } from "./audit-log";
import { disconnectAllToolkits } from "./composio-client";
import { withSidecarLock } from "./sidecar-lock";
import { pseudonymFor } from "./audit-pseudonym";
import { listUsers } from "./auth/store";
import { redactEmployeeFromMeetings } from "./meeting-store";

export type PurgeStep = {
  target: string;
  /** removed = deleted, filtered = matching rows dropped from a shared file,
   *  absent = nothing there, error = could not complete. */
  status: "removed" | "filtered" | "absent" | "error";
  count?: number;
  error?: string;
};

export type PurgeReport = {
  employeeId: string;
  purgedAt: string;
  /** False when any step failed — the caller must surface it, not claim success. */
  complete: boolean;
  steps: PurgeStep[];
};

const ID_PATTERN = /^[a-z0-9_][a-z0-9_-]{1,63}$/;

export function isPurgeableId(id: string): boolean {
  return ID_PATTERN.test(id) && !id.includes("..");
}

function removePath(target: string, abs: string): PurgeStep {
  try {
    if (!fs.existsSync(abs)) return { target, status: "absent" };
    fs.rmSync(abs, { recursive: true, force: true });
    return { target, status: "removed" };
  } catch (err) {
    return { target, status: "error", error: message(err) };
  }
}

/** Remove every entry in `dir` whose name matches. */
function removeMatching(target: string, dir: string, match: (name: string) => boolean): PurgeStep {
  try {
    if (!fs.existsSync(dir)) return { target, status: "absent" };
    let count = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!match(name)) continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      count++;
    }
    return { target, status: count ? "removed" : "absent", count };
  } catch (err) {
    return { target, status: "error", error: message(err) };
  }
}

function writeAtomic(abs: string, content: string): void {
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, abs);
}

/** Drop JSONL rows that belong to the employee. */
function filterJsonl(target: string, abs: string, belongs: (row: Record<string, unknown>) => boolean): PurgeStep {
  try {
    if (!fs.existsSync(abs)) return { target, status: "absent" };
    const lines = fs.readFileSync(abs, "utf8").split("\n").filter(Boolean);
    const keep = lines.filter((line) => {
      try {
        return !belongs(JSON.parse(line) as Record<string, unknown>);
      } catch {
        return true;
      }
    });
    const count = lines.length - keep.length;
    if (count) writeAtomic(abs, keep.join("\n") + (keep.length ? "\n" : ""));
    return { target, status: count ? "filtered" : "absent", count };
  } catch (err) {
    return { target, status: "error", error: message(err) };
  }
}

/** Rewrite a JSON file (array or keyed object); `edit` returns rows removed. */
function editJson(target: string, abs: string, edit: (data: unknown) => number): PurgeStep {
  try {
    if (!fs.existsSync(abs)) return { target, status: "absent" };
    const data = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
    const count = edit(data);
    if (count) writeAtomic(abs, JSON.stringify(data, null, 2));
    return { target, status: count ? "filtered" : "absent", count };
  } catch (err) {
    return { target, status: "error", error: message(err) };
  }
}

function dropFromArray(field: string, id: string) {
  return (data: unknown): number => {
    if (!Array.isArray(data)) return 0;
    const before = data.length;
    const keep = data.filter((row) => (row as Record<string, unknown>)?.[field] !== id);
    data.splice(0, data.length, ...keep);
    return before - keep.length;
  };
}

function dropFromRecord(id: string) {
  return (data: unknown): number => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return 0;
    const record = data as Record<string, unknown>;
    let count = 0;
    for (const [key, value] of Object.entries(record)) {
      if (key === id || (value as Record<string, unknown>)?.employeeId === id) {
        delete record[key];
        count++;
      }
    }
    return count;
  };
}

/** skill-assignments.json: { skillId: employeeId[] } or { employeeId: skillId[] }. */
function dropFromAssignments(id: string) {
  return (data: unknown): number => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return 0;
    const record = data as Record<string, unknown>;
    let count = 0;
    for (const [key, value] of Object.entries(record)) {
      if (key === id) {
        delete record[key];
        count++;
      } else if (Array.isArray(value) && value.includes(id)) {
        record[key] = value.filter((v) => v !== id);
        count++;
      }
    }
    return count;
  };
}

/** slack-reply-rate.json is keyed "<employeeId>:<channel>". */
function dropKeysWithPrefix(prefix: string) {
  return (data: unknown): number => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return 0;
    const record = data as Record<string, unknown>;
    let count = 0;
    for (const key of Object.keys(record)) {
      if (key.startsWith(prefix)) {
        delete record[key];
        count++;
      }
    }
    return count;
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Relay handover runs are keyed by handover id; the start event names the subject. */
function relayRunBelongs(dir: string, id: string): boolean {
  try {
    const first = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").split("\n", 1)[0];
    return (JSON.parse(first) as { employeeId?: string }).employeeId === id;
  } catch {
    return false;
  }
}

function employeeNameFor(id: string): string | undefined {
  try {
    const sidecar = JSON.parse(fs.readFileSync(dataDir("employees", id, "employee.json"), "utf8")) as { name?: unknown };
    return typeof sidecar.name === "string" && sidecar.name.trim() ? sidecar.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Matches text that names the employee: their id or full name, whole-word. */
export function mentionsOf(id: string, name?: string): RegExp {
  const terms = [id, ...(name ? [name] : [])].map(escapeRegExp);
  return new RegExp(`(?<![\\w-])(?:${terms.join("|")})(?![\\w-])`, "i");
}

/** Drop lines of a plain-text file that match; delete the file if none remain. */
function filterTextLines(target: string, abs: string, match: RegExp): PurgeStep {
  try {
    if (!fs.existsSync(abs)) return { target, status: "absent" };
    const lines = fs.readFileSync(abs, "utf8").split("\n").filter(Boolean);
    const keep = lines.filter((line) => !match.test(line));
    const count = lines.length - keep.length;
    if (!keep.length) {
      fs.rmSync(abs, { force: true });
      return { target, status: count ? "removed" : "absent", count };
    }
    if (count) writeAtomic(abs, keep.join("\n") + "\n");
    return { target, status: count ? "filtered" : "absent", count };
  } catch (err) {
    return { target, status: "error", error: message(err) };
  }
}

const FORMER = "[former employee]";

/** Replace mentions in every string of a JSON value; true if any changed. */
function redactJsonStrings(value: unknown, match: RegExp): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const next = value.replace(match, FORMER);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = redactJsonStrings(v, match);
      changed ||= r.changed;
      return r.value;
    });
    return { value: out, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = redactJsonStrings(v, match);
      changed ||= r.changed;
      out[k] = r.value;
    }
    return { value: out, changed };
  }
  return { value, changed: false };
}

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(abs, keep));
    else if (keep(entry.name)) out.push(abs);
  }
  return out;
}

/**
 * Other twins' memory and profile files and the org brain can mention the
 * deleted employee by id or full name. Each mention becomes
 * "[former employee]"; a changed memory row loses its embedding (it encoded
 * the old text). Returns one step per store and the files touched.
 */
export function redactMentions(id: string, name: string | undefined): { steps: PurgeStep[]; files: string[] } {
  const match = new RegExp(mentionsOf(id, name).source, "gi");
  const touched: string[] = [];
  const stores: Array<{ target: string; files: string[] }> = [
    { target: "other twins' memory", files: filesUnder(dataDir("memory"), (n) => n.endsWith(".jsonl")) },
    { target: "other twins' profile files", files: filesUnder(dataDir("employees"), (n) => /\.(md|txt)$/i.test(n)) },
    { target: "org brain", files: filesUnder(dataDir("org-brain"), (n) => /\.(md|json|jsonl|txt)$/i.test(n)) },
  ];
  const steps = stores.map(({ target, files }): PurgeStep => {
    try {
      let count = 0;
      for (const file of files) {
        const raw = fs.readFileSync(file, "utf8");
        if (!mentionsOf(id, name).test(raw)) continue;
        let next: string;
        if (file.endsWith(".jsonl")) {
          next = raw.split("\n").map((line) => {
            if (!line) return line;
            try {
              const r = redactJsonStrings(JSON.parse(line), match);
              if (!r.changed) return line;
              const row = r.value as Record<string, unknown>;
              delete row.embedding;
              return JSON.stringify(row);
            } catch {
              return line.replace(match, FORMER);
            }
          }).join("\n");
        } else if (file.endsWith(".json")) {
          next = JSON.stringify(redactJsonStrings(JSON.parse(raw), match).value, null, 2);
        } else {
          next = raw.replace(match, FORMER);
        }
        if (next !== raw) {
          writeAtomic(file, next);
          touched.push(path.relative(dataDir(), file));
          count++;
        }
      }
      return { target, status: count ? "filtered" : "absent", count };
    } catch (err) {
      return { target, status: "error", error: message(err) };
    }
  });
  return { steps, files: touched };
}

function runIdsFor(id: string): Set<string> {
  const ids = new Set<string>();
  try {
    for (const line of fs.readFileSync(dataDir("task-history.jsonl"), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as { id?: unknown; runId?: unknown; employeeId?: unknown };
        if (row.employeeId !== id) continue;
        if (typeof row.id === "string") ids.add(row.id);
        if (typeof row.runId === "string") ids.add(row.runId);
      } catch { /* skip malformed rows */ }
    }
  } catch { /* no history yet */ }
  return ids;
}

/** Every on-disk location, except Composio and the audit log (handled apart). */
export function purgeLocalData(id: string): PurgeStep[] {
  if (!isPurgeableId(id)) throw new Error(`Refusing to purge invalid id "${id}"`);
  // Read the name before employees/<id> is removed: free-text stores mention
  // people by name, not id.
  const name = employeeNameFor(id);
  // Routine (rt_…) and work-item (wirun_…) run ids don't contain the employee
  // id, so collect this employee's run ids from task history first.
  const runIds = runIdsFor(id);
  // Run ids are "<kind>_<employeeId>_<timestamp>…"; match the employee slot
  // exactly so purging "bob" never touches "run_alice_…__consult_bob".
  const ownRun = new RegExp(`^[a-z]+_${escapeRegExp(id)}_\\d`);
  const runFile = (name: string) =>
    ownRun.test(name) || runIds.has(name.replace(/\.(ndjson|jsonl)$/, ""));
  const steps: PurgeStep[] = [
    removePath(`employees/${id}`, dataDir("employees", id)),
    removePath(`memory/${id}`, dataDir("memory", id)),
    removePath(`scratch/${id}`, dataDir("scratch", id)),
    removePath(`handovers/${id}`, dataDir("handovers", id)),
    removePath(`uploads/${id}`, dataDir("uploads", id)),
    removePath(`relay/transcripts/${id}.json`, dataDir("relay", "transcripts", `${id}.json`)),
    removeMatching("relay/<handover>", dataDir("relay"), (name) =>
      name.startsWith("hand_") && relayRunBelongs(dataDir("relay", name), id),
    ),
    removeMatching("shifts/", dataDir("shifts"), runFile),
    removeMatching("task-events/", dataDir("task-events"), runFile),
  ];

  const runLogs = dataDir("run-logs");
  if (fs.existsSync(runLogs)) {
    for (const surface of fs.readdirSync(runLogs)) {
      const dir = path.join(runLogs, surface);
      if (fs.statSync(dir).isDirectory()) steps.push(removeMatching(`run-logs/${surface}/`, dir, runFile));
    }
  }

  // What this person asked other twins (Ask and chat history rows carry the
  // asking user's id, not the employee id).
  const askers = new Set(listUsers().filter((u) => u.employeeId === id).map((u) => u.id));
  if (askers.size && fs.existsSync(dataDir("employees"))) {
    for (const other of fs.readdirSync(dataDir("employees"))) {
      if (other === id || other.startsWith(".")) continue;
      steps.push(
        filterJsonl(`employees/${other}/chat-history.jsonl`, dataDir("employees", other, "chat-history.jsonl"), (row) =>
          typeof row.askedBy === "string" && askers.has(row.askedBy),
        ),
      );
    }
  }

  steps.push(
    filterJsonl("task-history.jsonl", dataDir("task-history.jsonl"), (row) => row.employeeId === id),
    filterJsonl("org/feed.jsonl", dataDir("org", "feed.jsonl"), (row) =>
      (row.source as Record<string, unknown> | undefined)?.employeeId === id,
    ),
    editJson("routines.json", dataDir("routines.json"), dropFromArray("employeeId", id)),
    editJson("work-items.json", dataDir("work-items.json"), dropFromArray("assigneeEmployeeId", id)),
    editJson("invites.json", dataDir("invites.json"), dropFromArray("employeeId", id)),
    editJson("approvals-pending.json", dataDir("approvals-pending.json"), dropFromRecord(id)),
    editJson("active-runs.json", dataDir("active-runs.json"), dropFromRecord(id)),
    editJson("email-poll.json", dataDir("email-poll.json"), dropFromRecord(id)),
    editJson("active-builds.json", dataDir("active-builds.json"), dropFromRecord(id)),
    editJson("org/email-triggers.json", dataDir("org", "email-triggers.json"), dropFromRecord(id)),
    editJson("org/slack-triggers.json", dataDir("org", "slack-triggers.json"), dropFromRecord(id)),
    editJson("slack-poll.json", dataDir("slack-poll.json"), dropFromRecord(id)),
    editJson("slack-reply-rate.json", dataDir("slack-reply-rate.json"), dropKeysWithPrefix(`${id}:`)),
    editJson("org/skill-assignments.json", dataDir("org", "skill-assignments.json"), dropFromAssignments(id)),
    // Legacy meeting debug log (CEO questions + names). The app no longer
    // writes it and startup deletes it (legacy-cleanup.ts); if one survives,
    // drop only this employee's lines, never colleagues' entries.
    filterTextLines("council-debug.log", dataDir("council-debug.log"), mentionsOf(id, name)),
  );
  return steps;
}

/** Goals belong to the company: keep them, drop the owner link. */
async function unlinkGoals(id: string): Promise<PurgeStep> {
  return withSidecarLock("goals", async () =>
    editJson("goals.json", dataDir("goals.json"), (data) => {
      const goals = Array.isArray(data)
        ? data
        : Array.isArray((data as { goals?: unknown })?.goals)
          ? (data as { goals: unknown[] }).goals
          : [];
      let count = 0;
      for (const goal of goals as Record<string, unknown>[]) {
        if (goal?.ownerEmployeeId === id) {
          goal.ownerEmployeeId = null;
          count++;
        }
      }
      return count;
    }),
  );
}

export type PurgeReason = "deleted" | "consent_revoked";

export async function purgeEmployee(id: string, reason: PurgeReason = "deleted"): Promise<PurgeReport> {
  if (!isPurgeableId(id)) throw new Error(`Refusing to purge invalid id "${id}"`);
  const steps: PurgeStep[] = [];

  // Revoke OAuth first: the connection state lives in employees/<id>/, and
  // deleting the folder before revoking would leave live tokens behind.
  try {
    const removed = await disconnectAllToolkits(id);
    steps.push({ target: "composio connections", status: removed ? "removed" : "absent", count: removed });
  } catch (err) {
    steps.push({ target: "composio connections", status: "error", error: message(err) });
  }

  // Read before employees/<id> is removed, for the mention search.
  const name = employeeNameFor(id);
  await withSidecarLock(id, async () => {
    steps.push(...purgeLocalData(id));
  });
  steps.push(await unlinkGoals(id));

  // Live meetings belong to the company: blank this employee's turns, drop
  // their shared files.
  try {
    const { turns, files } = redactEmployeeFromMeetings(id);
    steps.push({ target: "meetings", status: turns || files ? "filtered" : "absent", count: turns + files });
  } catch (err) {
    steps.push({ target: "meetings", status: "error", error: message(err) });
  }

  const mentions = redactMentions(id, name);
  steps.push(...mentions.steps);

  // The audit log keeps a keyed-hash pseudonym instead of the name-derived id.
  const pseudonym = pseudonymFor(id);
  let redaction: AuditRedaction = { redactedIds: [], legacyPins: {} };
  try {
    redaction = redactEmployeeAudit(id, pseudonym);
    const count = redaction.redactedIds.length;
    steps.push({ target: "audit log inputs", status: count ? "filtered" : "absent", count });
  } catch (err) {
    steps.push({ target: "audit log inputs", status: "error", error: message(err) });
  }

  const complete = steps.every((s) => s.status !== "error");

  // The tombstone: proves the deletion happened and vouches for the redacted
  // rows (verifyAuditChain fails on a redacted row no tombstone lists).
  const recorded = appendAuditEntry({
    runId: `purge-${Date.now()}`,
    employeeId: pseudonym,
    employeeName: "[deleted]",
    toolName: "purgeEmployee",
    bareName: "purgeEmployee",
    input: {
      reason,
      redactedIds: redaction.redactedIds,
      legacyPins: redaction.legacyPins,
      complete,
      // Targets name per-employee paths: keep the pseudonym, not the slug.
      steps: steps.map(({ target, status, count }) => ({ target: target.split(id).join(pseudonym), status, count })),
      mentionsRedactedIn: mentions.files,
    },
    verdict: "executed",
  });
  // Without the purge record the redacted rows fail verification: report it.
  if (!recorded) steps.push({ target: "audit purge record", status: "error", error: "could not write" });

  return {
    employeeId: id,
    purgedAt: new Date().toISOString(),
    complete: steps.every((s) => s.status !== "error"),
    steps,
  };
}

/** Runs still writing for this employee. Purging under them would let them
 *  recreate files (run logs, memory, routines) right after the deletion. */
export function runningWorkFor(id: string): { runId: string; label: string; startedAt: string }[] {
  // A run that started more than two hours ago is a stale registry entry.
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  return listActiveRuns({ employeeId: id })
    .filter((run) => Date.parse(run.startedAt) > cutoff)
    .map(({ runId, label, startedAt }) => ({ runId, label, startedAt }));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
