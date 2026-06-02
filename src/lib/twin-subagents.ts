// Specialised subagents the main twin can spawn via the `Task` tool.
//
// Why subagents:
//   - Parallel execution: 3 web searches happen simultaneously, not in series.
//   - Isolated context: each researcher's intermediate WebSearch results don't
//     bloat the main twin's context window.
//   - Cheaper model: research drafts run on Haiku 4.5; the main twin synthesizes
//     them on Sonnet/Opus.
//
// The main twin should ONLY spawn these for genuinely parallel work — a single
// follow-up search is faster done inline. The descriptions below tell the model
// when each subagent is appropriate.

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

const RESEARCHER_MODEL = "claude-haiku-4-5-20251001";

export const TWIN_SUBAGENT_NAMES = ["web-researcher", "brain-explorer", "gap-finder"] as const;
export type TwinSubagentName = (typeof TWIN_SUBAGENT_NAMES)[number];

/** Used by the cockpit to render a friendly badge. */
export const SUBAGENT_LABELS: Record<TwinSubagentName, string> = {
  "web-researcher": "🌐 Web research",
  "brain-explorer": "🧠 Brain explorer",
  "gap-finder": "🔍 Gap finder",
};

export function buildTwinAgentDefinitions(): Record<string, AgentDefinition> {
  return {
    "web-researcher": {
      description: [
        "Use this agent for FOCUSED external web research on a single angle.",
        "Spawn MULTIPLE in parallel (one Task call per angle) when a question",
        "needs synthesis from different sources — e.g. competitor pricing,",
        "industry benchmarks, regulatory news. The agent returns concise bullet",
        "findings + URLs you can cite.",
        "DO NOT use it for a single quick lookup; use WebSearch directly for that.",
      ].join(" "),
      tools: ["WebSearch", "WebFetch"],
      model: RESEARCHER_MODEL,
      effort: "low",
      prompt: [
        "You are a focused web researcher dispatched by a digital twin.",
        "Your only job: search the web on the EXACT angle the parent twin asked,",
        "extract the 3–6 most useful facts, and return them as a tight markdown",
        "bullet list with source URLs.",
        "",
        "Rules:",
        "- Do NOT add commentary, opinions, or recommendations — just facts + URLs.",
        "- Always include the URL for each fact, in `(source: <url>)` form.",
        "- If the angle is unsearchable or yields nothing useful, say so plainly.",
        "- Maximum 8 bullets. The parent twin will synthesize across multiple",
        "  researcher outputs, so brevity matters more than breadth.",
        "- Today's date matters for currency claims — you can WebFetch a date page",
        "  if needed, but usually the question implies recency.",
      ].join("\n"),
    },

    "brain-explorer": {
      description: [
        "Use this agent to scan the org-brain (org-brain/nodes/*.md) and peer",
        "profiles (employees/<id>/*.md) for facts relevant to a specific question.",
        "Returns file paths + extracted bullet points. Spawn ONE per topical area",
        "when a question touches multiple internal domains (e.g. 'pricing +",
        "compliance'). Skip for single-file lookups — Read directly is faster.",
      ].join(" "),
      tools: ["Grep", "Glob", "Read"],
      model: RESEARCHER_MODEL,
      effort: "low",
      prompt: [
        "You are a focused internal explorer dispatched by a digital twin.",
        "Your cwd is the workspace data root. Look up information ONLY in:",
        "- org-brain/nodes/*.md (the company brain)",
        "- employees/<id>/*.md (peer profile files)",
        "",
        "Workflow:",
        "1. Glob or Grep first to find relevant files for the EXACT topic asked.",
        "2. Read the most promising 2–4 files.",
        "3. Return a tight markdown bullet list of facts, each with the file",
        "   path in `(source: <path>)` form so the parent twin can cite it.",
        "",
        "Rules:",
        "- Do NOT add opinions or speculation. Quote facts; cite paths.",
        "- Maximum 10 bullets. Brevity > breadth.",
        "- If nothing relevant exists, say so plainly with the searches you tried.",
      ].join("\n"),
    },

    "gap-finder": {
      description: [
        "Use this agent to score the coverage gaps in an in-progress Relay",
        "Role Context Package (RCP). It globs the interview working notes under",
        "scratch/<employeeId>/ plus the in-progress RCP, scores each RCP field",
        "against the coverage rubric (minItems + weight), and returns the THINNEST",
        "areas (which fields are under minItems, what's missing) plus a 0..1",
        "weighted score. Read-only — it never writes. Spawn ONCE near the end of a",
        "handover capture phase to find what's still missing.",
      ].join(" "),
      tools: ["Grep", "Glob", "Read"],
      model: RESEARCHER_MODEL,
      effort: "low",
      prompt: [
        "You are a read-only coverage scorer dispatched during a Relay handover.",
        "Your cwd is the workspace data root. Look ONLY in:",
        "- scratch/<employeeId>/*.json (interview working notes, one file per area)",
        "- handovers/<id>/rcp.json (the in-progress Role Context Package, if present)",
        "",
        "The coverage rubric (field → minItems, weight):",
        "- decision_rules: minItems 4, weight 0.25",
        "- playbooks: minItems 3, weight 0.20",
        "- contact_graph: minItems 4, weight 0.15",
        "- edge_cases: minItems 3, weight 0.15",
        "- tooling_map: minItems 3, weight 0.10",
        "- open_loops: minItems 2, weight 0.10",
        "- glossary: minItems 3, weight 0.05",
        "weightedScore = sum over fields of weight * min(1, items / minItems).",
        "status is 'handover-ready' when weightedScore >= 0.7, else 'draft'.",
        "",
        "Workflow:",
        "1. Glob the scratch notes + RCP, Read them, and count populated items",
        "   per field.",
        "2. Compute each field's score and the overall weighted score.",
        "3. Return a TIGHT markdown bullet list of the thinnest areas — which",
        "   fields are under minItems and what is missing — then a final line",
        "   `weightedScore: <0..1>` and `status: draft|handover-ready`.",
        "",
        "Rules:",
        "- NEVER write or modify any file. You only read and score.",
        "- Do NOT invent items. Count only what is actually present.",
        "- Maximum 10 bullets. Brevity > breadth.",
      ].join("\n"),
    },
  };
}

/** Returns true if `agentType` is one of our defined subagents. */
export function isTwinSubagent(agentType: string | undefined): agentType is TwinSubagentName {
  return typeof agentType === "string" && (TWIN_SUBAGENT_NAMES as readonly string[]).includes(agentType);
}
