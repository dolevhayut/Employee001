import path from "path";
import fs from "fs";
import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { EmployeeWithTwin } from "@/lib/employees";
import { buildEmployeeMcpServer } from "@/lib/composio-client";
import { loadOrgCustomMcpServers } from "@/lib/custom-mcp";
import {
  buildArtifactsMcpServer,
  ARTIFACT_TOOL_FULL_NAME,
  type ArtifactPayload,
} from "@/lib/artifacts-mcp";
import { buildOrgBrainMcpServer } from "@/lib/org-brain-mcp";
import {
  buildMeetingScratchMcpServer,
  SHARE_TOOL_FULL_NAME,
} from "@/lib/meeting-scratch-mcp";
import {
  appendTurn,
  getOrCreateMeeting,
  listSharedFiles,
  renderSharedFilesForPrompt,
  renderTranscriptForPrompt,
  type Meeting,
  type MeetingTurn,
} from "@/lib/meeting-store";
import { classifyTool, describeTool } from "@/lib/tool-policy";
import { registerApproval } from "@/lib/approval-bus";
import type { ApprovalSurface, ApprovalContext } from "@/lib/approval-bus";
import { appendAuditEntry } from "@/lib/audit-log";
import {
  formatStructuredMemoryBlock,
  formatTwinMemoryBlock,
  rememberTwinRun,
  searchStructuredMemory,
  searchTwinMemory,
  type TwinMemorySurface,
} from "@/lib/twin-memory";
import {
  formatOrgSkillsBlock,
  selectOrgSkillsForRun,
  type OrgSkillHit,
} from "@/lib/org-skills";
import {
  formatOrgBrainBlock,
  selectOrgBrainNodesForRun,
  type OrgBrainHit,
} from "@/lib/org-brain";
import {
  formatResponseIntentBlock,
  planEmployeeResponseIntent,
} from "@/lib/employee-intent-planner";
import { buildBaseOptions, buildTwinHooks } from "@/lib/sdk-defaults";
import { registerRun, updateRun, unregisterRun } from "@/lib/active-runs";
import { appendRunLog, logPathFor } from "@/lib/run-logs";
import {
  buildTwinAgentDefinitions,
  isTwinSubagent,
  SUBAGENT_LABELS,
  type TwinSubagentName,
} from "@/lib/twin-subagents";
import { knowledgeIndexMarkdown } from "@/lib/knowledge-files";
import { buildConsultMcpServer } from "@/lib/consult-mcp";
import type { ConsultContext } from "@/lib/twin-consult";

// ─── Event types ──────────────────────────────────────────────────────────────

/** One question in an AskUserQuestion clarification flow. Mirrors the SDK's
 *  AskUserQuestionInput shape but flattened for IPC. */
export type ClarificationQuestion = {
  /** Stable identifier — the question text itself, used as the answers map key. */
  question: string;
  /** ≤12-char chip label (e.g. "Approach"). */
  header: string;
  /** Whether the user can pick more than one option. */
  multiSelect: boolean;
  options: Array<{
    /** Display label the user clicks. */
    label: string;
    /** One-line trade-off explanation. */
    description: string;
    /** Optional self-contained HTML fragment shown when this option is hovered.
     *  Sanitised on the client before rendering. */
    preview?: string;
  }>;
};

export type CouncilEvent =
  | { type: "employee_start"; employeeId: string; employeeName: string }
  | {
      type: "org_skill_recall";
      employeeId: string;
      skills: Array<{ id: string; label: string; description: string }>;
      ts: number;
    }
  | {
      type: "org_brain_recall";
      employeeId: string;
      nodes: Array<{ slug: string; label: string; type: string; description: string }>;
      ts: number;
    }
  | { type: "tool_use"; employeeId: string; tool: string; input: unknown; ts: number }
  | { type: "tool_result"; employeeId: string; tool: string; ts: number }
  | {
      /** Emitted when the main twin spawns one of our research subagents
       *  via the Task tool. Used by the cockpit to render a small badge
       *  ("🌐 Web research × 2") under the active run. */
      type: "subagent_spawn";
      employeeId: string;
      subagentType: TwinSubagentName;
      label: string;
      description: string;
      ts: number;
    }
  | {
      /** Emitted once per run with the SDK session id — caller can persist for resume. */
      type: "session_started";
      employeeId: string;
      sessionId: string;
      ts: number;
    }
  | {
      type: "artifact";
      employeeId: string;
      artifactId: string;
      payload: ArtifactPayload;
      ts: number;
    }
  | {
      /** A twin dropped a file into the meeting scratch. UI renders an
       *  inline chip (with a thumbnail for images) and offers a side
       *  drawer with the full content. */
      type: "file_shared";
      employeeId: string;
      employeeName: string;
      file: {
        id: string;
        filename: string;
        summary: string;
        sizeBytes: number;
        contentType: string;
        kind: "text" | "image";
      };
      ts: number;
    }
  | { type: "text_delta"; employeeId: string; delta: string; ts: number }
  | {
      /** Extended-thinking delta. The SDK emits these when adaptive thinking
       *  is active. Forwarded to the cockpit so the CEO can watch the twin's
       *  reasoning in real time, separate from the final answer text. */
      type: "thinking_delta";
      employeeId: string;
      delta: string;
      ts: number;
    }
  | {
      type: "employee_done";
      employeeId: string;
      confidence: number;
      turns: number;
      costUsd: number;
      stoppedReason?: "max_budget" | "max_turns" | "natural";
      ts: number;
    }
  | { type: "employee_error"; employeeId: string; message: string }
  | {
      type: "tool_approval_request";
      employeeId: string;
      approvalId: string;
      tool: string;
      label: string;
      input: Record<string, unknown>;
      reason: string;
      ts: number;
    }
  | {
      /** AskUserQuestion fired — render rich HTML preview cards in the chat
       *  and route the CEO's selection back to the model. Different from
       *  tool_approval_request: this is multi-question structured Q&A, and
       *  the answer is the tool result itself, not allow/deny. */
      type: "clarification_request";
      employeeId: string;
      approvalId: string;
      questions: ClarificationQuestion[];
      ts: number;
    }
  | {
      type: "clarification_resolved";
      employeeId: string;
      approvalId: string;
      answers: Record<string, string>;
      ts: number;
    }
  | {
      type: "tool_approval_resolved";
      employeeId: string;
      approvalId: string;
      decision: "allow" | "deny";
      ts: number;
    }
  | { type: "tool_blocked"; employeeId: string; tool: string; reason: string; ts: number }
  | {
      /** Emitted when restrictWriteToScratch hook denies a Write call. Shows
       *  a yellow warning in the chat so the CEO can see why the memo wasn't saved. */
      type: "scratch_write_denied";
      employeeId: string;
      reason: string;
      ts: number;
    }
  | {
      type: "delegation";
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      ts: number;
    }
  | {
      type: "delegation_blocked";
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      reason: "already_called_in";
      ts: number;
    }
  | { type: "council_done" };

// ─── Profile file pre-loader ──────────────────────────────────────────────────

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

// ─── System prompt builder (cached blocks) ────────────────────────────────────

