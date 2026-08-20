import { leaseNextWorkItem, completeWorkItem, failWorkItem, skipWorkItem, releaseWorkItem, type WorkItem, type EmailPayload } from "@/lib/work-items";
import { drainOrphanedApprovals } from "@/lib/approval-store";
import { runSingleTwin, type CouncilEvent } from "@/lib/council-runner";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { isUnderBudget } from "@/lib/twin-budget";
import { appendFeedItem } from "@/lib/feed-store";
import { registerRun, updateRun, unregisterRun } from "@/lib/active-runs";
import { appendRunLog, logPathFor } from "@/lib/run-logs";

// The EmployeeX work plane's executor. Each armed tick leases at most ONE
// work item and runs it to completion — serial on purpose: this is a
// single-operator local install, and one unattended twin run at a time
// keeps cost, approvals, and the Cockpit legible. The queue's lease/retry
// machinery (work-items.ts) is what makes crashing mid-run safe.
//
// Sensitive actions need no code here: the twin replies via its own Gmail
// tool call, which hits tool-policy → "ask" → approval-bus → /inbox. The
// dispatcher never sends anything itself.

const RUN_BUDGET_USD = 1.0; // per-work-item hard cap, enforced by the SDK

type GlobalWithDispatcher = typeof globalThis & {
  __workDispatcher?: { busy: boolean; recovered: boolean };
};

function getState(): { busy: boolean; recovered: boolean } {
  const g = globalThis as GlobalWithDispatcher;
  if (!g.__workDispatcher) g.__workDispatcher = { busy: false, recovered: false };
  return g.__workDispatcher;
}

/**
 * Boot-time honesty pass: approvals left on disk by a dead process are
 * surfaced to /inbox — their runs are gone and can't be resumed, but the
 * human must know work was dropped. Runs once per process.
 */
export function recoverOrphanedApprovals(): void {
  const state = getState();
  if (state.recovered) return;
  state.recovered = true;
  const orphans = drainOrphanedApprovals();
  for (const o of orphans) {
    try {
      appendFeedItem({
        source: { kind: "shift", employeeId: o.employeeId, runId: o.runId },
        type: "needs-review",
        title: `Approval lost in restart: ${o.bareName ?? o.toolName}`,
        detail:
          `${o.employeeName ?? o.employeeId} was waiting for approval on ${o.bareName ?? o.toolName} ` +
          `when the server restarted. That run is gone — nothing was sent or executed. ` +
          `Re-run the routine or task if the work still matters. Reason it asked: ${o.reason}`,
        priority: 2,
      });
    } catch {
      /* feed is best-effort */
    }
  }
  if (orphans.length > 0) {
    console.warn(`[dispatcher] surfaced ${orphans.length} orphaned approval(s) from previous process`);
  }
}

/** One dispatch pass. Fire-and-forget from the scheduler tick. */
export async function dispatchWorkTick(): Promise<void> {
  const state = getState();
  if (state.busy) return; // serial: one unattended run at a time
  const item = leaseNextWorkItem();
  if (!item) return;

  state.busy = true;
  try {
    await executeWorkItem(item);
  } finally {
    state.busy = false;
  }
}

async function executeWorkItem(item: WorkItem): Promise<void> {
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  const employee = roster.find((e) => e.id === item.assigneeEmployeeId);
  if (!employee) {
    skipWorkItem(item.id, "Assignee employee no longer exists");
    return;
  }

  // Budget gate releases the lease WITHOUT consuming an attempt — being out
  // of budget is the workspace's state, not the item's failure.
  if (!isUnderBudget(employee.id)) {
    releaseWorkItem(item.id);
    return;
  }

  const runId = `wirun_${item.id}_${Date.now()}`;
  registerRun({
    runId,
    surface: "routine",
    employeeId: employee.id,
    employeeName: employee.name,
    label: item.title,
    startedAt: new Date().toISOString(),
    logPath: logPathFor("routine", runId),
  });
  appendRunLog("routine", runId, {
    type: "meta",
    message: `Work item ${item.id} (${item.type}) started — attempt ${item.attemptCount}/${item.maxAttempts}`,
  });

  let textOut = "";
  let errored = false;
  let costUsd = 0;
  let toolCalls = 0;
  const onEvent = (evt: CouncilEvent) => {
    if (evt.type === "text_delta") textOut += evt.delta;
    if (evt.type === "tool_use") {
      toolCalls++;
      const bare = evt.tool.replace(/^mcp__[a-z0-9_]+__/i, "");
      appendRunLog("routine", runId, { type: "tool_use", tool: bare, input: evt.input as Record<string, unknown> });
      updateRun(runId, { toolCalls, currentTool: bare });
    }
    if (evt.type === "employee_error") {
      errored = true;
      appendRunLog("routine", runId, { type: "error", message: evt.message });
    }
    if (evt.type === "employee_done") {
      costUsd = evt.costUsd ?? 0;
    }
  };

  try {
    await runSingleTwin(employee, taskFor(item), onEvent, [], {
      surface: "background",
      runId,
      maxBudgetUsd: RUN_BUDGET_USD,
    });
  } catch (err) {
    errored = true;
    textOut = textOut || (err instanceof Error ? err.message : String(err));
  }

  appendRunLog("routine", runId, {
    type: "done",
    summary: textOut.trim().slice(0, 200) || "Work item processed",
    costUsd,
  });
  unregisterRun(runId, { status: errored ? "error" : "complete", costUsd });

  const summary = textOut.trim() || (errored ? "Run failed" : "Completed");
  if (errored) {
    failWorkItem(item.id, summary, runId);
  } else {
    completeWorkItem(item.id, summary, runId);
  }

  // Every unattended work item lands in /inbox — the CEO wasn't there.
  const willRetry = errored && item.attemptCount < item.maxAttempts;
  try {
    appendFeedItem({
      source: { kind: "routine", employeeId: employee.id, runId, routineId: item.id, routineName: item.title },
      type: errored ? "alert" : "update",
      title: `${errored ? (willRetry ? "Work item failed (will retry)" : "Work item failed") : "Work item done"}: ${item.title}`,
      detail: summary.length > 600 ? summary.slice(0, 580) + "…" : summary,
      priority: errored ? 2 : 3,
    });
  } catch {
    /* best-effort */
  }
}

function taskFor(item: WorkItem): string {
  if (item.type === "task") {
    return (item.payload as { task: string }).task;
  }
  const p = item.payload as EmailPayload;
  return [
    `An email arrived in your connected inbox and was routed to you as a work item.`,
    ``,
    `From: ${p.from ?? "(unknown sender)"}`,
    `Subject: ${p.subject ?? "(no subject)"}`,
    `Date: ${p.date ?? "(unknown)"}`,
    p.threadId ? `Gmail thread id: ${p.threadId}` : ``,
    `Gmail message id: ${p.messageId}`,
    ``,
    `--- Message ---`,
    p.body ?? "(body unavailable — fetch it with your Gmail tools using the message id)",
    `--- End ---`,
    ``,
    `Handle it as this role would:`,
    `1. If it clearly needs no reply (newsletter, notification, spam), say so briefly and stop.`,
    `2. Otherwise draft a reply grounded in your role knowledge. Search your knowledge first if the answer isn't obvious.`,
    `3. Send the reply with your Gmail tool (reply on the same thread when a thread id is present). Sending requires CEO approval — that's expected, request it.`,
    `4. If you're not confident this is yours to answer, do NOT reply — summarize what it needs and flag it for the CEO instead.`,
    `Keep the reply short, professional, and in the sender's language.`,
  ].join("\n");
}
