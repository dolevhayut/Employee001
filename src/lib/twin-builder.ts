// Autonomous "Twin Builder" agent — produces the 9 markdown profile files
// that ground a digital twin, by reading the employee's connected systems
// (Composio + org MCP) with full agentic loop. Read-only side effects.

import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { EmployeeWithTwin } from "@/lib/employees";
import {
  buildEmployeeMcpServer,
  readState as readComposioState,
} from "@/lib/composio-client";
import { loadOrgCustomMcpServers } from "@/lib/custom-mcp";
import { classifyTool } from "@/lib/tool-policy";
import {
  newBuildId,
  recordBuild,
  listBuilds,
  snapshotRootFile,
} from "@/lib/twin-versions";
import { buildBaseOptions, buildTwinHooks } from "@/lib/sdk-defaults";
import { registerRun, updateRun, unregisterRun } from "@/lib/active-runs";
import { appendRunLog, logPathFor } from "@/lib/run-logs";

// Re-export the client-safe types/constants so existing imports keep working.
import { TWIN_FILE_NAMES, type TwinFileName, type TwinBuilderEvent } from "./twin-builder-types";
export { TWIN_FILE_NAMES };
export type { TwinFileName, TwinBuilderEvent };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPLOYEE_DATA_DIR = (id: string) =>
  path.join(process.cwd(), "data", "employees", id);