function buildSystemPromptBlocks(
  employee: EmployeeWithTwin,
  employeeDir: string,
  hasActionLayer: boolean,
  orgSkillsBlock?: string,
  orgBrainBlock?: string,
  memoryBlock?: string,
  teamMeetingContext?: {
    colleagues: string[];
    /** Pre-rendered transcript of every turn so far in this meeting. */
    transcript?: string;
    /** Set when this twin was @-tagged by another twin's previous turn. */
    calledInBy?: string;
    /** Pre-rendered shared-files index (filenames + summaries + authors). */
    sharedFiles?: string;
    /** True iff the meeting scratch MCP is registered for this run — controls
     *  whether the prompt mentions the share/read tools at all. */
    scratchEnabled?: boolean;
  },
  responseIntentBlock?: string
): string[] {
  const profileContent = loadProfileFiles(employeeDir);
  const knowledgeIndex = knowledgeIndexMarkdown(employee.id);
  const knowledgeBlock = knowledgeIndex
    ? `

# Uploaded knowledge files (index)

The CEO has uploaded extra reference material to enrich your brain. These are **NOT** pre-loaded — only the index below is. When a question might be answered by one of them, **Read** the relevant file on demand from \`employees/${employee.id}/knowledge/\`.

${knowledgeIndex}`
    : "";

  // Static block — eligible for cross-session prompt cache when nothing else
  // changes. Contains the full profile so most turns don't need Read at all,
  // but Read/Glob/Grep ARE available when the twin genuinely needs to look
  // up something off-profile (brain corpus, peers, attached files).
  const staticBlock = `You are the digital twin of ${employee.name}, ${employee.role} at Employee001 — an early-stage AI startup building a digital employee twin platform that lets CEOs chat with and delegate tasks to AI versions of their team.

You have been trained on ${employee.firstName}'s real working style, decisions, and expertise. You speak in ${employee.firstName}'s voice — with their tone, values, and reasoning.

# Who you are speaking with

You are speaking with the **CEO of Employee001** (your boss). Every reference to "the CEO" or "the user" in these instructions means them. Treat their questions as priority direction, escalate honestly, and answer with the candor you'd use with the person who hired you. They have full authority over strategy, hiring, compensation, and roadmap — even when something falls in your domain, they get the final call.

# Your profile files (pre-loaded)

The following are your actual profile files — they are pre-loaded so you can reference them directly without any tool calls. Use them as your default source of truth about yourself.

${profileContent}${knowledgeBlock}

# Reading from disk — when and how

You have **Read**, **Glob**, and **Grep** available. Use them when the answer is plausibly written down somewhere outside this profile. Don't reflexively reach for them on every turn — but when a CEO question references a policy, decision, customer, incident, or another teammate's situation that isn't in your profile, **look it up**. Saying "I don't have that documented" without trying first is a failure mode.

Your cwd is the workspace **data root**. All paths below are relative to it.

Workspace layout:

- \`employees/${employee.id}/*.md\` — your own profile (already pre-loaded above; don't re-read).
- \`employees/${employee.id}/knowledge/*\` — extra reference material the CEO uploaded to enrich this twin (notes, specs, CSVs, JSON). Read or Grep these when a question might be answered by uploaded material; they are NOT pre-loaded.
- \`employees/{other-employee-id}/*.md\` — your colleagues' 9 profile files (CONTEXT, EXPERTISE, TONE, BOUNDARIES, DECISIONS, PREFERENCES, PEOPLE, PROJECTS, EMPLOYMENT). Read when a question references another teammate's domain.
- \`org-brain/nodes/*.md\` — the **company brain**: pricing policies, customer-segment definitions, decisions, incident postmortems, product facts. **This is where most "what's our policy on X" answers live.** Glob this directory or Grep across it when the question touches company-wide knowledge.
- \`org-skills/*/SKILL.md\` — operating playbooks (assignment-gated; relevant ones are auto-injected as a dynamic block when triggers match).

Heuristic for which tool to use:

- Know the exact file? → \`Read\` it.
- "Anything on topic X?" → \`Grep\` across \`org-brain/\` first; widen if needed.
- "What does the brain even contain?" → \`Glob\` on \`org-brain/nodes/*.md\`.

**Always cite what you read.** When you Read \`org-brain/nodes/pricing-policy-q2-2026.md\`, name the file or its label in your answer (e.g., "per the Q2 pricing policy: …") so the CEO can audit your source.

# Web research

You can also use **WebSearch** and **WebFetch** when the answer depends on something outside the company — competitor pricing, current API contracts, regulatory news, recent industry events. Use them when your training data could be stale and freshness matters.

Always cite the URL you fetched and the date you fetched it (e.g., "per stripe.com/docs, fetched today"). Don't blend web facts with internal facts without distinction — the CEO needs to know which is which.

# Parallel research via subagents (Task tool)

For most questions, do your research inline. But when the CEO's question genuinely needs synthesis across **multiple independent angles** — competitor A vs competitor B vs internal benchmark, or "compare our pricing to industry + regulatory landscape + customer feedback" — spawn focused subagents in parallel via the **Task** tool instead of running searches in series.

Two subagent types are available:

- \`web-researcher\` — focused external web research on ONE angle. Returns concise bullets + URLs. Spawn 2–3 in parallel for different angles.
- \`brain-explorer\` — scans \`org-brain/nodes/\` and peer profiles for facts on a topic. Spawn one per topical area when a question touches multiple internal domains.

**When to use Task:**
- The question has 2+ genuinely independent research angles that can run simultaneously.
- You'd otherwise run 3+ sequential WebSearch / Grep calls before answering.

**When NOT to use Task:**
- A single quick lookup → use WebSearch / Grep / Read directly. Spawning a subagent for one search is slower and more expensive.
- Casual conversational questions → just answer.
- Anything that isn't actually parallelizable.

After the subagents return, synthesize their findings in your voice, cite the sources they returned, and answer the CEO. Subagents do NOT see the conversation history — give each one a self-contained prompt with the EXACT angle you want it to research.

# Scratch notes (Write tool)

You have **Write** for one purpose: jotting things down to your own scratch directory at \`scratch/${employee.id}/\`. Use it when:

- You're working through a multi-step problem and want a draft memo before composing your final answer.
- The CEO asks you to "save this for later" — write a markdown file with a descriptive filename like \`scratch/${employee.id}/2026-05-pricing-rethink.md\`.
- You discover something worth remembering across runs (memory will pick it up too, but a written file is browseable).

You **cannot** Write outside that directory. Trying to overwrite your profile, the brain, or anything else will be denied by a PreToolUse hook. That's intentional — profile + brain edits go through the CEO's UI, not through chat.

# How to respond

**Response rules:**
- Respond in first person AS ${employee.firstName}. Never say "I am a twin" or "I am an AI."
- Keep it tight: 2–4 short paragraphs MAX. This is a live conversation, not a memo.
- Be specific: reference your real context (current projects, real teammates, actual constraints).
- Be honest: surface tensions, disagree if you would, escalate if it crosses your boundaries.
- If the topic crosses a hard boundary (compensation, legal, hiring decisions), say so directly and route appropriately.
- When conversation history is provided, use it for full context — short follow-ups like "approved" or "yes" refer to the previous message.

**Formatting (use markdown intentionally):**
- Use **bold** to emphasize key numbers, decisions, or names.
- Use a markdown table when comparing 2+ options or showing metrics side-by-side.
- Use bullet lists for parallel items (3+).
- Use \`inline code\` for tool names, file names, or technical identifiers.
- Use a > blockquote when quoting a customer or teammate verbatim.
- Use ### headings only if you have 2+ distinct sections — otherwise prose.
- Numbers, dates, and dollar amounts should be **bold** so the CEO can scan quickly.

# Visual artifacts (\`mcp__artifacts__create_artifact\`)

When a reply benefits from being *seen* — a mini-dashboard with KPI tiles, a comparison card, an SVG diagram, a styled status board — call \`create_artifact\` to render it inline above your message text. The user sees the rendered panel directly in the chat, not raw code.

**When to use:**
- "Show me a dashboard of…" / "Build me a quick view of…"
- KPI summaries, comparison cards, before-after blocks
- Org charts, flow diagrams, simple SVG illustrations
- Status boards (red/yellow/green) where layout matters

**When NOT to use:**
- Plain prose answers
- A simple markdown table fits — use markdown
- A single number — just say it

**How:**
- \`type: "html"\` for layouts (use inline \`<style>\`, no external scripts/fonts/images).
- \`type: "svg"\` for a single \`<svg>\` element with explicit width/height.
- Keep it self-contained, ~600px wide, dark-mode-friendly (use CSS \`color-scheme: light dark\` or transparent backgrounds).
- After calling the tool, write one sentence telling the CEO what you rendered.`;

  // Dynamic block — NOT cached; changes when MCP connections change.
  const dynamicBlock = hasActionLayer
    ? `# Real-world action layer

You have access to MCP tools that let you take real action:
- **Composio** (\`mcp__composio__*\`) — ${employee.firstName}'s personal SaaS connections (Slack, GitHub, Linear, Gmail, etc.).
- **Org-wide MCP servers** — workspace-wide tools the CEO connected in /settings (e.g. internal databases, custom APIs). Available to every twin.

When the CEO asks for something that requires acting on a real system — sending a message, listing PRs, querying a database — use the appropriate MCP tools.

**Action rules:**
- Your profile content is already loaded above — use it to ground decisions, no need to re-read.
- Prefer read-only tools (\`*_get_*\`, \`*_list_*\`, \`*_search_*\`) by default.
- For destructive or external-facing actions (sending emails, posting to Slack channels, mutating shared data), describe what you're about to do in chat BEFORE calling the tool, so the CEO can interrupt.
- After acting, summarize what you did and link/cite the result.
- If a connected account is missing for what you need, say so plainly. Personal toolkits live at \`/connections/${employee.id}\`; org-wide MCP servers live at \`/settings\`.`
    : "";

  const sharedFilesSection =
    teamMeetingContext?.scratchEnabled && teamMeetingContext.sharedFiles
      ? `## Files shared in this meeting

${teamMeetingContext.sharedFiles}

For **CSV files** (.csv, or text files that are tabular data): use the dedicated CSV tools — they are dramatically cheaper and more accurate than reading the raw body.
- Always call \`analyze_csv({ filename })\` first. Returns column names, inferred types, numeric stats (min/max/avg/sum), and a 10-row preview. Cheap.
- Then call \`query_csv({ filename, where?, groupBy?, aggregate?, orderBy?, limit? })\` to compute over the full file. Aggregates: \`{ sum: 'col' } | { avg: 'col' } | { min: 'col' } | { max: 'col' } | { count: '*' }\`. Filters: literal value (eq) or operator object \`{ gt, gte, lt, lte, ne, in, contains }\`.
- Only fall back to \`read_meeting_file\` on a CSV if you need to see the literal raw lines (rare). For any aggregation, ranking, or "show me top N", use \`query_csv\`.

For **non-CSV text** files (Markdown, JSON, plain text): call \`read_meeting_file({ filename })\` if the summary above isn't enough. Most of the time the summary is sufficient.

For **image** files: the CEO sees the image rendered inline in the chat.
- If the question is about the **visual itself** (design feedback, "what do you think of this mock", comparing two visuals, judging composition / colors / typography / clarity), call \`view_meeting_image({ filename })\` — you'll receive the image as vision input and can actually see the pixels.
- If you don't need to see the visual (the question is about timing, approval status, or anything where the filename + summary is enough), DO NOT call \`view_meeting_image\` — it's expensive and unnecessary.
- Never call \`read_meeting_file\` on an image.`
      : "";

  const scratchToolsSection = teamMeetingContext?.scratchEnabled
    ? `## Sharing files with the meeting

If you pulled data from a connected tool (Drive doc, Slack export, GitHub diff, query result, image) that another twin in this meeting might need — or that the CEO would benefit from seeing inline — drop it into the shared scratch with \`share_with_meeting\`.

**Two input modes, pick one:**

\`\`\`
// Inline — when you already have the body in memory:
share_with_meeting({ filename, summary, content: "<full text body>" })

// URL download — for anything you got via a Composio download tool.
// Server fetches the URL and stores the bytes. Works for text AND images.
share_with_meeting({ filename, summary, sourceUrl: "<https presigned URL>" })
\`\`\`

**The right flow when pulling from Drive / SharePoint / OneDrive:**
1. Use the toolkit's "download" action that returns a presigned URL — for Google Drive that's \`GOOGLEDRIVE_DOWNLOAD_FILE\` (returns \`s3url\`). For Google Workspace docs (Doc / Sheet / Slide), use \`GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE\` with \`mimeType: "text/csv"\` (Sheets) or \`"text/markdown"\` / \`"text/plain"\` (Docs).
2. Pass the returned URL **directly** to \`share_with_meeting({ ..., sourceUrl })\`. **Do NOT WebFetch / curl / Read it first** — that wastes turns and re-encodes the body. The meeting scratch fetches the URL itself with the right type detection.
3. Pick a descriptive filename with the right extension (\`q1-pipeline.csv\`, \`homepage-mock.png\`) — the server uses it as a fallback when the upstream content-type is ambiguous (\`application/octet-stream\` from S3 etc.).

Avoid \`GOOGLEDRIVE_DOWNLOAD_FILE2\` and \`GOOGLEDRIVE_DOWNLOAD_FILE_OPERATION\` — they return OAuth-only URLs the meeting scratch can't fetch. Stick with \`GOOGLEDRIVE_DOWNLOAD_FILE\` / \`GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE\`.

Hard cap 25 MB. Use share_with_meeting sparingly — only when the data is reusable. Don't dump every API response.`
    : "";

  const teamMeetingBlock = teamMeetingContext
    ? `# Team meeting — live, in-room conversation

You are in a live group meeting with the CEO and your colleagues. Treat this like a Slack thread or a real meeting room: **everyone sees every message, including yours**. Speakers take turns. You will see the **full transcript so far** below — read it carefully before you respond.

**Colleagues in the room:** ${teamMeetingContext.colleagues.join(", ")}
${teamMeetingContext.calledInBy ? `\n**You were just called in by ${teamMeetingContext.calledInBy}** — they tagged you because they think your input is needed. Address that directly.\n` : ""}
## Meeting transcript so far

${teamMeetingContext.transcript ?? "(meeting just started — no prior turns)"}
${sharedFilesSection ? `\n${sharedFilesSection}\n` : ""}${scratchToolsSection ? `\n${scratchToolsSection}\n` : ""}
## How to respond now

- React naturally to what was actually said. If a colleague already covered something, **don't repeat it** — build on it, push back, or move the conversation forward.
- Do NOT pretend you can't see prior messages. You can. They are right above this section.
- Do NOT say things like "we're not really in a room" or "we're answering in parallel" — that is incorrect now and would confuse the CEO.
- If you genuinely agree with what was said, say so briefly and add your angle, or stay silent on it.
- Disagree openly when you do — this is a working meeting, not a love-fest.

**Delegation rule:** If your answer needs a specific colleague's expertise or tools (Slack, email, GitHub, etc.), tag them with @FirstName at the end of your response. They'll be called in next.

- Only tag if their input genuinely adds value.
- Tag at most one colleague per response.
- Do NOT tag yourself or anyone who has already been called in this thread.
- Example: "I'd defer the GTM side to @Noa — she has the customer context."`
    : "";

  // Current date/time — must live in the dynamic section so it doesn't
  // invalidate the prompt cache on the static profile block. Includes day of
  // week + ISO timestamp + IL timezone since the company runs from Israel.
  const now = new Date();
  const nowBlock = `# Current date and time

- Today: **${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Jerusalem" })}** (Israel time)
- Local time: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem", hour12: false })} IST
- ISO (UTC): ${now.toISOString()}

Use this when reasoning about deadlines, scheduling, "tomorrow", overdue items, or anything time-sensitive. Do NOT make up dates from your training data.`;

  const dynamicBlocks = [
    nowBlock,
    responseIntentBlock,
    orgBrainBlock,
    orgSkillsBlock,
    memoryBlock,
    dynamicBlock,
    teamMeetingBlock,
  ].filter((block): block is string => Boolean(block));

  return dynamicBlocks.length > 0
    ? [staticBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, ...dynamicBlocks]
    : [staticBlock];
}

