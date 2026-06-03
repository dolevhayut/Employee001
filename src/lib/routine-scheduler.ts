import {
  listRoutines,
  updateRoutine,
  computeNextRun,
  type Routine,
  type RoutineRunStatus,
} from "@/lib/routines";
import { isUnderBudget } from "@/lib/twin-budget";
import { runSingleTwin, type CouncilEvent } from "@/lib/council-runner";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { runShift } from "@/lib/shift-runner";
import { appendFeedItem } from "@/lib/feed-store";
import { registerRun, updateRun, unregisterRun } from "@/lib/active-runs";
import { appendRunLog, logPathFor } from "@/lib/run-logs";

const TICK_MS = 30_000; // check every 30s

// Avoid double-firing across hot reloads in dev
type GlobalWithScheduler = typeof globalThis & {
  __routineScheduler?: { interval: ReturnType<typeof setInterval>; running: Set<string> };
};

function getState(): { interval: ReturnType<typeof setInterval> | null; running: Set<string> } {
  const g = globalThis as GlobalWithScheduler;
  if (!g.__routineScheduler) {
    g.__routineScheduler = { interval: null as unknown as ReturnType<typeof setInterval>, running: new Set() };
  }
  return g.__routineScheduler!;
}

export function ensureSchedulerStarted(): void {
  const state = getState();
  if (state.interval) return;
  state.interval = setInterval(tick, TICK_MS);
  // Fire once immediately so a routine due "now" doesn't wait the full tick.
  setTimeout(tick, 1000);
  // Catch up any runs that should have fired while the process was down.
  // 2s delay lets the boot sequence settle before we kick off shifts.
  setTimeout(catchUpMissed, 2000);
}

function tick(): void {
  const now = Date.now();
  const routines = listRoutines();
  for (const r of routines) {
    if (!r.enabled) continue;
    if (!r.nextRunAt) continue;
    if (new Date(r.nextRunAt).getTime() > now) continue;
    void fireRoutine(r, "scheduled");
  }
}

// Why >60s grace: a routine that just fired and hasn't yet updated its
// nextRunAt (race with the in-flight write) shouldn't be considered "missed"
// on a fast restart. Anything truly missed is at least 1 minute late.
const CATCH_UP_GRACE_MS = 60_000;

function catchUpMissed(): void {
  const now = Date.now();
  const routines = listRoutines();
  for (const r of routines) {
    if (!r.enabled) continue;
    if (!r.nextRunAt) continue;
    const due = new Date(r.nextRunAt).getTime();
    if (due >= now - CATCH_UP_GRACE_MS) continue;
    console.log(
      `[scheduler] catch-up: firing ${r.id} (nextRunAt=${r.nextRunAt}, ${Math.floor((now - due) / 60_000)} min late)`
    );
    void fireRoutine(r, "wakeup");
  }
}

