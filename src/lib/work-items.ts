import fs from "fs";
import path from "path";

// Durable work queue — the EmployeeX work plane, file-backed like everything
// else in this repo. A WorkItem is a unit of unattended work (an inbound
// email, a queued task) that survives process restarts: state lives in
// data/work-items.json, never only in memory.
//
// Reliability model (small-scale, single-process, but honest):
//   - enqueue is idempotent: same idempotencyKey → the existing item is
//     returned, nothing is duplicated (webhook/poller replays are safe).
//   - execution takes a LEASE with an expiry. A worker that dies mid-run
//     doesn't strand the item — the lease lapses and the next tick retries.
//   - attempts are bounded; an item that keeps failing parks as "failed"
//     with its last error, it never retries forever.

export type WorkItemType = "email" | "task";

export type WorkItemStatus =
  | "queued" // waiting for a worker
  | "leased" // a worker is on it (lease may lapse → re-queued implicitly)
  | "done"
  | "failed" // exhausted attempts; kept for the record + idempotency dedupe
  | "skipped"; // dropped intentionally (e.g. assignee gone)

export type EmailPayload = {
  messageId: string;
  threadId?: string;
  from?: string;
  subject?: string;
  date?: string;
  /** Plain-text body or preview — whatever the provider gave us. */
  body?: string;
};

export type WorkItem = {
  id: string;
  type: WorkItemType;
  assigneeEmployeeId: string;
  title: string;
  /** Email envelope for type "email"; free-form task text for type "task". */
  payload: EmailPayload | { task: string };
  idempotencyKey: string;
  status: WorkItemStatus;
  attemptCount: number;
  maxAttempts: number;
  leaseExpiresAt?: string;
  runId?: string;
  resultSummary?: string;
  createdAt: string;
  updatedAt: string;
};

const FILE = () => path.join(process.cwd(), "data", "work-items.json");
const LEASE_MS = 15 * 60 * 1000; // a run that outlives this is presumed dead
const DEFAULT_MAX_ATTEMPTS = 2;
// Terminal items older than this are pruned. The email poller only looks
// back 2 days, so a 7-day retention keeps idempotency dedupe airtight.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 500;

function load(): WorkItem[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return Array.isArray(raw) ? (raw as WorkItem[]) : [];
  } catch {
    return [];
  }
}

// Atomic tmp+rename so a crash mid-write never corrupts the queue.
function save(items: WorkItem[]): void {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

let _counter = 0;
function makeId(): string {
  _counter++;
  return `wi_${Date.now().toString(36)}_${_counter}`;
}

export function listWorkItems(filter?: { status?: WorkItemStatus }): WorkItem[] {
  const items = load();
  if (filter?.status) return items.filter((i) => i.status === filter.status);
  return items;
}

/** Idempotent enqueue: an existing item with the same key wins. */
export function enqueueWorkItem(input: {
  type: WorkItemType;
  assigneeEmployeeId: string;
  title: string;
  payload: WorkItem["payload"];
  idempotencyKey: string;
  maxAttempts?: number;
}): { item: WorkItem; deduped: boolean } {
  const items = load();
  const existing = items.find((i) => i.idempotencyKey === input.idempotencyKey);
  if (existing) return { item: existing, deduped: true };

  const now = new Date().toISOString();
  const item: WorkItem = {
    id: makeId(),
    type: input.type,
    assigneeEmployeeId: input.assigneeEmployeeId,
    title: input.title,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    status: "queued",
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    createdAt: now,
    updatedAt: now,
  };
  items.push(item);
  save(prune(items));
  return { item, deduped: false };
}

/**
 * Lease the next runnable item: oldest "queued", or a "leased" item whose
 * lease lapsed (dead worker). Increments the attempt counter; an item out
 * of attempts parks as "failed" instead of leasing again.
 */
export function leaseNextWorkItem(): WorkItem | null {
  const items = load();
  const now = Date.now();

  for (const item of items) {
    const lapsed =
      item.status === "leased" &&
      (!item.leaseExpiresAt || new Date(item.leaseExpiresAt).getTime() < now);
    if (item.status !== "queued" && !lapsed) continue;

    if (item.attemptCount >= item.maxAttempts) {
      item.status = "failed";
      item.resultSummary = item.resultSummary ?? "Exhausted attempts (lease lapsed repeatedly)";
      item.updatedAt = new Date().toISOString();
      continue;
    }

    item.status = "leased";
    item.attemptCount += 1;
    item.leaseExpiresAt = new Date(now + LEASE_MS).toISOString();
    item.updatedAt = new Date().toISOString();
    save(items);
    return item;
  }

  save(items); // persist any attempts-exhausted transitions found above
  return null;
}

export function completeWorkItem(id: string, summary: string, runId?: string): void {
  patch(id, { status: "done", resultSummary: summary.slice(0, 500), runId });
}

export function failWorkItem(id: string, error: string, runId?: string): void {
  const items = load();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  // Out of attempts → terminal. Otherwise back to queued for the next tick.
  const terminal = item.attemptCount >= item.maxAttempts;
  item.status = terminal ? "failed" : "queued";
  item.resultSummary = error.slice(0, 500);
  if (runId) item.runId = runId;
  item.leaseExpiresAt = undefined;
  item.updatedAt = new Date().toISOString();
  save(items);
}

export function skipWorkItem(id: string, reason: string): void {
  patch(id, { status: "skipped", resultSummary: reason });
}

/** Release a lease without consuming the attempt (e.g. budget gate). */
export function releaseWorkItem(id: string): void {
  const items = load();
  const item = items.find((i) => i.id === id);
  if (!item || item.status !== "leased") return;
  item.status = "queued";
  item.attemptCount = Math.max(0, item.attemptCount - 1);
  item.leaseExpiresAt = undefined;
  item.updatedAt = new Date().toISOString();
  save(items);
}

function patch(id: string, fields: Partial<WorkItem>): void {
  const items = load();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  Object.assign(item, fields, { updatedAt: new Date().toISOString() });
  save(items);
}

function prune(items: WorkItem[]): WorkItem[] {
  const cutoff = Date.now() - RETENTION_MS;
  const kept = items.filter((i) => {
    const terminal = i.status === "done" || i.status === "failed" || i.status === "skipped";
    return !terminal || new Date(i.updatedAt).getTime() >= cutoff;
  });
  // Hard cap as a backstop; drop the oldest terminal items first.
  if (kept.length > MAX_ITEMS) {
    const terminal = kept.filter((i) => i.status !== "queued" && i.status !== "leased");
    const active = kept.filter((i) => i.status === "queued" || i.status === "leased");
    terminal.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    return [...terminal.slice(-(MAX_ITEMS - active.length)), ...active];
  }
  return kept;
}
