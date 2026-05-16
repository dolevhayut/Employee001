import { NextRequest } from "next/server";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { runSingleTwin } from "@/lib/council-runner";
import type { CouncilEvent } from "@/lib/council-runner";
import {
  appendTaskRun,
  appendTaskEvent,
  updateTaskRun,
  type TaskEvent,
} from "@/lib/task-history";
import { appendFeedItem } from "@/lib/feed-store";
import { registerRun, updateRun, unregisterRun } from "@/lib/active-runs";
import { appendRunLog, logPathFor } from "@/lib/run-logs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const body = (await request.json()) as { task?: string };
  const task = body.task?.trim();

  if (!task) {
    return new Response(JSON.stringify({ error: "task is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fromDisk = await loadEmployeesFromDisk();
  const roster = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  const employee = roster.find((e) => e.id === id);
  if (!employee || !hasEmployeeFiles(employee.id)) {
    return new Response(
      JSON.stringify({ error: "employee not found or has no profile files" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  if (employee.twinStatus !== "ready") {
    return new Response(
      JSON.stringify({ error: "twin is not ready" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Generate a runId up-front so we can correlate audit entries, task run, and events.
  const runId = `run_${employee.id}_${Date.now()}`;
  const startMs = Date.now();

  // Default per-task budget cap. Generous enough for routine work that fans out
  // across 5-10 tools, tight enough to halt a runaway loop before it bills $$$.
  const DEFAULT_TASK_BUDGET_USD = 0.5;
  const budgetUsd = DEFAULT_TASK_BUDGET_USD;

  appendTaskRun({
    id: runId,
    employeeId: employee.id,
    employeeName: employee.name,
    task,
    startedAt: new Date(startMs).toISOString(),
    status: "running",
    toolCalls: 0,
    approvalsRequested: 0,
    approvalsApproved: 0,
    approvalsDenied: 0,
    blockedTools: 0,
    budgetUsd,
  });

  registerRun({
    runId,
    surface: "task",
    employeeId: employee.id,
    employeeName: employee.name,
    label: task.length > 80 ? task.slice(0, 80) + "…" : task,
    startedAt: new Date(startMs).toISOString(),
    logPath: logPathFor("task", runId),
  });
  appendRunLog("task", runId, { type: "meta", message: `Task started: ${task.slice(0, 120)}` });

  // Counters maintained as the run progresses.
  let toolCalls = 0;
  let approvalsRequested = 0;
  let approvalsApproved = 0;
  let approvalsDenied = 0;
  let blockedTools = 0;
  let finalText = "";
  let cockpitTextBuf = "";
  let cockpitThinkingBuf = "";
  let subagentCount = 0;
  let finalized = false; // set once we record terminal status (complete/error)

  // CEO visibility — every task run lands in /inbox at terminal state.
  // Helper kept inside the handler scope so it closes over runId/task/employee.
  const surfaceToFeed = (
    outcome: "complete" | "error" | "aborted",
    extra: { errorMessage?: string; finalText?: string } = {}
  ) => {
    const isErr = outcome === "error";
    const isAbort = outcome === "aborted";
    const titlePrefix = isErr
      ? "Task failed"
      : isAbort
        ? "Task aborted"
        : "Task completed";
    const taskPreview = task.length > 80 ? task.slice(0, 80) + "…" : task;
    const detailBody = isErr
      ? extra.errorMessage ?? "Task errored without a message."
      : (extra.finalText?.trim() || "(no output captured)");
    const detail = detailBody.length > 600 ? detailBody.slice(0, 580) + "…" : detailBody;
    try {
      appendFeedItem({
        source: { kind: "task-run", employeeId: employee.id, runId, task },
        type: isErr ? "alert" : "update",
        title: `${titlePrefix}: ${taskPreview}`,
        detail,
        priority: isErr ? 2 : 3,
      });
    } catch (err) {
      console.warn("[task-route] feed append failed", err);
    }
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller may be closed
        }
      };

      const persistEvent = (
        type: TaskEvent["type"],
        data: Record<string, unknown>
      ) => {
        appendTaskEvent(runId, {
          ts: Date.now() - startMs,
          type,
          data,
        });
      };

      const onEvent = (evt: CouncilEvent) => {
        switch (evt.type) {
          case "org_skill_recall":
            send({
              type: "skill_recall",
              skills: evt.skills,
              ts: evt.ts,
            });
            persistEvent("tool_use", {
              tool: "org_skill_recall",
              input: { skills: evt.skills },
            });
            break;
          case "org_brain_recall":
            send({
              type: "brain_recall",
              nodes: evt.nodes,
              ts: evt.ts,
            });
            persistEvent("tool_use", {
              tool: "org_brain_recall",
              input: { nodes: evt.nodes },
            });
            break;
          case "employee_start":
            send({
              type: "start",
              runId,
              employeeId: evt.employeeId,
              employeeName: evt.employeeName,
            });
            persistEvent("start", {
              employeeId: evt.employeeId,
              employeeName: evt.employeeName,
            });
            break;
          case "text_delta":
            finalText += evt.delta;
            send({ type: "text_delta", delta: evt.delta, ts: evt.ts });
            persistEvent("text_delta", { delta: evt.delta });
            // Cockpit: flush text on sentence boundary so the live feed is readable.
            cockpitTextBuf += evt.delta;
            if (/[.!?\n]\s*$/.test(cockpitTextBuf) && cockpitTextBuf.length > 30) {
              appendRunLog("task", runId, { type: "text", text: cockpitTextBuf });
              updateRun(runId, { lastText: cockpitTextBuf.slice(-200) });
              cockpitTextBuf = "";
            }
            break;
          case "thinking_delta":
            // Stream extended-thinking deltas to the cockpit's "thoughts"
            // channel. We keep only the trailing 200 chars in active-runs
            // so the JSON file stays small; the full thinking is in the
            // run-log JSONL for retrospective review.
            cockpitThinkingBuf += evt.delta;
            if (cockpitThinkingBuf.length > 60) {
              appendRunLog("task", runId, { type: "thinking", text: cockpitThinkingBuf });
              updateRun(runId, { lastThinking: cockpitThinkingBuf.slice(-200) });
              cockpitThinkingBuf = "";
            }
            break;
          case "artifact":
            send({
              type: "artifact",
              artifactId: evt.artifactId,
              payload: evt.payload,
              ts: evt.ts,
            });
            persistEvent("artifact", {
              artifactId: evt.artifactId,
              payload: evt.payload,
            });
            if (cockpitTextBuf.trim()) {
              appendRunLog("task", runId, { type: "text", text: cockpitTextBuf });
              cockpitTextBuf = "";
            }
            appendRunLog("task", runId, {
              type: "artifact",
              artifactId: evt.artifactId,
              payload: evt.payload,
            });
            updateRun(runId, { lastText: `Canvas: ${evt.payload.title}` });
            break;
          case "tool_use":
            toolCalls++;
            send({
              type: "tool_use",
              tool: evt.tool,
              input: evt.input,
              ts: evt.ts,
            });
            persistEvent("tool_use", {
              tool: evt.tool,
              input: evt.input as Record<string, unknown>,
            });
            {
              const bare = evt.tool.replace(/^mcp__[a-z0-9_]+__/i, "");
              if (cockpitTextBuf.trim()) {
                appendRunLog("task", runId, { type: "text", text: cockpitTextBuf });
                cockpitTextBuf = "";
              }
              appendRunLog("task", runId, {
                type: "tool_use",
                tool: bare,
                input: evt.input as Record<string, unknown>,
              });
              updateRun(runId, { toolCalls, currentTool: bare });
            }
            break;
          case "tool_result":
            send({ type: "tool_result", tool: evt.tool, ts: evt.ts });
            persistEvent("tool_result", { tool: evt.tool });
            appendRunLog("task", runId, { type: "tool_result", tool: evt.tool });
            break;
          case "subagent_spawn": {
            // Surface as a synthetic tool_use so existing UI/audit pipelines
            // pick it up. The "subagent:<type>" naming lets the UI render a
            // distinct badge (Sparks icon + label).
            toolCalls++;
            subagentCount++;
            const synth = `subagent:${evt.subagentType}`;
            send({
              type: "tool_use",
              tool: synth,
              input: { description: evt.description, label: evt.label },
              ts: evt.ts,
            });
            persistEvent("tool_use", {
              tool: synth,
              input: { description: evt.description, label: evt.label },
            });
            if (cockpitTextBuf.trim()) {
              appendRunLog("task", runId, { type: "text", text: cockpitTextBuf });
              cockpitTextBuf = "";
            }
            appendRunLog("task", runId, {
              type: "tool_use",
              tool: synth,
              input: { description: evt.description },
            });
            updateRun(runId, {
              toolCalls,
              currentTool: evt.label,
              subagentCount,
            });
            break;
          }
          case "tool_approval_request":
            approvalsRequested++;
            send({
              type: "tool_approval_request",
              approvalId: evt.approvalId,
              tool: evt.tool,
              label: evt.label,
              input: evt.input,
              reason: evt.reason,
              ts: evt.ts,
            });
            persistEvent("tool_approval_request", {
              approvalId: evt.approvalId,
              tool: evt.tool,
              label: evt.label,
              input: evt.input,
              reason: evt.reason,
            });
            break;
          case "tool_approval_resolved":
            if (evt.decision === "allow") approvalsApproved++;
            else approvalsDenied++;
            send({
              type: "tool_approval_resolved",
              approvalId: evt.approvalId,
              decision: evt.decision,
              ts: evt.ts,
            });
            persistEvent("tool_approval_resolved", {
              approvalId: evt.approvalId,
              decision: evt.decision,
            });
            break;
          case "tool_blocked":
            blockedTools++;
            send({
              type: "tool_blocked",
              tool: evt.tool,
              reason: evt.reason,
              ts: evt.ts,
            });
            persistEvent("tool_blocked", {
              tool: evt.tool,
              reason: evt.reason,
            });
            break;
          case "scratch_write_denied":
            send({
              type: "scratch_write_denied",
              reason: evt.reason,
              ts: evt.ts,
            });
            persistEvent("scratch_write_denied", { reason: evt.reason });
            break;
          case "employee_done":
            send({
              type: "done",
              confidence: evt.confidence,
              turns: evt.turns,
              costUsd: evt.costUsd,
              stoppedReason: evt.stoppedReason,
              ts: evt.ts,
            });
            persistEvent("done", {
              confidence: evt.confidence,
              turns: evt.turns,
              costUsd: evt.costUsd,
              stoppedReason: evt.stoppedReason,
            });
            finalized = true;
            updateTaskRun(runId, {
              // If the SDK halted us at the budget cap, surface that distinctly
              // even though the run technically "completed" cleanly.
              status: evt.stoppedReason === "max_budget" ? "error" : "complete",
              endedAt: new Date().toISOString(),
              finalText,
              toolCalls,
              approvalsRequested,
              approvalsApproved,
              approvalsDenied,
              blockedTools,
              confidence: evt.confidence,
              turns: evt.turns,
              costUsd: evt.costUsd,
              stoppedReason: evt.stoppedReason,
              ...(evt.stoppedReason === "max_budget"
                ? {
                    errorMessage: `Stopped at $${budgetUsd.toFixed(2)} budget cap`,
                  }
                : {}),
            });
            surfaceToFeed(
              evt.stoppedReason === "max_budget" ? "error" : "complete",
              evt.stoppedReason === "max_budget"
                ? { errorMessage: `Stopped at $${budgetUsd.toFixed(2)} budget cap` }
                : { finalText }
            );
            if (cockpitTextBuf.trim()) {
              appendRunLog("task", runId, { type: "text", text: cockpitTextBuf });
              cockpitTextBuf = "";
            }
            appendRunLog("task", runId, {
              type: "done",
              summary: finalText.trim().slice(0, 200) || "Task completed",
              costUsd: evt.costUsd,
              turns: evt.turns,
            });
            unregisterRun(runId, {
              status: evt.stoppedReason === "max_budget" ? "error" : "complete",
              costUsd: evt.costUsd ?? 0,
            });
            break;
          case "employee_error":
            send({ type: "error", message: evt.message });
            persistEvent("error", { message: evt.message });
            finalized = true;
            updateTaskRun(runId, {
              status: "error",
              endedAt: new Date().toISOString(),
              finalText,
              toolCalls,
              approvalsRequested,
              approvalsApproved,
              approvalsDenied,
              blockedTools,
              errorMessage: evt.message,
            });
            surfaceToFeed("error", { errorMessage: evt.message });
            appendRunLog("task", runId, { type: "error", message: evt.message });
            unregisterRun(runId, { status: "error", costUsd: 0 });
            break;
          default:
            break;
        }
      };

      try {
        await runSingleTwin(employee, task, onEvent, [], {
          surface: "chat",
          runId,
          maxBudgetUsd: budgetUsd,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "error", message });
        persistEvent("error", { message });
        finalized = true;
        updateTaskRun(runId, {
          status: "error",
          endedAt: new Date().toISOString(),
          finalText,
          toolCalls,
          approvalsRequested,
          approvalsApproved,
          approvalsDenied,
          blockedTools,
          errorMessage: message,
        });
        surfaceToFeed("error", { errorMessage: message });
        appendRunLog("task", runId, { type: "error", message });
        unregisterRun(runId, { status: "error", costUsd: 0 });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },

    cancel() {
      // Client closed the stream early. Only record "aborted" if we hadn't
      // already finalized — otherwise we'd overwrite a successful "complete".
      if (finalized) return;
      updateTaskRun(runId, {
        status: "aborted",
        endedAt: new Date().toISOString(),
        finalText,
        toolCalls,
        approvalsRequested,
        approvalsApproved,
        approvalsDenied,
        blockedTools,
      });
      surfaceToFeed("aborted", { finalText });
      appendRunLog("task", runId, { type: "meta", message: "Aborted by user" });
      unregisterRun(runId, { status: "aborted", costUsd: 0 });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