function existingFiles(employeeId: string): TwinFileName[] {
  const dir = EMPLOYEE_DATA_DIR(employeeId);
  return TWIN_FILE_NAMES.filter((name) => {
    try {
      const stat = fs.statSync(path.join(dir, name));
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  });
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export type RunTwinBuilderArgs = {
  employee: EmployeeWithTwin;
  /** Free-form context the CEO captured at onboarding/profile time. */
  ceoContext?: string;
  onEvent: (event: TwinBuilderEvent) => void;
  /** Hard dollar cap for this build. Default $5. */
  maxBudgetUsd?: number;
  /**
   * When provided, the runner uses this id for the build manifest + version
   * snapshots. The route mints this *before* spawning so it can register the
   * build as "active" and write events.jsonl atomically. Defaults to a fresh
   * id when omitted.
   */
  buildId?: string;
  /**
   * When provided, calling `controller.abort()` cancels the in-flight SDK
   * loop and any background tool calls. Surface a Cancel button on top.
   */
  abortController?: AbortController;
};

export async function runTwinBuilder(args: RunTwinBuilderArgs): Promise<void> {
  const { employee, ceoContext, onEvent } = args;
  const start = Date.now();
  const ts = () => Date.now() - start;

  const employeeDir = EMPLOYEE_DATA_DIR(employee.id);
  await fsp.mkdir(employeeDir, { recursive: true });

  const [composioState, composioMcp, orgMcpServers] = await Promise.all([
    readComposioState(employee.id),
    buildEmployeeMcpServer(employee.id),
    loadOrgCustomMcpServers(),
  ]);

  const activeToolkits = Object.values(composioState.connections)
    .filter((c) => c.status === "ACTIVE")
    .map((c) => c.toolkit);

  onEvent({
    type: "start",
    employeeId: employee.id,
    activeToolkits,
    ts: ts(),
  });

  if (!composioMcp && Object.keys(orgMcpServers).length === 0) {
    onEvent({
      type: "error",
      message:
        "No connected systems. Connect at least one toolkit at /connections/" +
        employee.id +
        " before building the twin.",
      ts: ts(),
    });
    onEvent({
      type: "done",
      filesWritten: [],
      turns: 0,
      costUsd: 0,
      stoppedReason: "no_connections",
      ts: ts(),
    });
    return;
  }

  const mcpServers = {
    ...orgMcpServers,
    ...(composioMcp ? { composio: composioMcp } : {}),
  };

  const TWIN_FILE_SET = new Set<string>(TWIN_FILE_NAMES);
  const expectedDir = path.resolve(employeeDir);

  // Tool gate: sandbox Write to {employeeDir}/{KNOWN_NAME}.md, allow read-only
  // Composio/org tools, deny any external write the agent attempts.
  const canUseTool: CanUseTool = async (
    toolName,
    input
  ): Promise<PermissionResult> => {
    const typedInput = (input as Record<string, unknown>) ?? {};

    if (toolName === "Write") {
      const file =
        typeof typedInput.file_path === "string"
          ? (typedInput.file_path as string)
          : "";
      const abs = path.resolve(employeeDir, file);
      const filename = path.basename(abs);

      if (!abs.startsWith(expectedDir + path.sep) && abs !== expectedDir) {
        const reason = `Write blocked: ${file} is outside ${employeeDir}.`;
        onEvent({ type: "tool_blocked", tool: toolName, reason, ts: ts() });
        return { behavior: "deny", message: reason };
      }
      if (!TWIN_FILE_SET.has(filename)) {
        const reason = `Filename ${filename} is not one of the 9 twin profile files (${TWIN_FILE_NAMES.join(", ")}).`;
        onEvent({ type: "file_blocked", filename, reason, ts: ts() });
        return { behavior: "deny", message: reason };
      }
      const body =
        typeof typedInput.content === "string"
          ? (typedInput.content as string)
          : "";

      // Snapshot whatever's at root for this filename BEFORE the SDK
      // overwrites it, so the previous version is recoverable. Best-effort.
      try {
        snapshotRootFile(employee.id, filename as TwinFileName, "builder", {
          buildId,
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.warn(`[twin-versions] pre-write snapshot skipped: ${m}`);
      }

      onEvent({
        type: "file_writing",
        filename: filename as TwinFileName,
        content: body,
        ts: ts(),
      });
      // Force absolute path so the SDK writes exactly where we expect.
      return {
        behavior: "allow",
        updatedInput: { ...typedInput, file_path: abs },
      };
    }

    if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
      return { behavior: "allow", updatedInput: typedInput };
    }

    // Composio + org MCP — only allow read-only patterns.
    const decision = classifyTool(toolName, typedInput);
    if (decision.kind === "allow") {
      return { behavior: "allow", updatedInput: typedInput };
    }

    const reason =
      decision.kind === "block"
        ? decision.reason
        : `Twin builder is read-only — ${toolName} blocked. Use *_GET_* / *_LIST_* / *_SEARCH_* / *_FETCH_* / *_RETRIEVE_* / *_FIND_* / *_READ_* tools to gather evidence.`;
    onEvent({ type: "tool_blocked", tool: toolName, reason, ts: ts() });
    return { behavior: "deny", message: reason };
  };

  const present = existingFiles(employee.id);
  // Track per-file mtime so we emit `file_done` exactly when a file *changes*,
  // including rewrites of files that already existed before this run started.
  const lastSeenMtime = new Map<TwinFileName, number>();
  for (const name of TWIN_FILE_NAMES) {
    try {
      lastSeenMtime.set(
        name,
        fs.statSync(path.join(employeeDir, name)).mtimeMs
      );
    } catch {
      /* not present yet */
    }
  }
  const filesWrittenThisRun = new Set<TwinFileName>();

  const systemPrompt = buildBuilderSystemPrompt({
    employee,
    ceoContext,
    employeeDir,
    activeToolkits,
    orgMcpNames: Object.keys(orgMcpServers),
    existingFiles: present,
  });

  const buildId = args.buildId ?? newBuildId();
  const buildStartedAt = new Date();
  let turns = 0;
  let costUsd = 0;
  let stoppedReason: "max_budget" | "max_turns" | "natural" = "natural";
  let builderToolCalls = 0;
  let builderTextBuf = "";

  registerRun({
    runId: buildId,
    surface: "builder",
    employeeId: employee.id,
    employeeName: employee.name,
    label: `Build — ${employee.firstName}`,
    startedAt: buildStartedAt.toISOString(),
    logPath: logPathFor("builder", buildId),
  });
  appendRunLog("builder", buildId, { type: "meta", message: "Twin Builder started" });

  try {
    const baseOptions = buildBaseOptions({
      surface: "builder",
      abortController: args.abortController,
      runId: buildId,
      employeeId: employee.id,
      title: `Build for ${employee.name} — ${new Date().toISOString().slice(0, 10)}`,
    });

    const hooks = buildTwinHooks({
      runId: buildId,
      employeeId: employee.id,
      employeeName: employee.name,
      surface: "builder",
      onNotification: (n) => {
        // Surface SDK notifications (idle prompts, auth refresh, etc.) to
        // the build event stream so the CEO sees what's blocking.
        onEvent({
          type: "error",
          message: `[${n.kind}] ${n.title ? n.title + ": " : ""}${n.message}`,
          ts: ts(),
        });
      },
    });

    // Structured manifest: forces a typed quality summary at the end of the
    // build. Replaces the regex-parsed final line + gives CEOs a guaranteed
    // shape for the dashboard quality score.
    const manifestSchema = {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string", enum: [...TWIN_FILE_NAMES] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              sources: {
                type: "array",
                items: { type: "string" },
                description: "Toolkit + action names used as evidence (e.g. 'gmail.fetch_emails').",
              },
              summary: {
                type: "string",
                description: "One short sentence about what was learned.",
              },
            },
            required: ["filename", "confidence", "sources"],
          },
        },
        overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
        notes: {
          type: "string",
          description:
            "Free-form notes for the CEO: blockers, missing toolkits, suggestions.",
        },
      },
      required: ["files", "overallConfidence"],
    } as const;

    const stream = query({
      prompt: `Research ${employee.name} (${employee.role}) using the connected systems and write all 9 twin profile files into \`${employeeDir}\`. Begin by listing what's connected, then plan, then execute. Do not write a file until you have grounded evidence for it.`,
      options: {
        ...baseOptions,
        cwd: employeeDir,
        systemPrompt,
        allowedTools: ["Read", "Write", "Glob", "Grep", "TodoWrite"],
        mcpServers,
        // Bumped from 80 → 120: the HR-psychologist prompt requires deeper
        // multi-source cross-referencing (sent emails + Slack + calendar +
        // GitHub for one TONE.md alone). Budget cap still gates total cost.
        maxTurns: 120,
        maxBudgetUsd: args.maxBudgetUsd ?? 5,
        includePartialMessages: true,
        permissionMode: "default",
        canUseTool,
        settingSources: [],
        hooks,
        // Native SDK file checkpointing — replaces our manual snapshotRootFile
        // approach for *future* builds. We keep snapshotRootFile() in place
        // for the legacy version-store timeline while consumers migrate.
        enableFileCheckpointing: true,
        extraArgs: { "replay-user-messages": null },
        outputFormat: { type: "json_schema", schema: manifestSchema },
      },
    });

    for await (const message of stream) {
      if (message.type === "stream_event") {
        const event = message.event;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta" &&
          event.delta.text
        ) {
          onEvent({ type: "text_delta", delta: event.delta.text, ts: ts() });
          builderTextBuf += event.delta.text;
          if (/[.!?\n]\s*$/.test(builderTextBuf) && builderTextBuf.length > 40) {
            appendRunLog("builder", buildId, { type: "text", text: builderTextBuf });
            updateRun(buildId, { lastText: builderTextBuf.slice(-200) });
            builderTextBuf = "";
          }
        }
        continue;
      }

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            // Skip Write — already surfaced via `file_writing` from the gate.
            if (block.name === "Write") continue;
            onEvent({
              type: "tool_use",
              tool: block.name,
              input: block.input,
              ts: ts(),
            });
            builderToolCalls++;
            const bare = block.name.replace(/^mcp__[a-z0-9_]+__/i, "");
            if (builderTextBuf.trim()) {
              appendRunLog("builder", buildId, { type: "text", text: builderTextBuf });
              builderTextBuf = "";
            }
            appendRunLog("builder", buildId, { type: "tool_use", tool: bare });
            updateRun(buildId, { toolCalls: builderToolCalls, currentTool: bare });
          }
        }
        continue;
      }

      if (message.type === "user") {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              typeof block === "object" &&
              block !== null &&
              "type" in block &&
              block.type === "tool_result"
            ) {
              // After every tool result, re-scan disk for files that
              // changed since the last scan (catches rewrites too).
              for (const name of TWIN_FILE_NAMES) {
                try {
                  const stat = fs.statSync(path.join(employeeDir, name));
                  if (stat.isFile() && stat.size > 0) {
                    const prev = lastSeenMtime.get(name) ?? 0;
                    if (stat.mtimeMs > prev) {
                      lastSeenMtime.set(name, stat.mtimeMs);
                      filesWrittenThisRun.add(name);
                      onEvent({
                        type: "file_done",
                        filename: name,
                        sizeBytes: stat.size,
                        ts: ts(),
                      });
                    }
                  }
                } catch {
                  /* not yet on disk */
                }
              }
              appendRunLog("builder", buildId, { type: "tool_result", tool: "result" });
              onEvent({ type: "tool_result", tool: "result", ts: ts() });
            }
          }
        }
        continue;
      }

      if (message.type === "result") {
        turns = message.num_turns ?? 0;
        costUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? 0;
        const subtype = (message as { subtype?: string }).subtype;
        if (subtype === "error_max_budget_usd") stoppedReason = "max_budget";
        else if (subtype === "error_max_turns") stoppedReason = "max_turns";
        updateRun(buildId, { costUsd });

        // Surface the SDK-validated structured manifest if the agent produced
        // one. Best-effort: a missing/invalid manifest is non-fatal and we
        // fall back to the per-file disk reconciliation below.
        const structured = (message as { structured_output?: unknown })
          .structured_output;
        if (
          structured &&
          typeof structured === "object" &&
          "files" in (structured as Record<string, unknown>) &&
          Array.isArray((structured as { files: unknown }).files)
        ) {
          try {
            onEvent({
              type: "build_manifest",
              manifest: structured as Extract<
                TwinBuilderEvent,
                { type: "build_manifest" }
              >["manifest"],
              ts: ts(),
            });
          } catch {
            /* best-effort */
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    onEvent({ type: "error", message, ts: ts() });
    appendRunLog("builder", buildId, { type: "error", message });
    unregisterRun(buildId, { status: "error", costUsd: 0 });
  }

  // Final disk reconciliation — pick up anything written between the last
  // tool_result and the result message.
  for (const name of TWIN_FILE_NAMES) {
    try {
      const stat = fs.statSync(path.join(employeeDir, name));
      if (stat.isFile() && stat.size > 0) {
        const prev = lastSeenMtime.get(name) ?? 0;
        if (stat.mtimeMs > prev) {
          lastSeenMtime.set(name, stat.mtimeMs);
          filesWrittenThisRun.add(name);
          onEvent({
            type: "file_done",
            filename: name,
            sizeBytes: stat.size,
            ts: ts(),
          });
        }
      }
    } catch {
      /* still missing */
    }
  }

  // Record the build manifest if anything was actually produced. Even if zero
  // new files were written this run (e.g. agent gave up), we still record
  // the manifest as long as some files exist at root — otherwise the build is
  // a no-op and shouldn't pollute the timeline.
  const anyAtRoot = TWIN_FILE_NAMES.some((n) => {
    try {
      return fs.statSync(path.join(employeeDir, n)).size > 0;
    } catch {
      return false;
    }
  });
  if (anyAtRoot) {
    try {
      const manifest = recordBuild({
        employeeId: employee.id,
        buildId,
        startedAt: buildStartedAt,
        finishedAt: new Date(),
        modelUsed: "claude-sonnet-4-6",
        costUsd,
        turns,
        stoppedReason,
        ceoContext,
        activeToolkits,
        writtenFiles: [...filesWrittenThisRun],
      });
      // version number = position in the build timeline (1-indexed)
      const version =
        listBuilds(employee.id).find((b) => b.buildId === manifest.buildId)
          ?.version ?? 0;
      onEvent({
        type: "build_recorded",
        buildId: manifest.buildId,
        version,
        filesInManifest: manifest.files.map((f) => f.filename),
        ts: ts(),
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`[twin-builder] manifest write failed: ${m}`);
    }
  }

  if (builderTextBuf.trim()) {
    appendRunLog("builder", buildId, { type: "text", text: builderTextBuf });
  }
  appendRunLog("builder", buildId, {
    type: "done",
    summary: `${filesWrittenThisRun.size}/9 files written`,
    costUsd,
    turns,
  });
  unregisterRun(buildId, { status: "complete", costUsd });

  onEvent({
    type: "done",
    filesWritten: [...filesWrittenThisRun],
    turns,
    costUsd,
    stoppedReason,
    ts: ts(),
  });
}

// ─── System prompt ───────────────────────────────────────────────────────────

function buildBuilderSystemPrompt(args: {
  employee: EmployeeWithTwin;
  ceoContext?: string;
  employeeDir: string;
  activeToolkits: string[];
  orgMcpNames: string[];
  existingFiles: TwinFileName[];
}): string {
  const {
    employee,
    ceoContext,
    employeeDir,
    activeToolkits,
    orgMcpNames,
    existingFiles,
  } = args;
  const firstName = employee.firstName;

  const fileSpecs: { name: TwinFileName; spec: string }[] = [
    {
      name: "CONTEXT.md",
      spec: `The company + role context the twin needs to reason like ${firstName}: company name & stage, business model, target customer, current quarter focus, real day-to-day constraints, the political map (who has influence, where the friction is). **Evidence preference order:** email signatures + calendar invites ${firstName} sent or organized → Slack channels they're most active in (channel names + their topics) → Notion/Drive docs they authored or last edited → Linear cycle goals they own. Avoid generic boilerplate ("a fast-paced startup"); the CEO needs the *specific* current reality.`,
    },
    {
      name: "EXPERTISE.md",
      spec: `${firstName}'s technical/functional expertise as a **light SWOT**:

  - **Strengths (3–5)** — domains they're authoritative on, with verbatim evidence (e.g. "led the migration from X to Y per PR #1234", "authored 4 specs on retrieval ranking in Notion"). Recognize patterns: what kinds of problems do they take on first?
  - **Weaknesses / gaps (1–3)** — be honest. Even senior people have areas they avoid, defer, or get pushback on. Look for: topics they CC their manager on, threads they hand off, problems they ask others to solve. If you genuinely can't find any, say "(no observable gaps in available signals)" — don't invent.
  - **Adjacent opportunities** — areas where their existing strengths give them a natural next step.

  Cite the tool calls and quote the evidence. The CEO uses this section to know when to push and when to defer to ${firstName}.`,
    },
    {
      name: "PROJECTS.md",
      spec: `Active and recent projects with a **mini Threats/Opportunities pass per project**:

  - **Project name → ${firstName}'s role → current status → next milestone → blockers → threats → opportunities.**
  - Evidence preference: Linear/Jira issues *assigned to or created by* ${firstName} (not just visible to them); GitHub PRs they authored; Notion project pages they edited in the last 90 days; calendar events they organize for that project.
  - "Threats" = what could derail it (resource, dependency, deadline, political).
  - "Opportunities" = what would 10x it if they leaned in.
  - Avoid listing projects they're peripherally CC'd on — that's noise, not their actual work.`,
    },
    {
      name: "PEOPLE.md",
      spec: `Real teammates ${firstName} works with — and the **power dynamics**, not just an org-chart dump:

  - **Who they defer to** (escalate decisions to, ask for sign-off, CC for cover): ${firstName}'s manager + anyone whose name shows up disproportionately as the recipient of "wanted to flag…" / "checking with you on…" / "your call".
  - **Who they manage / mentor** (their team, their reports, anyone they coach in Slack DMs).
  - **Peers they collaborate most with** (top 3–5 by Slack DM frequency, recurring 1:1 calendar slots, GitHub co-review pairs).
  - **External counterparts** (customers, vendors, contractors) named in their sent emails.
  - Use signals like Slack DM frequency, GitHub PR reviewers, recurring calendar attendees. Don't list every name; rank by signal strength.`,
    },
    {
      name: "DECISIONS.md",
      spec: `${firstName}'s **decision-making fingerprint** — how they think, with examples:

  - **Decision style:** decisive vs deliberative? Data-led vs intuition-led? Build vs buy? Fast iteration vs careful design?
  - Look for hedging vs assertive language: "I think we should…" / "let me check with X first" vs "do this" / "shipping Friday" / "no, we're not doing that". Quantify if you can ("~70% of their PR reviews end with a specific ask, ~30% are open questions").
  - **3–5 example decisions** with: the situation, ${firstName}'s position (verbatim quote ≤30 words), the rationale, the outcome if visible. Pull from PR descriptions, design-doc comments, Linear issue threads, Slack threads where they pushed back.
  - **How they say no:** hard refusal? Soft deferral ("not now, let's revisit Q3")? Redirect ("the bigger problem is…")? This is gold for the CEO.`,
    },
    {
      name: "PREFERENCES.md",
      spec: `How ${firstName} actually operates day-to-day — the **behavioral signature**:

  - **Meeting style:** load (meetings/day), preferred lengths, decline rate, who they decline (and who they always accept). Recurring blocks (deep-work mornings? no-meeting Wednesdays?).
  - **Communication cadence:** when do they ship messages — early morning, late night, weekends? Reply latency. Do they batch responses or interleave with deep work?
  - **Tooling preferences:** when given the choice, which tool do they reach for? (Linear vs GitHub Issues? Notion vs Google Docs? Slack DM vs email?)
  - **Process patterns:** doc structures they reuse, recurring agenda templates, how they run a kickoff or retro.

  Evidence is in calendar (organizer/attendee data, accept/decline patterns), Slack timestamps, GitHub commit times, Gmail send-time histogram.`,
    },
    {
      name: "TONE.md",
      spec: `${firstName}'s voice — the highest-NLP file, must read like a linguistic fingerprint a colleague would recognize:

  - **Voice fingerprint:** typical greeting/opening, typical sign-off, typical length (one-liner Slacker vs paragraph composer), formality level, presence/absence of humor.
  - **Lexical patterns:** 3–6 words or phrases they reuse ("the right call here", "shipping it", "let me think on it"). Quote them.
  - **Hedging vs decisiveness:** measure roughly. Do they say "maybe / I think we should" or "we need to / let's just"?
  - **How they praise:** generic ("great job") vs specific (name + concrete reason). With evidence.
  - **How they push back:** soft questions, hard "no", or pivot ("the better question is…")?
  - **Formality gradient:** how does their tone shift between writing to (a) their team, (b) execs/board, (c) external customers? Quote one example of each if you can.
  - **Required:** ≥6 verbatim quotes, each ≤25 words, no PII (no last names of non-public people, no phone numbers, no internal customer names). **Source priority is critical here:** these MUST come from messages ${firstName} *sent* (Gmail \`in:sent\`, Slack \`from:@<their_handle>\`, PR descriptions/comments authored by them). Received messages are useless for this file.`,
    },
    {
      name: "BOUNDARIES.md",
      spec: `Topics where the twin must escalate to the human ${firstName}. Default enterprise list (compensation, hiring decisions, legal, PR/comms, anything that creates legal commitment) is fine as a baseline, but **derive org-specific boundaries from the data when possible**: which topics does ${firstName} consistently route to a specific other person? ("redirects pricing questions to @sales-leader") — that's a boundary. Phrase as "twin should NOT do X without first checking with ${firstName} or @<person>." If signal is thin, default to the enterprise list explicitly.`,
    },
    {
      name: "EMPLOYMENT.md",
      spec: `HR-style record: title, manager (if discoverable from email/calendar/Slack), direct reports if any (recurring 1:1s, code-review delegates, mentees), peers (frequent collaborators at the same level), tenure (estimate from earliest message date if you can, else mark as unknown), certifications/credentials visible in signatures or LinkedIn-style sources. **Public information only — never compensation, never home address, never private contact info.**`,
    },
  ];

  return `You are an **HR psychologist + workplace ethnographer** building a behavioral profile of a real person. The output is 9 markdown files that will permanently ground a digital twin of ${firstName}. The twin then chats and acts on the CEO's behalf using these files as its identity, so the profile has to be one their own colleagues would recognize as accurate — not a generic corporate bio.

You are NOT a content generator. You are reading between the lines of a digital trail. Apply the same skills a great manager applies on day-30 of a new hire: pattern recognition, NLP, behavioral analysis, light SWOT thinking.

# Subject

- **Employee id:** ${employee.id}
- **Name:** ${employee.name}
- **Role:** ${employee.role}
- **First name (used by the twin in conversation):** ${firstName}
${ceoContext ? `\n## What the CEO told us about ${firstName}\n\n${ceoContext}\n` : ""}

# Available systems

${activeToolkits.length > 0 ? `- **Composio MCP** (\`mcp__composio__*\`) — ${firstName}'s personal SaaS connections currently ACTIVE: ${activeToolkits.join(", ")}.\n  - Discover with the toolkit-specific list/search tools, then read.\n  - Pattern: \`mcp__composio__<TOOLKIT>_<VERB>_<OBJECT>\` — e.g. \`mcp__composio__GITHUB_LIST_PULL_REQUESTS\`, \`mcp__composio__SLACK_SEARCH_MESSAGES\`, \`mcp__composio__GMAIL_FETCH_EMAILS\`, \`mcp__composio__GOOGLECALENDAR_LIST_EVENTS\`.` : "- (No Composio toolkits active — rely on org-level MCP only.)"}
${orgMcpNames.length > 0 ? `- **Org-wide MCP servers** — workspace-level tools: ${orgMcpNames.map((n) => `\`mcp__${n}__*\``).join(", ")}.` : ""}
- **Local Read/Write/Glob/Grep** — write the 9 markdown files into \`${employeeDir}\`. The Write tool is sandboxed to that directory and to the 9 known filenames; any other path will be denied.

# Source priority — outgoing > incoming, authored > assigned

A profile built from messages someone *received* tells you about THEM, not about how THEY think. Always prefer:

| Toolkit | Strong signal (use first) | Weak signal (last resort) |
|---|---|---|
| **Gmail** | Sent emails (\`in:sent\`, \`from:me\`) — their voice + decisions in writing | Received emails (only useful for context on who's writing TO them) |
| **Slack** | Messages they posted (\`from:@<their_handle>\`), threads they replied in | Channels they're a passive member of |
| **GitHub** | PRs *authored* by them, review comments *by* them, issues they opened | PRs assigned to them as reviewer (passive) |
| **Calendar** | Events they ORGANIZED (organizer = them), declines they sent | Events they were merely invited to |
| **Notion / Drive** | Docs they CREATED or edited recently | Docs shared with them |
| **Linear / Jira** | Issues they CREATED or are ASSIGNEE on | Issues they're CC'd on |

When you have multiple toolkits, **start with the strong-signal source for each file**. For TONE.md specifically, only sent/authored content has any value at all — received messages are noise.

# Reading between the lines (apply throughout)

While you read, watch for these signals — they feed the file specs below:

- **Lexical patterns**: words/phrases they reuse, terms-of-art they coined, opening/closing rituals.
- **Hedging vs decisiveness**: "maybe / I think / let's not" vs "do this / no / shipping Friday".
- **How they say no**: hard refusal, soft deferral, redirection, silent ignore.
- **How they praise**: name + specific reason, or generic "great work".
- **Formality gradient**: with whom do they get more formal, with whom more casual?
- **Power dyads**: who do they always CC? Who do they DM most? Who do they decline meetings from / always accept from?
- **Time-of-day patterns**: morning shipper vs night writer? Weekend worker?
- **Message-length distribution**: one-liner vs essayist?

Don't dump these as raw observations — fold them into the relevant file's narrative.

# Goal — produce these 9 files

${fileSpecs.map((f) => `## ${f.name}\n${f.spec}`).join("\n\n")}

${existingFiles.length > 0 ? `\n# Existing files on disk (you may overwrite to improve)\n\n${existingFiles.join(", ")}\n` : ""}

# Operating rules

1. **Plan first.** Open with a short plan (3–8 sentences): for each of the 9 files, name the strongest signal source you have access to. If a file has no good signal source available, say so explicitly in the plan — that's a quality-score input, not a failure mode.
2. **Read-only only.** You may search, list, fetch, read, retrieve. You may NOT post messages, create issues, send emails, or mutate any external system. The platform will deny any write tool you try.
3. **Ground every claim in evidence.** Every assertion in a file must trace back to a tool result you saw. Do not invent teammates, projects, or decisions. Quoted phrases must be VERBATIM (with light truncation marked "…") from the agent's own writing — never paraphrased then quoted.
4. **Honesty over completeness.** If you can only access 1 toolkit, your profile WILL be low-quality on 5–7 of the 9 files. **DO NOT compensate by inventing detail.** Write \`(insufficient evidence — only <toolkit> available; this section is best-effort)\` and move on. The CEO sees a low Twin Quality score and knows what to fix. **Faking depth is the worst possible outcome — the twin will then confidently say wrong things in the CEO's name.**
5. **Frontmatter every file.** Each file starts with YAML frontmatter:
   \`\`\`
   ---
   employee: ${employee.id}
   file: <FILENAME>.md
   generatedAt: <ISO timestamp>
   sources: [list of toolkits + specific tool actions used]
   confidenceNote: "high|medium|low — one short reason"
   ---
   \`\`\`
6. **Quality bar.** Each file should be 600–2,500 chars of substantive, evidence-grounded content. Use markdown sections, lists, and verbatim quotes. Never write "Lorem ipsum", "TBD", or filler.
7. **One file per Write call.** Always invoke \`Write\` with \`file_path\` set to just the filename (\`CONTEXT.md\`) — the cwd is already \`${employeeDir}\`. Do not batch multiple files into one Write.
8. **Don't quote PII.** Phone numbers, home addresses, government IDs, banking details, customer lists with full names — never include these. Verbatim quotes about style and decisions are fine.
9. **Stop only when all 9 files exist on disk with substantive content** (or with the explicit "(insufficient evidence)" stub from rule 4 — that's still a complete file).

# Output protocol

After writing each file, in 1–2 sentences state: which file you finished, which tools you grounded it in, and your confidence (high/medium/low) for that file. When all 9 files are done, end your turn with the exact line:

\`Twin profile complete: 9/9 files written.\`
`;
}
