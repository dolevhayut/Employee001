import { appendContext, appendDecision, appendLearning } from "@/lib/shift-log";
import { createTask, completeTask } from "@/lib/twin-tasks";
import { appendFeedItem } from "@/lib/feed-store";
import type { ShiftReportType } from "@/lib/shift-schema";

export type DispatchSummary = {
  contextUpdated: boolean;
  decisionsAppended: number;
  learningsAppended: number;
  feedLineWritten: boolean;
  tasksCreated: number;
  tasksCompleted: number;
  feedItemsAppended: number;
  deferred: {
    goalUpdates: number;
    tasksCreate: number;
    tasksComplete: number;
    feedItems: number;
    artifacts: number;
  };
};

export async function dispatchShiftReport(
  employeeId: string,
  runId: string,
  report: ShiftReportType,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    contextUpdated: false,
    decisionsAppended: 0,
    learningsAppended: 0,
    feedLineWritten: false,
    tasksCreated: 0,
    tasksCompleted: 0,
    feedItemsAppended: 0,
    deferred: {
      goalUpdates: 0,
      tasksCreate: 0,
      tasksComplete: 0,
      feedItems: 0,
      artifacts: 0,
    },
  };

  if (report.contextUpdate) {
    try {
      appendContext(employeeId, report.contextUpdate, runId);
      summary.contextUpdated = true;
    } catch (err) {
      console.warn("[shift-dispatcher] appendContext failed:", err);
    }
  }

  if (report.decisions?.length) {
    for (const entry of report.decisions) {
      try {
        appendDecision(employeeId, entry, runId);
        summary.decisionsAppended++;
      } catch (err) {
        console.warn("[shift-dispatcher] appendDecision failed:", err);
      }
    }
  }

  if (report.learnings?.length) {
    for (const entry of report.learnings) {
      try {
        appendLearning(employeeId, entry, runId);
        summary.learningsAppended++;
      } catch (err) {
        console.warn("[shift-dispatcher] appendLearning failed:", err);
      }
    }
  }

  try {
    appendFeedItem({
      source: { kind: "shift", employeeId, runId },
      type: "update",
      title: report.summary,
      priority: 3,
    });
    summary.feedLineWritten = true;
  } catch (err) {
    console.warn("[shift-dispatcher] feed write failed:", err);
  }

  if (report.goalUpdates?.length) {
    console.log("[shift-dispatcher] goalUpdates deferred to Wave B:", ...report.goalUpdates);
    summary.deferred.goalUpdates = report.goalUpdates.length;
  }

  if (report.tasksCreate?.length) {
    for (const t of report.tasksCreate) {
      if (t.toDepartmentId && !t.toTwinId) {
        console.log("[shift-dispatcher] tasksCreate with toDepartmentId deferred to Wave H:", t);
        summary.deferred.tasksCreate++;
        continue;
      }
      if (!t.toTwinId) {
        console.warn("[shift-dispatcher] tasksCreate missing toTwinId, skipping:", t);
        continue;
      }
      try {
        const created = createTask({
          fromEmployeeId: employeeId,
          toEmployeeId: t.toTwinId,
          title: t.title,
          description: t.description,
          priority: t.priority as 1 | 2 | 3 | 4 | 5,
          createdInRunId: runId,
        });
        summary.tasksCreated++;
        try {
          appendFeedItem({
            source: { kind: "twin-task", taskId: created.id, fromId: employeeId, toId: t.toTwinId },
            type: "task-handoff",
            title: `${employeeId} → ${t.toTwinId}: ${t.title}`,
            detail: t.description,
            priority: t.priority as 1 | 2 | 3 | 4 | 5,
          });
        } catch (err) {
          console.warn("[shift-dispatcher] task-handoff feed item failed:", err);
        }
      } catch (err) {
        console.warn("[shift-dispatcher] createTask failed:", err);
      }
    }
  }

  if (report.tasksComplete?.length) {
    for (const tc of report.tasksComplete) {
      try {
        const updated = completeTask(tc.taskId, tc.result, runId);
        if (updated) {
          summary.tasksCompleted++;
          try {
            appendFeedItem({
              source: { kind: "twin-task", taskId: updated.id, fromId: updated.fromEmployeeId, toId: updated.toEmployeeId },
              type: "task-handoff",
              title: `${updated.toEmployeeId} completed: ${updated.title}`,
              detail: tc.result,
              priority: 3,
            });
          } catch (err) {
            console.warn("[shift-dispatcher] task-completion feed item failed:", err);
          }
        } else {
          console.warn("[shift-dispatcher] tasksComplete: task not found:", tc.taskId);
        }
      } catch (err) {
        console.warn("[shift-dispatcher] completeTask failed:", err);
      }
    }
  }

  if (report.feedItems?.length) {
    for (const item of report.feedItems) {
      try {
        appendFeedItem({
          source: { kind: "shift", employeeId, runId },
          type: item.kind === "needs-review" ? "needs-review" : item.kind,
          title: item.title,
          detail: item.detail,
          priority: item.priority as 1 | 2 | 3 | 4 | 5,
        });
        summary.feedItemsAppended++;
      } catch (err) {
        console.warn("[shift-dispatcher] feedItems append failed:", err);
      }
    }
  }

  if (report.artifacts?.length) {
    console.log("[shift-dispatcher] artifacts deferred to Wave E:", ...report.artifacts);
    summary.deferred.artifacts = report.artifacts.length;
  }

  return summary;
}
