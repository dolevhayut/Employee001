// Twin-to-twin consultation — lets a twin running an autonomous shift (or any
// runSingleTwin call) synchronously ask ANOTHER twin for advice, or request a
// decision/approval from them, mid-run.
//
// Fully local: the only external call is the Anthropic API the app already
// uses. A consultation is just a nested `runSingleTwin` invocation whose text
// is handed back to the asking twin as an MCP tool result.
//
// Loop safety mirrors the council delegation pattern (MAX_DELEGATION_ROUNDS +
// spokenThisRun in council-runner.ts): a shared `visited` set prevents the same
// twin being consulted twice in one run, and `depth/maxDepth` caps chain length.
//
// NOTE on the import cycle: this module imports `runSingleTwin` from
// council-runner, which (transitively, via consult-mcp) imports back here. The
// cycle is runtime-safe because every cross-module binding is used only inside
// async functions at call time, never during module initialisation.

import "server-only";
import type { EmployeeWithTwin } from "@/lib/employees";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { runSingleTwin } from "@/lib/council-runner";
import { appendRunLog } from "@/lib/run-logs";
import { appendFeedItem } from "@/lib/feed-store";
import type { RunSurface } from "@/lib/active-runs";

export type ConsultContext = {
  /** Current chain depth. The shift twin starts at 0; each hop increments. */
  depth: number;
  /** Hard cap on chain depth. At depth >= maxDepth, consult/approve is refused. */
  maxDepth: number;
  /** Twins already consulted in THIS run — shared (mutated) across the chain so
   *  the same twin is never consulted twice. Seeded with the requester. */
  visited: Set<string>;
  /** The original shift twin's id (the run owner). */
  requesterId: string;
  /** The original shift twin's first name — used in consultation prompts. */
  requesterName: string;
  /** The run id of the owning shift — consultations log under it for audit. */
  runId: string;
  /** Surface for run-log routing (e.g. "shift"). */
  surface: RunSurface;
  /** Ready twins available to consult, loaded once at run start. */
  roster: EmployeeWithTwin[];
};

/** Per-consultation dollar cap so a chain can't run away. */
const CONSULT_BUDGET_USD = 0.5;

/**
 * Build the root consultation context for a run. Loads the org roster from
 * disk once and seeds `visited` with the requester so a twin can't consult
 * itself (directly or via a chain that loops back).
 */
export async function createConsultContext(args: {
  requester: EmployeeWithTwin;
  runId: string;
  surface: RunSurface;
  maxDepth?: number;
}): Promise<ConsultContext> {
  const all = await loadEmployeesFromDisk().catch(() => [] as EmployeeWithTwin[]);
  const roster = all.filter((e) => e.twinStatus === "ready");
  return {
    depth: 0,
    maxDepth: args.maxDepth ?? 3,
    visited: new Set<string>([args.requester.id]),
    requesterId: args.requester.id,
    requesterName: args.requester.firstName,
    runId: args.runId,
    surface: args.surface,
    roster,
  };
}

/** The roster a twin at this point in the chain may still consult. */
export function availableTargets(ctx: ConsultContext): EmployeeWithTwin[] {
  return ctx.roster.filter((e) => !ctx.visited.has(e.id));
}

function findTarget(ctx: ConsultContext, targetId: string): EmployeeWithTwin | undefined {
  return ctx.roster.find((e) => e.id === targetId);
}

/** Context for the consulted twin — one hop deeper, same shared visited set. */
function childContext(ctx: ConsultContext): ConsultContext {
  return { ...ctx, depth: ctx.depth + 1 };
}

const noop = () => {};

/**
 * Synchronously consult another twin for advice. Returns the consulted twin's
 * answer as plain text (already framed for the asking twin to read). Never
 * throws — failures are returned as readable text so the asking twin can adapt.
 */
export async function consultTwin(
  targetId: string,
  question: string,
  ctx: ConsultContext
): Promise<string> {
  if (ctx.depth >= ctx.maxDepth) {
    return `Consultation refused: maximum consultation depth (${ctx.maxDepth}) reached. Decide with the input you already have.`;
  }
  const target = findTarget(ctx, targetId);
  if (!target) {
    const list = availableTargets(ctx)
      .map((e) => `${e.id} (${e.firstName}, ${e.role})`)
      .join("; ");
    return `No ready twin with id "${targetId}". Available to consult: ${list || "(none)"}.`;
  }
  if (ctx.visited.has(targetId)) {
    return `${target.firstName} has already been consulted in this run — don't ask them again. Decide with what you have.`;
  }

  ctx.visited.add(targetId);
  appendRunLog(ctx.surface, ctx.runId, {
    type: "meta",
    message: `consult → ${target.firstName} (depth ${ctx.depth + 1}): ${question.slice(0, 140)}`,
  });

  const prompt = `You are being consulted by ${ctx.requesterName}'s twin, who is running an autonomous shift and paused to get your input. This is a direct twin-to-twin consultation — no CEO is in the loop right now.

Their question:
${question}

Answer in your own voice as ${target.firstName}, grounded in your profile and expertise. Be concise and decisive — they will act on your input. If a specific colleague's input is genuinely required, you may use the consult_twin tool to ask them.`;

  const answer = await runSingleTwin(target, prompt, noop, [], {
    surface: "chat",
    consultMode: true,
    consultContext: childContext(ctx),
    maxBudgetUsd: CONSULT_BUDGET_USD,
    runId: `${ctx.runId}__consult_${target.id}_d${ctx.depth + 1}`,
  });

  const text = answer.trim() || "(no response)";
  appendRunLog(ctx.surface, ctx.runId, {
    type: "meta",
    message: `consult ← ${target.firstName}: ${text.slice(0, 140)}`,
  });

  return `${target.firstName} (${target.role}) says:\n\n${text}`;
}

