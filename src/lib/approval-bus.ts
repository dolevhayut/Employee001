// Per-process registry of in-flight tool approval requests.
// The agent runner registers a Promise here when it hits a tool that needs
// CEO approval; the API route resolves that Promise when the user clicks
// Approve / Edit / Skip in the UI.

export type ApprovalDecision =
  | { action: "allow"; updatedInput?: Record<string, unknown> }
  | { action: "deny"; message?: string };

export type ApprovalSurface = "chat" | "background";

export type ApprovalContext = {
  type: "routine";
  routineId: string;
  routineName: string;
};

export type ApprovalRequest = {
  approvalId: string;
  runId: string;
  employeeId: string;
  employeeName?: string;
  toolName: string;
  bareName?: string;
  input: Record<string, unknown>;
  reason: string;
  createdAt: number;
  surface: ApprovalSurface;
  context?: ApprovalContext;
};

type Pending = {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
};

// Module-level singleton. In a multi-process deployment, swap for Redis or
// the realtime channel of your choice.
const PENDING = new Map<string, Pending>();

let counter = 0;
function makeId(): string {
  counter++;
  return `apr_${Date.now().toString(36)}_${counter}`;
}

/** Register a new pending approval. Returns the approval id + promise. */
export function registerApproval(
  request: Omit<ApprovalRequest, "approvalId" | "createdAt" | "surface"> & {
    surface?: ApprovalSurface;
  }
): { approvalId: string; promise: Promise<ApprovalDecision> } {
  const approvalId = makeId();
  let resolve!: (decision: ApprovalDecision) => void;
  const promise = new Promise<ApprovalDecision>((r) => {
    resolve = r;
  });
  PENDING.set(approvalId, {
    request: {
      ...request,
      surface: request.surface ?? "chat",
      approvalId,
      createdAt: Date.now(),
    },
    resolve,
  });
  return { approvalId, promise };
}

/** Snapshot of currently-pending approvals (no resolve fns). */
export function listPendingApprovals(filter?: {
  surface?: ApprovalSurface;
}): ApprovalRequest[] {
  const all = Array.from(PENDING.values()).map((p) => p.request);
  if (filter?.surface) return all.filter((r) => r.surface === filter.surface);
  return all;
}

/** Resolve an approval with the user's decision. No-op if expired or unknown. */
export function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision
): boolean {
  const entry = PENDING.get(approvalId);
  if (!entry) return false;
  PENDING.delete(approvalId);
  entry.resolve(decision);
  return true;
}

// Auto-clean stale approvals (memory hygiene + backstop so an awaiting runner
// never hangs forever). TTL is per-surface: a `chat` approval assumes the CEO
// is present right now, so it expires fast; a `background` approval comes from
// an unattended shift the CEO may not see for hours, so it waits much longer
// (the shift genuinely blocks on it — see shift-runner). On expiry we still
// resolve `deny` as a final backstop.
const CHAT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const BACKGROUND_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function ttlFor(surface: ApprovalSurface): number {
  return surface === "background" ? BACKGROUND_TTL_MS : CHAT_TTL_MS;
}

if (typeof globalThis !== "undefined") {
  // Avoid spawning multiple intervals in dev hot-reload
  type GlobalWithInterval = typeof globalThis & {
    __approvalSweep?: ReturnType<typeof setInterval>;
  };
  const g = globalThis as GlobalWithInterval;
  if (!g.__approvalSweep) {
    g.__approvalSweep = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of PENDING.entries()) {
        const ttl = ttlFor(entry.request.surface);
        if (now - entry.request.createdAt > ttl) {
          PENDING.delete(id);
          const mins = Math.round(ttl / 60_000);
          entry.resolve({
            action: "deny",
            message: `Approval timed out — no human response within ${mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins} minutes`}.`,
          });
        }
      }
    }, 60_000);
  }
}
