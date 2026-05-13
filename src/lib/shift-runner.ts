import path from "path";
import fs from "fs";
import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { EmployeeWithTwin } from "@/lib/employees";
import { buildEmployeeMcpServer } from "@/lib/composio-client";
import { loadOrgCustomMcpServers } from "@/lib/custom-mcp";
import { classifyTool } from "@/lib/tool-policy";
import { appendAuditEntry } from "@/lib/audit-log";
import { readShiftLog } from "@/lib/shift-log";
import { ShiftReport, SHIFT_REPORT_JSON_SCHEMA } from "@/lib/shift-schema";
import type { ShiftReportType } from "@/lib/shift-schema";
import { buildBaseOptions, buildTwinHooks } from "@/lib/sdk-defaults";
import { getTasksFor } from "@/lib/twin-tasks";
import { runPrefetches, formatFocusBlock } from "@/lib/twin-focus-prefetch";
import { appendFeedItem } from "@/lib/feed-store";
import { registerRun, updateRun, unregisterRun } from "@/lib/active-runs";
import { appendRunLog, logPathFor } from "@/lib/run-logs";
import { recordSpend } from "@/lib/twin-budget";

// ─── Return type ──────────────────────────────────────────────────────────────

export type ShiftRunResult = {
  report: ShiftReportType | null;
  summary: string;
  turns: number;
  costUsd: number;
  stoppedReason: "natural" | "max_budget" | "max_turns" | "error";
  runId: string;
};

// ─── Profile file loader (same list as council-runner) ────────────────────────

const PROFILE_FILE_NAMES = [
  "EXPERTISE.md",
  "TONE.md",
  "CONTEXT.md",
  "DECISIONS.md",
  "PREFERENCES.md",
  "PEOPLE.md",
  "PROJECTS.md",
  "BOUNDARIES.md",
  "EMPLOYMENT.md",
];