export type ApprovalDecision = {
  decision: "approve" | "reject";
  reason: string;
  approverName: string;
};

/**
 * Request a decision/approval from another twin. The approver renders an
 * approve/reject verdict in-character; the verdict is also written to /inbox as
 * an `approval` feed item so the real human can review and override it.
 */
export async function requestApproval(
  approverId: string,
  what: string,
  context: string,
  ctx: ConsultContext
): Promise<ApprovalDecision> {
  if (ctx.depth >= ctx.maxDepth) {
    return {
      decision: "reject",
      reason: `Maximum consultation depth (${ctx.maxDepth}) reached — cannot escalate further. Treat as not approved.`,
      approverName: "system",
    };
  }
  const approver = findTarget(ctx, approverId);
  if (!approver) {
    const list = availableTargets(ctx)
      .map((e) => `${e.id} (${e.firstName}, ${e.role})`)
      .join("; ");
    return {
      decision: "reject",
      reason: `No ready twin with id "${approverId}". Available approvers: ${list || "(none)"}.`,
      approverName: "system",
    };
  }
  if (ctx.visited.has(approverId)) {
    return {
      decision: "reject",
      reason: `${approver.firstName} has already been engaged in this run — don't re-ask. Treat as not approved.`,
      approverName: approver.firstName,
    };
  }

  ctx.visited.add(approverId);
  appendRunLog(ctx.surface, ctx.runId, {
    type: "meta",
    message: `approval request → ${approver.firstName} (depth ${ctx.depth + 1}): ${what.slice(0, 140)}`,
  });

  const prompt = `${ctx.requesterName}'s twin is running an autonomous shift and is requesting your approval before proceeding. No CEO is in the loop right now — you are deciding as ${approver.firstName}, within your real authority and boundaries.

What they want to do:
${what}

Context they provided:
${context || "(none)"}

Make a call. Your response MUST begin with exactly one of these two lines:
DECISION: APPROVE
DECISION: REJECT

Then, on the following lines, give your reasoning in 1–3 sentences as ${approver.firstName}. If this crosses a hard boundary (compensation, legal, hiring, spend you can't authorise), REJECT and say it must go to the CEO.`;

  const raw = await runSingleTwin(approver, prompt, noop, [], {
    surface: "chat",
    consultMode: true,
    consultContext: childContext(ctx),
    maxBudgetUsd: CONSULT_BUDGET_USD,
    runId: `${ctx.runId}__approval_${approver.id}_d${ctx.depth + 1}`,
  });

  const text = raw.trim();
  const approved = /^\s*DECISION:\s*APPROVE/i.test(text);
  const decision: "approve" | "reject" = approved ? "approve" : "reject";
  // Reasoning is everything after the first line.
  const reason =
    text.replace(/^\s*DECISION:\s*(APPROVE|REJECT)\s*/i, "").trim() ||
    (approved ? "Approved." : "Rejected.");

  appendRunLog(ctx.surface, ctx.runId, {
    type: "meta",
    message: `approval ← ${approver.firstName}: ${decision.toUpperCase()} — ${reason.slice(0, 140)}`,
  });

  // Audit to /inbox so the human can see and override. Reuses the existing
  // `approval` feed source kind.
  try {
    appendFeedItem({
      source: {
        kind: "approval",
        employeeId: ctx.requesterId,
        runId: ctx.runId,
        toolName: "request_approval",
        input: { approverId, what, context, decision, reason },
      },
      type: "needs-review",
      title: `${approver.firstName} ${decision === "approve" ? "approved" : "rejected"}: ${what.slice(0, 60)}`,
      detail: `${ctx.requesterName}'s twin asked ${approver.firstName}'s twin to approve "${what}" during an autonomous shift.\n\nDecision: ${decision.toUpperCase()}\nReasoning: ${reason}\n\nThis was decided twin-to-twin. Override here if you disagree.`,
      priority: decision === "approve" ? 3 : 2,
    });
  } catch (err) {
    console.warn("[twin-consult] approval feed item failed", err);
  }

  return { decision, reason, approverName: approver.firstName };
}