export async function fireRoutine(
  r: Routine,
  trigger: "scheduled" | "manual" | "wakeup"
): Promise<RoutineRunStatus> {
  const state = getState();
  if (state.running.has(r.id)) return "error";
  state.running.add(r.id);

  // Mark next-run forward immediately so concurrent ticks don't re-fire.
  // Same logic for wakeup: it's a missed scheduled fire, advance the cursor.
  if (trigger === "scheduled" || trigger === "wakeup") {
    const nextRunAt = computeNextRun(r.schedule).toISOString();
    updateRoutine(r.id, { nextRunAt });
  }

  const fromDisk = await loadEmployeesFromDisk();
  const roster = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  const employee = roster.find((e) => e.id === r.employeeId);
  if (!employee) {
    state.running.delete(r.id);
    updateRoutine(r.id, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "error",
      lastRunSummary: "Employee not found",
    });
    return "error";
  }

  // Budget pre-flight: shift-kind routines only. If the twin is out of budget
  // for today, skip the run and post a feed item instead of burning tokens.
  if (r.kind === "shift" && !isUnderBudget(employee.id)) {
    try {
      const { appendFeedItem } = await import("@/lib/feed-store");
      appendFeedItem({
        source: { kind: "shift", employeeId: employee.id, runId: `budget_${Date.now()}` },
        type: "needs-review",
        title: `${employee.firstName} is over daily budget — shift skipped`,
        detail: `${employee.firstName}-twin has spent its daily budget and won't run again until midnight (Israel time). Raise the limit at /budgets if needed.`,
        priority: 2,
      });
    } catch { /* best-effort */ }
    state.running.delete(r.id);
    updateRoutine(r.id, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "skipped",
      lastRunSummary: "Skipped: daily budget exhausted",
    });
    return "skipped";
  }

  let textOut = "";
  let denied = false;
  let errored = false;
  let toolCallCount = 0;
  let costAccrued = 0;

  // Only register a Cockpit run for task-kind routines — shift-kind routines
  // delegate to runShift() which registers its own shift card.
  const cockpitRunId = r.kind !== "shift" ? `rtrun_${r.id}_${Date.now()}` : null;
  if (cockpitRunId) {
    registerRun({
      runId: cockpitRunId,
      surface: "routine",
      employeeId: employee.id,
      employeeName: employee.name,
      label: r.name,
      startedAt: new Date().toISOString(),
      logPath: logPathFor("routine", cockpitRunId),
    });
    appendRunLog("routine", cockpitRunId, {
      type: "meta",
      message: `Routine "${r.name}" started — trigger: ${trigger}`,
    });
  }

  let textBuf = "";
  const flushTextBuf = () => {
    if (!cockpitRunId || !textBuf.trim()) {
      textBuf = "";
      return;
    }
    appendRunLog("routine", cockpitRunId, { type: "text", text: textBuf });
    updateRun(cockpitRunId, { lastText: textBuf.slice(-200) });
    textBuf = "";
  };

  const onEvent = (evt: CouncilEvent) => {
    if (evt.type === "text_delta") {
      textOut += evt.delta;
      if (cockpitRunId) {
        textBuf += evt.delta;
        if (/[.!?\n]\s*$/.test(textBuf) && textBuf.length > 30) flushTextBuf();
      }
    }
    if (evt.type === "tool_use" && cockpitRunId) {
      flushTextBuf();
      toolCallCount++;
      const bare = evt.tool.replace(/^mcp__[a-z0-9_]+__/i, "");
      appendRunLog("routine", cockpitRunId, { type: "tool_use", tool: bare, input: evt.input as Record<string, unknown> });
      updateRun(cockpitRunId, { toolCalls: toolCallCount, currentTool: bare });
    }
    if (evt.type === "tool_result" && cockpitRunId) {
      appendRunLog("routine", cockpitRunId, { type: "tool_result", tool: evt.tool });
    }
    if (evt.type === "tool_approval_resolved") {
      if (evt.decision === "deny") denied = true;
      if (cockpitRunId) {
        appendRunLog("routine", cockpitRunId, {
          type: "approval",
          tool: "(approval)",
          decision: evt.decision,
        });
      }
    }
    if (evt.type === "tool_blocked") {
      denied = true;
      if (cockpitRunId) {
        appendRunLog("routine", cockpitRunId, { type: "meta", message: `Blocked: ${evt.tool} — ${evt.reason}` });
      }
    }
    if (evt.type === "employee_error") {
      errored = true;
      if (cockpitRunId) {
        appendRunLog("routine", cockpitRunId, { type: "error", message: evt.message });
      }
    }
    if (evt.type === "employee_done") {
      costAccrued = evt.costUsd ?? 0;
      if (cockpitRunId) {
        updateRun(cockpitRunId, { costUsd: costAccrued });
      }
    }
  };

  let shiftRunId: string | undefined;
  try {
    if (r.kind === "shift") {
      const result = await runShift({
        employee,
        trigger,
      });
      textOut = result.summary;
      shiftRunId = result.runId;
      if (result.stoppedReason === "error") errored = true;
    } else {
      await runSingleTwin(employee, r.task, onEvent, [], {
        surface: "background",
        context: { type: "routine", routineId: r.id, routineName: r.name },
      });
    }
  } catch {
    errored = true;
  }

  if (cockpitRunId) {
    flushTextBuf();
    appendRunLog("routine", cockpitRunId, {
      type: "done",
      summary: textOut.trim().slice(0, 200) || "Routine completed",
      costUsd: costAccrued,
    });
    unregisterRun(cockpitRunId, {
      status: errored ? "error" : denied ? "complete" : "complete",
      costUsd: costAccrued,
    });
  }

  const status: RoutineRunStatus = errored
    ? "error"
    : denied
    ? "denied"
    : "ok";

  const summary = textOut.trim() || (
    status === "error" ? "Run failed" :
    status === "denied" ? "Action was declined" : "Completed"
  );

  updateRoutine(r.id, {
    lastRunAt: new Date().toISOString(),
    lastRunStatus: status,
    lastRunSummary: summary,
    ...(shiftRunId ? { lastRunId: shiftRunId } : {}),
  });

  // CEO visibility: every routine run lands in /inbox. Skip shift-kind because
  // the dispatcher already wrote a feed item from the structured ShiftReport.
  if (r.kind !== "shift") {
    const runId = `rt_${r.id}_${Date.now()}`;
    const feedType =
      status === "error"
        ? "alert"
        : status === "denied"
          ? "update"
          : "update";
    const titlePrefix =
      status === "error"
        ? "Routine failed"
        : status === "denied"
          ? "Routine declined"
          : "Routine completed";
    try {
      appendFeedItem({
        source: {
          kind: "routine",
          employeeId: r.employeeId,
          runId,
          routineId: r.id,
          routineName: r.name,
        },
        type: feedType,
        title: `${titlePrefix}: ${r.name}`,
        detail: summary.length > 600 ? summary.slice(0, 580) + "…" : summary,
        priority: status === "error" ? 2 : 3,
      });
    } catch (err) {
      console.warn("[scheduler] feed append failed", err);
    }
  }

  state.running.delete(r.id);
  return status;
}