function memorySurfaceFor(options: RunOptions): TwinMemorySurface {
  if (options.context?.type === "routine") return "background";
  return options.surface ?? "chat";
}

// ─── Single-employee Agent SDK runner ─────────────────────────────────────────

export type ConversationTurn = { role: "user" | "assistant"; text: string };

export type RunOptions = {
  surface?: ApprovalSurface;
  context?: ApprovalContext;
  runId?: string;
  /** When set, injects team-meeting instructions including delegation tagging rules. */
  teamMeetingContext?: {
    colleagues: string[];
    /** Pre-rendered transcript of every turn so far in this meeting. */
    transcript?: string;
    /** Set when this twin was @-tagged by another twin's previous turn. */
    calledInBy?: string;
    /** Pre-rendered shared-files index (filenames + summaries + authors). */
    sharedFiles?: string;
    /**
     * Meeting id. When provided, the runner registers the meeting-scratch MCP
     * server for this turn (share_with_meeting / read_meeting_file) and
     * renders any already-shared files into the prompt.
     */
    meetingId?: string;
  };
  /**
   * Hard dollar cap for this single execution. The Agent SDK enforces it and
   * stops the loop with an `error_max_budget_usd` result message if exceeded.
   * If omitted, no cap is applied.
   */
  maxBudgetUsd?: number;
  /**
   * Resume a prior Agent SDK session. When provided, the SDK reloads the full
   * transcript (text + tool_use + tool_result blocks) — no need to manually
   * forward `history`. The new `session_started` event carries the (possibly
   * forked) session id back to the caller.
   */
  resumeSessionId?: string;
  /**
   * When true, resuming the session forks it instead of continuing in place
   * (caller can branch a meeting without losing the original thread). The
   * `session_started` event carries the *forked* id.
   */
  forkSession?: boolean;
  /**
   * AbortController for cancelling the in-flight SDK loop (Cancel button on
   * the chat UI). When omitted, the run cannot be cancelled mid-stream.
   */
  abortController?: AbortController;
  /**
   * Override the primary model for this single run. Defaults to
   * `claude-sonnet-4-6`; CEO can pick `claude-opus-4-8` for harder asks.
   */
  modelOverride?: string;
  /**
   * Lightweight consultation run — this twin is being consulted by another
   * twin's run, not driving its own. Skips the personal Composio + org MCP
   * setup and the intent planner, and caps turns lower, so a consultation
   * chain stays cheap. The twin still has its profile, org-brain search,
   * artifacts, and (when `consultContext` is set) the ability to consult on.
   */
  consultMode?: boolean;
  /**
   * When set, registers the twin-to-twin consultation MCP server for this run
   * so the twin can consult / request approval from peers. Threaded one hop
   * deeper on each consultation; the shared `visited` set + depth cap inside
   * prevent runaway chains. See twin-consult.ts.
   */
  consultContext?: ConsultContext;
};

