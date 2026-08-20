import fs from "fs";
import path from "path";
import type { ApprovalRequest } from "@/lib/approval-bus";

// Durable mirror of in-flight approvals. The approval-bus itself must stay
// an in-memory Promise registry (the resolver IS process state — it can't
// be serialized), so true resume-after-restart isn't possible without a
// checkpointing runtime. What CAN and MUST be durable is the *fact* that an
// approval was pending: before this file existed, a restart silently
// vaporized every pending approval — the run just disappeared and nobody
// was told. Now the bus write-throughs here, and on boot any records left
// on disk are ORPHANS from a dead process: we surface each one to /inbox
// ("this run was lost — re-run it") instead of losing them silently.
//
// No silent loss ≠ no loss. That honest gap closes when runs get real
// checkpoints; the feed item is the contract until then.

const FILE = () => path.join(process.cwd(), "data", "approvals-pending.json");

type StoreShape = Record<string, ApprovalRequest>;

function load(): StoreShape {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return raw && typeof raw === "object" ? (raw as StoreShape) : {};
  } catch {
    return {};
  }
}

function save(store: StoreShape): void {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function persistPendingApproval(request: ApprovalRequest): void {
  try {
    const store = load();
    store[request.approvalId] = request;
    save(store);
  } catch {
    // Durability is best-effort; never block the live approval flow on disk.
  }
}

export function removePendingApproval(approvalId: string): void {
  try {
    const store = load();
    if (!(approvalId in store)) return;
    delete store[approvalId];
    save(store);
  } catch {
    /* best-effort */
  }
}

/**
 * Called once per process boot (before any new approval registers): any
 * record still on disk belonged to a previous process — its run is gone.
 * Returns the orphans and clears the file; the caller surfaces them.
 */
export function drainOrphanedApprovals(): ApprovalRequest[] {
  try {
    const store = load();
    const orphans = Object.values(store);
    if (orphans.length > 0) save({});
    return orphans;
  } catch {
    return [];
  }
}