function loadProfileFiles(employeeDir: string): string {
  return PROFILE_FILE_NAMES.map((name) => {
    try {
      const content = fs.readFileSync(path.join(employeeDir, name), "utf8");
      return `### ${name}\n\n${content.trim()}`;
    } catch {
      return null;
    }
  })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPromptBlocks(
  employee: EmployeeWithTwin,
  employeeDir: string,
  trigger: "scheduled" | "manual" | "wakeup",
  focusBlock: string
): string[] {
  const profileContent = loadProfileFiles(employeeDir);

  const staticBlock = `You are the digital twin of ${employee.name}, ${employee.role} at Employee001 — an early-stage AI startup building a digital employee twin platform that lets CEOs chat with and delegate tasks to AI versions of their team.

You have been trained on ${employee.firstName}'s real working style, decisions, and expertise. You speak in ${employee.firstName}'s voice — with their tone, values, and reasoning.

# Your profile files (pre-loaded — do NOT call Read, Glob, or Grep)

${profileContent}

# Shift mode — autonomous run

You are running in autonomous shift mode. No CEO is present. Your job is to:
1. Review your shift state (context, decisions, learnings) below.
2. Use your MCP tools to take useful actions grounded in your role.
3. At the end, emit a structured ShiftReport. Every field is optional except \`summary\`.

**Rules for this shift:**
- Read before you write. Prefer read-only tools first.
- Do NOT send messages, emails, or post to external channels without a prior decision recorded in your shift log.
- Destructive or external-facing actions are automatically deferred to /flow for CEO review.
- Keep the summary to one short line: what actually happened, not what you planned.`;

  const shiftLog = readShiftLog(employee.id);

  const now = new Date();
  const nowBlock = `# Current date and time

- Today: **${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Jerusalem" })}** (Israel time)
- Local time: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem", hour12: false })} IST
- ISO (UTC): ${now.toISOString()}

Use this when reasoning about deadlines, scheduling, "tomorrow", overdue items, or anything time-sensitive. Do NOT make up dates from your training data.`;

  const shiftLogBlock = `# Your shift memory

## Context (recent)
${shiftLog.context || "(none yet)"}

## Decisions (recent)
${shiftLog.decisions || "(none yet)"}

## Learnings (recent)
${shiftLog.learnings || "(none yet)"}`;

  const pendingTasks = getTasksFor(employee.id, "pending");
  const inProgressTasks = getTasksFor(employee.id, "in_progress");
  const allTasks = [...inProgressTasks, ...pendingTasks];

  const tasksBlock =
    allTasks.length > 0
      ? `# Tasks for you (${allTasks.length})

You have the following tasks waiting. When you complete one, include it in \`tasksComplete[]\` in your ShiftReport with the result. You can also create new tasks for other twins via \`tasksCreate[]\`.

${allTasks
  .map((t) => {
    const ageMs = Date.now() - new Date(t.createdAt).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    const age =
      ageMin < 60
        ? `${ageMin}m ago`
        : ageMin < 1440
          ? `${Math.floor(ageMin / 60)}h ago`
          : `${Math.floor(ageMin / 1440)}d ago`;
    const desc = t.description ? `\n  ${t.description}` : "";
    return `- [${t.id}] **${t.title}** (priority ${t.priority}, ${t.status}, ${age}, from ${t.fromEmployeeId})${desc}`;
  })
  .join("\n")}`
      : `# Tasks for you

(no pending tasks — you can still create tasks for other twins via \`tasksCreate[]\` if helpful)`;

  const wakeupBlock =
    trigger === "wakeup"
      ? `# Catch-up note
This shift was delayed and is running as a catch-up. Lean toward summarising recent state rather than emitting many actions.`
      : "";

  const dynamicBlocks = [nowBlock, shiftLogBlock, focusBlock, tasksBlock, wakeupBlock].filter(Boolean);

  return [staticBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, ...dynamicBlocks];
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runShift(args: {
  employee: EmployeeWithTwin;
  trigger: "scheduled" | "manual" | "wakeup";
  abortController?: AbortController;
}): Promise<ShiftRunResult> {
  const { employee, trigger, abortController } = args;
  const runId = `shift_${employee.id}_${Date.now()}`;

  const employeeDir = path.join(process.cwd(), "data", "employees", employee.id);

  registerRun({
    runId,
    surface: "shift",
    employeeId: employee.id,
    employeeName: employee.name,
    label: `Shift (${trigger})`,
    startedAt: new Date().toISOString(),
    logPath: logPathFor("shift", runId),
  });
  appendRunLog("shift", runId, { type: "meta", message: `Shift started — trigger: ${trigger}` });

  let turns = 0;
  let costUsd = 0;
  let stoppedReason: ShiftRunResult["stoppedReason"] = "natural";
  let finalText = "";

  try {
    // Run prefetches in parallel with MCP setup. Prefetch failures degrade
    // gracefully — a missing focus block is fine, the shift still runs.
    const [composioMcp, orgMcpServers, focusResults] = await Promise.all([
      buildEmployeeMcpServer(employee.id),
      loadOrgCustomMcpServers(),
      runPrefetches(employee.id).catch((err) => {
        console.warn("[shift-runner] focus prefetch failed:", err);
        return [];
      }),
    ]);
    const focusBlock = formatFocusBlock(focusResults);

    const mcpServers = {
      ...orgMcpServers,
      ...(composioMcp ? { composio: composioMcp } : {}),
    };
    const hasMcp = Object.keys(mcpServers).length > 0;

    // Pre-flight gate: a twin with ZERO MCP connections at all can't take any
    // real action. Don't burn LLM dollars discovering that — surface a
    // needs-review item to /inbox and skip the run.
    if (!hasMcp) {
      try {
        appendFeedItem({
          source: { kind: "shift", employeeId: employee.id, runId },
          type: "needs-review",
          title: `${employee.firstName} can't run shifts: no tools connected`,
          detail: `${employee.firstName}-twin has zero MCP connections (no Composio toolkits, no org-wide MCP servers), so this shift was skipped before the model ran ($0 spent). Connect at least one toolkit at /connections/${employee.id}.`,
          priority: 1,
        });
      } catch (err) {
        console.warn("[shift-runner] no-mcp feed item failed:", err);
      }
      appendRunLog("shift", runId, { type: "meta", message: "Skipped: no MCP connections" });
      unregisterRun(runId, { status: "complete", costUsd: 0 });
      return {
        report: null,
        summary: `Skipped: no MCP connections active for ${employee.firstName}.`,
        turns: 0,
        costUsd: 0,
        stoppedReason: "natural",
        runId,
      };
    }

    // Soft gate: the twin has org-wide MCPs (e.g. shared Supabase) but no
    // PERSONAL Composio connections. It can still run on shared infra, but
    // can't act AS the real employee on their Slack/Gmail/GitHub/etc. Post a
    // lower-priority flag so the CEO knows the twin is operating with one
    // hand tied; let the shift continue.
    if (!composioMcp) {
      try {
        appendFeedItem({
          source: { kind: "shift", employeeId: employee.id, runId },
          type: "needs-review",
          title: `${employee.firstName} has no personal toolkits connected`,
          detail: `${employee.firstName}-twin will run this shift on org-wide MCP servers only. No personal Slack/Gmail/GitHub/Linear etc. — the twin can't act AS ${employee.firstName} on real systems until you connect at least one personal toolkit at /connections/${employee.id}.`,
          priority: 3,
        });
      } catch (err) {
        console.warn("[shift-runner] no-personal-mcp feed item failed:", err);
      }
    }

    const canUseTool: CanUseTool = async (
      toolName,
      input
    ): Promise<PermissionResult> => {
      const typedInput = (input as Record<string, unknown>) ?? {};
      const decision = classifyTool(toolName, typedInput);
      const bare = toolName.replace(/^mcp__[a-z0-9_]+__/i, "");

      if (decision.kind === "allow") {
        return { behavior: "allow", updatedInput: input };
      }

      if (decision.kind === "block") {
        appendAuditEntry({
          runId,
          employeeId: employee.id,
          employeeName: employee.name,
          toolName,
          bareName: bare,
          input: typedInput,
          verdict: "hard_blocked",
          blockReason: decision.reason,
        });
        return { behavior: "deny", message: decision.reason };
      }

      // "ask" in shift mode → deny immediately; tell the model WHY and what to do
      appendAuditEntry({
        runId,
        employeeId: employee.id,
        employeeName: employee.name,
        toolName,
        bareName: bare,
        input: typedInput,
        verdict: "deferred_to_flow",
      });
      return {
        behavior: "deny",
        message:
          `${decision.reason} — This action requires CEO approval and cannot run in unattended shift mode. ` +
          `Do not retry. Instead, note the intended action in your ShiftReport under "pending_actions" so the CEO can approve it later.`,
      };
    };

    const baseOptions = buildBaseOptions({
      surface: "routine",
      abortController,
      runId,
      employeeId: employee.id,
    });

    const hooks = buildTwinHooks({
      runId,
      employeeId: employee.id,
      employeeName: employee.name,
      surface: "routine",
    });

    const stream = query({
      prompt: `Run your shift. Use your MCP tools as needed, then emit a ShiftReport.`,
      options: {
        ...baseOptions,
        cwd: employeeDir,
        systemPrompt: buildSystemPromptBlocks(employee, employeeDir, trigger, focusBlock),
        allowedTools: ["TodoWrite"],
        ...(hasMcp ? { mcpServers } : {}),
        maxTurns: 12,
        includePartialMessages: true,
        permissionMode: hasMcp ? "default" : "bypassPermissions",
        canUseTool: hasMcp ? canUseTool : undefined,
        outputFormat: {
          type: "json_schema",
          schema: SHIFT_REPORT_JSON_SCHEMA as Record<string, unknown>,
        },
        settingSources: [],
        hooks,
      },
    });

    let toolCallCount = 0;
    let textBuf = "";
    const flushTextBuf = () => {
      if (!textBuf.trim()) {
        textBuf = "";
        return;
      }
      appendRunLog("shift", runId, { type: "text", text: textBuf });
      updateRun(runId, { lastText: textBuf.slice(-200) });
      textBuf = "";
    };

    for await (const message of stream) {
      if (message.type === "stream_event") {
        const event = message.event;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta" &&
          event.delta.text
        ) {
          finalText += event.delta.text;
          textBuf += event.delta.text;
          // Flush on sentence boundary so the cockpit gets readable chunks, not character-by-character.
          if (/[.!?\n]\s*$/.test(textBuf) && textBuf.length > 30) flushTextBuf();
        }
        continue;
      }

      if (message.type === "assistant") {
        flushTextBuf();
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            toolCallCount++;
            const bare = block.name.replace(/^mcp__[a-z0-9_]+__/i, "");
            appendRunLog("shift", runId, {
              type: "tool_use",
              tool: bare,
              input: block.input as Record<string, unknown>,
            });
            updateRun(runId, { toolCalls: toolCallCount, currentTool: bare });
          }
        }
        continue;
      }

      if (message.type === "user") {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_result") {
              appendRunLog("shift", runId, { type: "tool_result", tool: "result" });
            }
          }
        }
        continue;
      }

      if (message.type === "result") {
        flushTextBuf();
        turns = message.num_turns ?? 0;
        costUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? 0;
        const subtype = (message as { subtype?: string }).subtype;
        if (subtype === "error_max_budget_usd") stoppedReason = "max_budget";
        else if (subtype === "error_max_turns") stoppedReason = "max_turns";
        else if (subtype === "error_max_structured_output_retries") {
          // Schema mismatch — log but treat as natural; caller falls back to finalText.
          console.warn(`[shift-runner] structured output exhausted retries for run ${runId}`);
        }

        const structured = (message as { structured_output?: unknown }).structured_output;
        const parsed = ShiftReport.safeParse(structured);
        if (parsed.success) {
          appendRunLog("shift", runId, {
            type: "done",
            summary: parsed.data.summary,
            costUsd,
            turns,
          });
          unregisterRun(runId, { status: "complete", costUsd });
          if (costUsd > 0) recordSpend(employee.id, costUsd);
          return {
            report: parsed.data,
            summary: parsed.data.summary,
            turns,
            costUsd,
            stoppedReason,
            runId,
          };
        }
      }
    }

    flushTextBuf();
    const fallbackSummary = finalText.trim().slice(0, 200) || "Shift completed";
    appendRunLog("shift", runId, {
      type: "done",
      summary: fallbackSummary,
      costUsd,
      turns,
    });
    unregisterRun(runId, {
      status: stoppedReason === "max_budget" || stoppedReason === "max_turns" ? "error" : "complete",
      costUsd,
    });
    if (costUsd > 0) recordSpend(employee.id, costUsd);
    return {
      report: null,
      summary: fallbackSummary,
      turns,
      costUsd,
      stoppedReason,
      runId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    appendRunLog("shift", runId, { type: "error", message });
    unregisterRun(runId, { status: "error", costUsd: 0 });
    return {
      report: null,
      summary: `Shift failed: ${message}`,
      turns: 0,
      costUsd: 0,
      stoppedReason: "error",
      runId,
    };
  }
}