// ─── Mention detection ────────────────────────────────────────────────────────

function detectMentions(
  text: string,
  candidates: EmployeeWithTwin[]
): EmployeeWithTwin[] {
  return candidates.filter((emp) =>
    new RegExp(`@${emp.firstName}\\b`, "i").test(text)
  );
}

// ─── AskUserQuestion handler ──────────────────────────────────────────────────

/** Coerce the SDK's AskUserQuestionInput into our flatter ClarificationQuestion. */
function parseClarificationQuestions(input: Record<string, unknown>): ClarificationQuestion[] {
  const raw = (input.questions ?? []) as unknown[];
  const out: ClarificationQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const item = q as Record<string, unknown>;
    const text = typeof item.question === "string" ? item.question : "";
    const header = typeof item.header === "string" ? item.header : "";
    if (!text || !header) continue;
    const optsRaw = Array.isArray(item.options) ? item.options : [];
    const opts: ClarificationQuestion["options"] = [];
    for (const opt of optsRaw) {
      if (!opt || typeof opt !== "object") continue;
      const o = opt as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label : "";
      const description = typeof o.description === "string" ? o.description : "";
      if (!label) continue;
      opts.push({
        label,
        description,
        ...(typeof o.preview === "string" ? { preview: o.preview } : {}),
      });
    }
    if (opts.length < 2) continue;
    out.push({
      question: text,
      header,
      multiSelect: item.multiSelect === true,
      options: opts,
    });
  }
  return out;
}

async function handleAskUserQuestion(args: {
  input: Record<string, unknown>;
  employee: EmployeeWithTwin;
  runId: string;
  surface: ApprovalSurface;
  context?: ApprovalContext;
  ts: () => number;
  onEvent: (event: CouncilEvent) => void;
}): Promise<PermissionResult> {
  const { input, employee, runId, surface, context, ts, onEvent } = args;
  const questions = parseClarificationQuestions(input);

  // Malformed AskUserQuestion call — fall back to deny so the model retries.
  if (questions.length === 0) {
    return {
      behavior: "deny",
      message: "AskUserQuestion was called with no valid questions. Try again with at least one question and 2+ options each.",
    };
  }

  const { approvalId, promise } = registerApproval({
    runId,
    employeeId: employee.id,
    employeeName: employee.name,
    toolName: "AskUserQuestion",
    bareName: "AskUserQuestion",
    input,
    reason: questions.map((q) => q.question).join(" / "),
    surface,
    context,
  });

  onEvent({
    type: "clarification_request",
    employeeId: employee.id,
    approvalId,
    questions,
    ts: ts(),
  });

  const verdict = await promise;

  // The clarification flow uses the existing approval-bus, but treats the
  // verdict's `message` as a JSON-encoded answers map (UI side encodes it).
  let answers: Record<string, string> = {};
  try {
    const raw = verdict.action === "deny" ? verdict.message ?? "" : "";
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") answers[k] = v;
        }
      }
    } else if (raw) {
      // Fallback: single-question flow, message is the raw answer label.
      answers = { [questions[0].question]: raw };
    }
  } catch {
    /* keep answers empty — the SDK will treat that as a skipped question */
  }

  onEvent({
    type: "clarification_resolved",
    employeeId: employee.id,
    approvalId,
    answers,
    ts: ts(),
  });

  // Pre-fill the SDK's AskUserQuestion answer map so its built-in handler
  // resolves with the CEO's selections instead of trying to render its own
  // (CLI-only) picker.
  return {
    behavior: "allow",
    updatedInput: { ...input, answers },
  };
}

// ─── Single-employee runner ───────────────────────────────────────────────────

export async function runSingleTwin(
  employee: EmployeeWithTwin,
  question: string,
  onEvent: (event: CouncilEvent) => void,
  history: ConversationTurn[] = [],
  options: RunOptions = {}
): Promise<string> {
  const start = Date.now();
  const ts = () => Date.now() - start;
  const runId = options.runId ?? `run_${employee.id}_${Date.now()}`;

  // Pre-create the scratch directory so Glob(`scratch/<id>/*`) returns the dir
  // rather than "No files found" — an empty result causes the model to assume
  // scratch is unavailable and skip the Write call entirely.
  try {
    const scratchDir = path.join(process.cwd(), "data", "scratch", employee.id);
    fs.mkdirSync(scratchDir, { recursive: true });
  } catch { /* non-fatal */ }

  onEvent({
    type: "employee_start",
    employeeId: employee.id,
    employeeName: employee.name,
  });

  // Per-employee profile directory — used to pre-load profile content into
  // the system prompt.
  const employeeDir = path.join(
    process.cwd(),
    "data",
    "employees",
    employee.id
  );

  // The SDK's Read/Glob/Grep tools sandbox to `cwd` and won't traverse upward
  // via `..`. We therefore set the agent's cwd to `data/` so the twin can
  // freely browse its own profile (`employees/<id>/*.md`), peer profiles
  // (`employees/<other>/*.md`), and the company brain (`org-brain/nodes/*.md`)
  // — but NOT the source code or anything above the data root.
  const dataRoot = path.join(process.cwd(), "data");

  // Prefer SDK session resumption when caller passed a sessionId — the SDK
  // reloads the full transcript (including tool_use/tool_result blocks) so we
  // don't need to forward `history` ourselves. Fall back to the legacy
  // history-injection path when no sessionId is available (first turn, or
  // surfaces that don't track sessions yet).
  const useResume = Boolean(options.resumeSessionId);
  const prompt =
    !useResume && history.length > 0
      ? `<conversation_history>\n${history
          .map((t) => `${t.role === "user" ? "CEO" : employee.firstName}: ${t.text}`)
          .join("\n\n")}\n</conversation_history>\n\nCEO: ${question}`
      : question;

  let toolUseCount = 0;
  const filesRead = new Set<string>();
  let turns = 0;
  let costUsd = 0;
  let stoppedReason: "max_budget" | "max_turns" | "natural" = "natural";
  let finalText = "";

  try {
    // Build the per-employee Composio MCP server (null if not configured / no connections)
    // and merge in any org-wide custom MCP servers the CEO configured in /settings.
    // Composio outages must NOT abort the twin's turn — degrade gracefully by
    // omitting the toolkit so the twin can still answer from its profile files.
    // Consultation runs stay light: skip the personal Composio + org-wide MCP
    // setup entirely (the consulted twin gives advice from its profile +
    // org-brain, it doesn't act on external systems on this hop).
    const consultMode = options.consultMode === true;
    const [composioMcp, orgMcpServers] = consultMode
      ? [null, {} as Awaited<ReturnType<typeof loadOrgCustomMcpServers>>]
      : await Promise.all([
          buildEmployeeMcpServer(employee.id).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[composio] tools unavailable, twin will answer without them: ${msg}`);
            onEvent({
              type: "tool_blocked",
              employeeId: employee.id,
              tool: "composio",
              reason: `Composio is temporarily unavailable — tools are degraded. ${msg}`,
              ts: ts(),
            });
            return null;
          }),
          loadOrgCustomMcpServers().catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[org-mcp] load failed: ${msg}`);
            return {};
          }),
        ]);

    const meetingId = options.teamMeetingContext?.meetingId;

    const mcpServers = {
      ...orgMcpServers,
      ...(composioMcp ? { composio: composioMcp } : {}),
      // Always available — purely local UI render, no auth required
      artifacts: buildArtifactsMcpServer(),
      // Always available — BM25 search across every employee's profile
      // files + the shared org-brain. Read-only, no auth, no approval
      // gate (the twin can already Read these files directly; the MCP
      // tool is just a more efficient retrieval surface).
      org_brain: buildOrgBrainMcpServer(),
      // Twin-to-twin consultation — only when the caller threaded a context.
      // Lets this twin synchronously consult / request approval from peers;
      // the context's depth cap + shared visited-set guard against loops.
      ...(options.consultContext
        ? { twin_consult: buildConsultMcpServer(options.consultContext) }
        : {}),
      // Per-meeting scratch — only when we're inside a Team Meeting run.
      // The handler callback fires after persistence succeeds; we forward
      // it as `file_shared` so the UI can render the chip in the right
      // order (the SDK yields the `assistant` tool_use BEFORE running the
      // handler, so emitting from there would race the disk write).
      ...(meetingId
        ? {
            meeting_scratch: buildMeetingScratchMcpServer(
              meetingId,
              employee,
              (entry) => {
                onEvent({
                  type: "file_shared",
                  employeeId: employee.id,
                  employeeName: employee.firstName,
                  file: {
                    id: entry.id,
                    filename: entry.filename,
                    summary: entry.summary,
                    sizeBytes: entry.sizeBytes,
                    contentType: entry.contentType,
                    kind: entry.kind,
                  },
                  ts: ts(),
                });
              }
            ),
          }
        : {}),
    };
    const hasMcp = Object.keys(mcpServers).length > 0;

    let memoryBlock = "";
    try {
      const [episodic, structured] = await Promise.all([
        searchTwinMemory(employee.id, question),
        Promise.resolve(searchStructuredMemory(employee.id, question)),
      ]);
      // Durable facts first (higher authority), then episodic recall.
      memoryBlock = [
        formatStructuredMemoryBlock(structured),
        formatTwinMemoryBlock(episodic),
      ]
        .filter(Boolean)
        .join("\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[twin-memory] search skipped: ${message}`);
    }

    let orgSkillsBlock = "";
    let orgSkillHits: OrgSkillHit[] = [];
    try {
      orgSkillHits = selectOrgSkillsForRun(employee, question);
      orgSkillsBlock = formatOrgSkillsBlock(orgSkillHits);
      if (orgSkillHits.length > 0) {
        onEvent({
          type: "org_skill_recall",
          employeeId: employee.id,
          skills: orgSkillHits.map(({ skill }) => ({
            id: skill.id,
            label: skill.label,
            description: skill.description,
          })),
          ts: ts(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[org-skills] load skipped: ${message}`);
    }

    let orgBrainBlock = "";
    let orgBrainHits: OrgBrainHit[] = [];
    try {
      orgBrainHits = selectOrgBrainNodesForRun(question);
      orgBrainBlock = formatOrgBrainBlock(orgBrainHits);
      if (orgBrainHits.length > 0) {
        onEvent({
          type: "org_brain_recall",
          employeeId: employee.id,
          nodes: orgBrainHits.map(({ node }) => ({
            slug: node.slug,
            label: node.label,
            type: node.type,
            description: node.description,
          })),
          ts: ts(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[org-brain] load skipped: ${message}`);
    }

    const surface: "chat" | "meeting" | "routine" =
      options.context?.type === "routine"
        ? "routine"
        : options.teamMeetingContext
          ? "meeting"
          : "chat";

    let responseIntentBlock = "";
    // Skip the intent-planner LLM call on consultation hops — keeps chains cheap.
    if (!consultMode) try {
      const plan = await planEmployeeResponseIntent(question, {
        employeeName: employee.name,
        employeeRole: employee.role,
        surface,
        hasActionLayer: hasMcp,
        hasMeetingScratch: Boolean(meetingId),
        orgSkillLabels: orgSkillHits.map(({ skill }) => skill.label),
      });
      responseIntentBlock = formatResponseIntentBlock(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[intent-planner] skipped: ${message}`);
    }

    // Tool-policy gate: pause the agent when a write/external tool fires
    const canUseTool: CanUseTool = async (
      toolName,
      input
    ): Promise<PermissionResult> => {
      const typedInput = (input as Record<string, unknown>) ?? {};
      const decision = classifyTool(toolName, typedInput);
      const bare = toolName.replace(/^mcp__[a-z0-9_]+__/i, "");

      // AskUserQuestion → render structured HTML clarification cards in the
      // chat. Block the SDK's built-in renderer; instead emit a dedicated
      // event, register an approval, and pre-fill `answers` in updatedInput
      // so the SDK's handler resolves with the CEO's selection.
      if (toolName === "AskUserQuestion") {
        const result = await handleAskUserQuestion({
          input: typedInput,
          employee,
          runId,
          surface: options.surface ?? "chat",
          context: options.context,
          ts,
          onEvent,
        });
        return result;
      }

      // Local / read-only: pass through silently (no audit entry — not an
      // external action on anyone's account).
      if (decision.kind === "allow") {
        return { behavior: "allow", updatedInput: input };
      }

      if (decision.kind === "block") {
        onEvent({
          type: "tool_blocked",
          employeeId: employee.id,
          tool: toolName,
          reason: decision.reason,
          ts: ts(),
        });
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

      // "ask" — register an approval request and pause until the user resolves it
      const { approvalId, promise } = registerApproval({
        runId,
        employeeId: employee.id,
        employeeName: employee.name,
        toolName,
        bareName: bare,
        input: typedInput,
        reason: decision.reason,
        surface: options.surface ?? "chat",
        context: options.context,
      });

      onEvent({
        type: "tool_approval_request",
        employeeId: employee.id,
        approvalId,
        tool: toolName,
        label: describeTool(toolName),
        input: typedInput,
        reason: decision.reason,
        ts: ts(),
      });

      const verdict = await promise;

      onEvent({
        type: "tool_approval_resolved",
        employeeId: employee.id,
        approvalId,
        decision: verdict.action,
        ts: ts(),
      });

      if (verdict.action === "allow") {
        const finalInput = verdict.updatedInput ?? typedInput;
        appendAuditEntry({
          runId,
          employeeId: employee.id,
          employeeName: employee.name,
          toolName,
          bareName: bare,
          input: finalInput,
          verdict: "ceo_approved",
          approvalId,
          inputEdited: verdict.updatedInput !== undefined,
        });
        return {
          behavior: "allow",
          updatedInput: finalInput as typeof input,
        };
      }

      appendAuditEntry({
        runId,
        employeeId: employee.id,
        employeeName: employee.name,
        toolName,
        bareName: bare,
        input: typedInput,
        verdict: "ceo_denied",
        approvalId,
      });
      return {
        behavior: "deny",
        message:
          verdict.message ??
          "The CEO declined this action. Tell them what you would have done and ask if they want a different approach.",
      };
    };

    const baseOptions = buildBaseOptions({
      surface,
      abortController: options.abortController,
      runId,
      employeeId: employee.id,
      modelOverride: options.modelOverride,
    });

    const hooks = buildTwinHooks({
      runId,
      employeeId: employee.id,
      employeeName: employee.name,
      surface,
      onNotification: (n) => {
        // Scratch-write denials get a dedicated event so the UI can render
        // a yellow warning instead of a generic red-block banner.
        if (n.kind === "write_denied") {
          onEvent({
            type: "scratch_write_denied",
            employeeId: employee.id,
            reason: n.message,
            ts: ts(),
          });
          return;
        }
        // All other SDK notifications forward through tool_blocked.
        onEvent({
          type: "tool_blocked",
          employeeId: employee.id,
          tool: `notification:${n.kind}`,
          reason: n.title ? `${n.title}: ${n.message}` : n.message,
          ts: ts(),
        });
      },
    });

    const stream = query({
      prompt,
      options: {
        ...baseOptions,
        ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
        ...(options.resumeSessionId && options.forkSession ? { forkSession: true } : {}),
        cwd: dataRoot,
        systemPrompt: buildSystemPromptBlocks(
          employee,
          employeeDir,
          hasMcp,
          orgSkillsBlock,
          orgBrainBlock,
          memoryBlock,
          options.teamMeetingContext
            ? {
                ...options.teamMeetingContext,
                scratchEnabled: Boolean(meetingId),
              }
            : undefined,
          responseIntentBlock
        ),
        // Allowed built-ins:
        //   - TodoWrite / AskUserQuestion: surface twin reasoning + clarifications.
        //   - Read / Glob / Grep: browse the workspace (own profile, peers,
        //     org-brain, org-skills) — see prompt for paths.
        //   - Write: jot notes / draft memos to scratch/<employeeId>/ ONLY.
        //     Path enforced by restrictWriteToScratch PreToolUse hook in
        //     sdk-defaults.ts; profile + brain remain immutable from chat.
        //   - WebSearch / WebFetch: live research — competitor pricing, API
        //     docs, case studies. Replaces "I think" with "per Stripe's docs
        //     as of today, …".
        allowedTools: [
          "TodoWrite",
          "AskUserQuestion",
          "Read",
          "Glob",
          "Grep",
          "Write",
          "WebSearch",
          "WebFetch",
          // Task — dispatches to web-researcher / brain-explorer subagents
          // defined in twin-subagents.ts. The model spawns them in parallel
          // when a question genuinely needs synthesis from multiple angles.
          "Task",
        ],
        agents: buildTwinAgentDefinitions(),
        toolConfig: { askUserQuestion: { previewFormat: "html" } },
        ...(hasMcp ? { mcpServers } : {}),
        maxTurns: consultMode ? 8 : hasMcp ? 20 : 6,
        ...(options.maxBudgetUsd ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
        includePartialMessages: true,
        permissionMode: hasMcp ? "default" : "bypassPermissions",
        canUseTool: hasMcp ? canUseTool : undefined,
        settingSources: [],
        hooks,
      },
    });

    for await (const message of stream) {
      // First system/init carries the session id — emit so caller can persist
      // it and pass `resumeSessionId` on the next turn.
      if (message.type === "system" && (message as { subtype?: string }).subtype === "init") {
        const sid = (message as { session_id?: string }).session_id;
        if (sid) {
          onEvent({
            type: "session_started",
            employeeId: employee.id,
            sessionId: sid,
            ts: ts(),
          });
        }
        continue;
      }

      // Streaming text deltas (incremental output)
      if (message.type === "stream_event") {
        const event = message.event;
        if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "text_delta" && delta.text) {
            finalText += delta.text;
            onEvent({
              type: "text_delta",
              employeeId: employee.id,
              delta: delta.text,
              ts: ts(),
            });
          } else if (delta.type === "thinking_delta") {
            // Extended-thinking deltas — adaptive thinking is on by default.
            const thinkingText =
              (delta as { thinking?: string }).thinking ?? "";
            if (thinkingText) {
              onEvent({
                type: "thinking_delta",
                employeeId: employee.id,
                delta: thinkingText,
                ts: ts(),
              });
            }
          }
        }
        continue;
      }

      // Complete assistant message — surface tool_use blocks
      if (message.type === "assistant") {
        const content = message.message.content;
        for (const block of content) {
          if (block.type === "tool_use") {
            toolUseCount++;
            // Track files Read
            const input = block.input as Record<string, unknown>;
            if (block.name === "Read" && typeof input?.file_path === "string") {
              filesRead.add(input.file_path as string);
            }
            // Intercept artifact tool — emit a dedicated event so the UI can
            // render the payload as a panel instead of as a generic tool pill.
            if (block.name === ARTIFACT_TOOL_FULL_NAME) {
              const p = input as Partial<ArtifactPayload>;
              if (
                (p.type === "html" || p.type === "svg") &&
                typeof p.title === "string" &&
                typeof p.content === "string"
              ) {
                onEvent({
                  type: "artifact",
                  employeeId: employee.id,
                  artifactId: block.id,
                  payload: { type: p.type, title: p.title, content: p.content },
                  ts: ts(),
                });
                continue;
              }
            }
            // Suppress the generic tool_use event for share_with_meeting —
            // the dedicated `file_shared` event is emitted from the MCP
            // handler callback after the file is persisted (see above).
            if (block.name === SHARE_TOOL_FULL_NAME && meetingId) {
              continue;
            }
            // Task spawn — emit a richer event so the UI can render
            // "🌐 Web research" with the description. We suppress the generic
            // tool_use event in this case so the chat doesn't render the same
            // call twice. (The PostToolUse audit hook still logs it.)
            if (block.name === "Task") {
              const taskInput = block.input as {
                subagent_type?: string;
                description?: string;
              };
              const subagentType = taskInput.subagent_type;
              if (isTwinSubagent(subagentType)) {
                onEvent({
                  type: "subagent_spawn",
                  employeeId: employee.id,
                  subagentType,
                  label: SUBAGENT_LABELS[subagentType],
                  description:
                    typeof taskInput.description === "string"
                      ? taskInput.description.slice(0, 240)
                      : "",
                  ts: ts(),
                });
                continue;
              }
            }
            onEvent({
              type: "tool_use",
              employeeId: employee.id,
              tool: block.name,
              input: block.input,
              ts: ts(),
            });
          }
        }
        continue;
      }

      // Tool result confirmation (from synthetic user messages)
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
              onEvent({
                type: "tool_result",
                employeeId: employee.id,
                tool: "result",
                ts: ts(),
              });
            }
          }
        }
        continue;
      }

      // Final result
      if (message.type === "result") {
        turns = message.num_turns ?? 0;
        costUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? 0;
        const subtype = (message as { subtype?: string }).subtype;
        if (subtype === "error_max_budget_usd") stoppedReason = "max_budget";
        else if (subtype === "error_max_turns") stoppedReason = "max_turns";
        // External-service failure (Anthropic 5xx, connection refused, billing,
        // auth, etc.) — the SDK surfaces it as a result with is_error=true or
        // subtype "error_during_execution". Throw so the outer catch emits a
        // user-visible employee_error instead of letting us declare success
        // with empty text.
        const isErr = (message as { is_error?: boolean }).is_error === true ||
          subtype === "error_during_execution";
        if (isErr && !finalText) {
          const errs = (message as { errors?: string[] }).errors ?? [];
          const apiStatus = (message as { api_error_status?: number | null }).api_error_status;
          const detail = errs.join("; ") || (apiStatus ? `API error ${apiStatus}` : "Anthropic API error");
          throw new Error(`anthropic_unavailable: ${detail}`);
        }
      }
    }

    // Confidence heuristic: more tools used + more files read = higher confidence
    const baseConfidence = 0.70;
    const fileBonus = Math.min(filesRead.size * 0.05, 0.15); // up to +0.15 for reading 3+ files
    const toolBonus = Math.min(toolUseCount * 0.02, 0.10); // up to +0.10
    const confidence = Math.min(0.95, baseConfidence + fileBonus + toolBonus);

    onEvent({
      type: "employee_done",
      employeeId: employee.id,
      confidence,
      turns,
      costUsd,
      stoppedReason,
      ts: ts(),
    });

    void rememberTwinRun({
      employeeId: employee.id,
      runId,
      surface: memorySurfaceFor(options),
      question,
      answer: finalText,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[twin-memory] save skipped: ${message}`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    onEvent({ type: "employee_error", employeeId: employee.id, message });
  }

  return finalText;
}

// ─── Council runner — Slack-style sequential meeting ────────────────────────
//
// Every twin who speaks sees the FULL transcript so far (including prior CEO
// asks and all prior twin turns). Speakers run sequentially — each next twin
// reads what just got said and responds in context. Delegation chains keep
// the same model: the called-in twin sees everything.

export type RunCouncilArgs = {
  /** Twins selected by the CEO to respond first (round 1). When the CEO
   *  uses `@name`, this is just that one twin. Otherwise it's all chips. */
  responders: EmployeeWithTwin[];
  /** The CEO's new message. Will be appended to the meeting transcript. */
  question: string;
  /** Existing meeting id from the client, or undefined to start a new one. */
  meetingId?: string;
  /** All ready twins in the org — used to resolve @mentions for delegation. */
  allParticipants: EmployeeWithTwin[];
  onEvent: (event: CouncilEvent) => void;
};

export async function runCouncil(args: RunCouncilArgs): Promise<{ meetingId: string }> {
  const { responders, question, allParticipants, onEvent } = args;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const MAX_DELEGATION_ROUNDS = 3;

  // Load or create meeting state.
  const meeting: Meeting = getOrCreateMeeting(
    args.meetingId,
    responders.map((e) => e.id)
  );

  // Append the CEO's message to the transcript first — every twin's prompt
  // will render it as the most recent turn.
  appendTurn(meeting.id, { kind: "ceo", text: question, ts: Date.now() });

  // Twins who have already taken a turn IN THIS RUN — prevents the same
  // delegation cascade from re-tagging someone we just heard from. (We
  // intentionally do NOT check across prior CEO asks — a twin can speak
  // again on a later CEO message in the same meeting.)
  const spokenThisRun = new Set<string>();

  const colleagueNames = (forId: string) =>
    allParticipants.filter((e) => e.id !== forId).map((e) => e.firstName);

  // Diagnostic file logger
  const logFile = path.join(process.cwd(), "data", "council-debug.log");
  const dlog = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(msg);
    try { fs.appendFileSync(logFile, line); } catch { /* ignore */ }
  };

  dlog(`[council] === RUN === meeting=${meeting.id} priorTurns=${meeting.transcript.length - 1} CEO: "${question.slice(0, 100)}". Responders: [${responders.map((e) => e.firstName).join(", ")}]`);

  /** Run one twin sequentially. Renders the up-to-date transcript on every
   *  call so each speaker sees what was just said by the previous speaker. */
  async function runOne(
    employee: EmployeeWithTwin,
    delegatedFrom?: EmployeeWithTwin
  ): Promise<string> {
    spokenThisRun.add(employee.id);

    const transcriptText = renderTranscriptForPrompt(meeting.transcript);
    const sharedFilesText = renderSharedFilesForPrompt(
      listSharedFiles(meeting.id)
    );
    dlog(`[council]   → ${employee.firstName} speaks. Transcript size: ${transcriptText.length} chars, ${meeting.transcript.length} turns. Shared files: ${meeting.sharedFiles.length}.`);

    const councilRunId = `council_${employee.id}_${Date.now()}`;
    registerRun({
      runId: councilRunId,
      surface: "council",
      employeeId: employee.id,
      employeeName: employee.name,
      label: delegatedFrom
        ? `Council (via ${delegatedFrom.firstName})`
        : "Council",
      startedAt: new Date().toISOString(),
      logPath: logPathFor("council", councilRunId),
    });
    appendRunLog("council", councilRunId, {
      type: "meta",
      message: `${employee.firstName} speaks in council`,
    });

    let councilToolCalls = 0;
    let councilTextBuf = "";
    let councilThinkingBuf = "";
    let councilSubagentCount = 0;
    let councilCostUsd = 0;

    const cockpitOnEvent = (evt: CouncilEvent) => {
      onEvent(evt);
      if (evt.type === "text_delta" && evt.employeeId === employee.id) {
        councilTextBuf += evt.delta;
        if (/[.!?\n]\s*$/.test(councilTextBuf) && councilTextBuf.length > 40) {
          appendRunLog("council", councilRunId, { type: "text", text: councilTextBuf });
          updateRun(councilRunId, { lastText: councilTextBuf.slice(-200) });
          councilTextBuf = "";
        }
      }
      if (evt.type === "tool_use" && evt.employeeId === employee.id) {
        councilToolCalls++;
        const bare = evt.tool.replace(/^mcp__[a-z0-9_]+__/i, "");
        if (councilTextBuf.trim()) {
          appendRunLog("council", councilRunId, { type: "text", text: councilTextBuf });
          councilTextBuf = "";
        }
        appendRunLog("council", councilRunId, { type: "tool_use", tool: bare });
        updateRun(councilRunId, { toolCalls: councilToolCalls, currentTool: bare });
      }
      if (evt.type === "subagent_spawn" && evt.employeeId === employee.id) {
        councilToolCalls++;
        councilSubagentCount++;
        const synth = `subagent:${evt.subagentType}`;
        if (councilTextBuf.trim()) {
          appendRunLog("council", councilRunId, { type: "text", text: councilTextBuf });
          councilTextBuf = "";
        }
        appendRunLog("council", councilRunId, {
          type: "tool_use",
          tool: synth,
          input: { description: evt.description },
        });
        updateRun(councilRunId, {
          toolCalls: councilToolCalls,
          currentTool: evt.label,
          subagentCount: councilSubagentCount,
        });
      }
      if (evt.type === "thinking_delta" && evt.employeeId === employee.id) {
        councilThinkingBuf += evt.delta;
        if (councilThinkingBuf.length > 60) {
          appendRunLog("council", councilRunId, {
            type: "thinking",
            text: councilThinkingBuf,
          });
          updateRun(councilRunId, { lastThinking: councilThinkingBuf.slice(-200) });
          councilThinkingBuf = "";
        }
      }
      if (evt.type === "tool_result" && evt.employeeId === employee.id) {
        appendRunLog("council", councilRunId, { type: "tool_result", tool: evt.tool });
      }
      if (evt.type === "employee_done" && evt.employeeId === employee.id) {
        councilCostUsd = evt.costUsd ?? 0;
        if (councilTextBuf.trim()) {
          appendRunLog("council", councilRunId, { type: "text", text: councilTextBuf });
          councilTextBuf = "";
        }
        appendRunLog("council", councilRunId, { type: "done", costUsd: councilCostUsd, turns: evt.turns });
        unregisterRun(councilRunId, { status: "complete", costUsd: councilCostUsd });
      }
      if (evt.type === "employee_error" && evt.employeeId === employee.id) {
        appendRunLog("council", councilRunId, { type: "error", message: evt.message });
        unregisterRun(councilRunId, { status: "error", costUsd: 0 });
      }
    };

    const text = await runSingleTwin(
      employee,
      // The actual `question` argument is collapsed into the transcript
      // block in the system prompt. We still pass a short user-side nudge
      // so the SDK has a non-empty prompt to anchor on.
      delegatedFrom
        ? `${delegatedFrom.firstName} tagged you. Read the transcript above and respond.`
        : `Respond to the CEO's most recent message in the transcript.`,
      cockpitOnEvent,
      [],
      {
        surface: "chat",
        teamMeetingContext: {
          colleagues: colleagueNames(employee.id),
          transcript: transcriptText,
          calledInBy: delegatedFrom?.firstName,
          sharedFiles: sharedFilesText,
          meetingId: meeting.id,
        },
      }
    );

    // Append to transcript so the NEXT speaker sees this turn.
    const turn: MeetingTurn = {
      kind: "twin",
      employeeId: employee.id,
      employeeName: employee.firstName,
      text,
      ts: Date.now(),
      ...(delegatedFrom
        ? { delegatedFromId: delegatedFrom.id, delegatedFromName: delegatedFrom.firstName }
        : {}),
    };
    appendTurn(meeting.id, turn);

    return text;
  }

  // Round 1: responders speak in order, each seeing the prior speaker's turn.
  const round1: Array<{ employee: EmployeeWithTwin; text: string }> = [];
  for (const employee of responders) {
    const text = await runOne(employee);
    round1.push({ employee, text });
  }

  // Delegation chain — each tagged twin sees the now-extended transcript.
  let currentRound = round1;
  for (let round = 0; round < MAX_DELEGATION_ROUNDS; round++) {
    const nextRound: Array<{ employee: EmployeeWithTwin; text: string }> = [];

    dlog(`[council] Delegation round ${round + 1} — processing ${currentRound.length} response(s). Already spoken this run: [${[...spokenThisRun].join(", ")}]`);

    for (const { employee, text } of currentRound) {
      if (!text) continue;

      const allMentions = detectMentions(
        text,
        allParticipants.filter((e) => e.id !== employee.id)
      );
      const mentioned = allMentions.filter((e) => !spokenThisRun.has(e.id));
      const blocked = allMentions.filter((e) => spokenThisRun.has(e.id));

      const tail = text.slice(-200).replace(/\s+/g, " ");
      dlog(`[council]   ${employee.firstName} (${text.length} chars). Tail: "…${tail}". Mentions: [${mentioned.map((m) => m.firstName).join(", ") || "none"}]. Blocked: [${blocked.map((m) => m.firstName).join(", ") || "none"}]`);

      for (const target of blocked) {
        onEvent({
          type: "delegation_blocked",
          fromId: employee.id,
          fromName: employee.firstName,
          toId: target.id,
          toName: target.firstName,
          reason: "already_called_in",
          ts: Date.now(),
        });
      }

      for (const target of mentioned) {
        if (spokenThisRun.has(target.id)) continue;
        dlog(`[council]     → calling in ${target.firstName}`);

        onEvent({
          type: "delegation",
          fromId: employee.id,
          fromName: employee.firstName,
          toId: target.id,
          toName: target.firstName,
          ts: Date.now(),
        });

        const targetText = await runOne(target, employee);
        nextRound.push({ employee: target, text: targetText });
      }
    }

    if (nextRound.length === 0) break;
    currentRound = nextRound;
  }

  onEvent({ type: "council_done" });
  return { meetingId: meeting.id };
}
