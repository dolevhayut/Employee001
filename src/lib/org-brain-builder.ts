// Brain Builder — turns raw text (Notion paste, Slack thread, PDF text,
// meeting notes, an email) into proposed org-brain knowledge nodes.
//
// Uses Agent SDK query() with outputFormat (json_schema) instead of the native
// Anthropic SDK. Structured output eliminates manual JSON parsing and gives
// automatic retry-on-invalid-schema behaviour from the SDK.
//
// The output is NEVER auto-saved. The API returns proposals; the CEO
// reviews them in the UI and chooses which to commit.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { OrgBrainInput, OrgBrainNodeType } from "@/lib/org-brain";
import { TWIN_MODEL_PRIMARY, TWIN_MODEL_FALLBACK } from "@/lib/sdk-defaults";

const VALID_TYPES: OrgBrainNodeType[] = [
  "document",
  "decision",
  "incident",
  "policy",
  "customer",
  "product",
  "process",
  "note",
];

export type BrainBuilderResult = {
  proposed: OrgBrainInput[];
  modelUsed: string;
  inputChars: number;
  notes?: string;
};

export type BrainBuilderInput = {
  text: string;
  sourceLabel?: string;
};

// ─── Output schema ────────────────────────────────────────────────────────────

const BRAIN_NODE_SCHEMA = {
  type: "object",
  properties: {
    proposed: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string", description: "kebab-case, ≤ 60 chars, unique within batch" },
          label: { type: "string", description: "human-readable title, ≤ 80 chars" },
          type: {
            type: "string",
            enum: VALID_TYPES,
          },
          description: { type: "string", description: "one sentence — when this node matters" },
          triggers: {
            type: "array",
            items: { type: "string" },
            description: "4–8 short keywords/phrases that should make a twin recall this node",
          },
          body: { type: "string", description: "structured markdown content" },
        },
        required: ["slug", "label", "type", "description", "triggers", "body"],
        additionalProperties: false,
      },
    },
    notes: {
      type: "string",
      description: "optional one-liner if material was skipped or a judgment call was made",
    },
  },
  required: ["proposed"],
  additionalProperties: false,
} as const;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Brain Builder for Employee001 — a digital-twin platform.

Your job: read a chunk of company material (a Notion page, a Slack thread, an
email, a meeting transcript, a PDF text dump, a postmortem) and extract one
or more discrete knowledge nodes that every digital twin in the company
should be able to recall.

A knowledge node is a stable, reusable fact about the company. Examples:
- A pricing or discount policy
- An ICP / customer-segment definition
- A specific decision and its rationale
- An incident postmortem
- A product launch detail
- A process or operating principle

Reject content that is:
- A passing comment, opinion, or single-person preference (not org truth)
- Time-sensitive operational chatter ("standup notes for Tuesday")
- Personal information that doesn't belong in a shared brain

For each node, output:
- slug: kebab-case, ≤ 60 chars, unique within this batch
- label: human readable title, ≤ 80 chars
- type: one of [document, decision, incident, policy, customer, product, process, note]
- description: ONE sentence — when this node matters, what question it answers
- triggers: 4–8 short keywords/phrases that should make a twin recall this node
- body: the structured content as markdown (use headings, lists, tables — NOT a wall of text). Preserve facts; cut filler. Add a "## Why this exists" section if you can infer the motivation.

If the input contains nothing extractable, return { "proposed": [], "notes": "why" }.`;

// ─── Result sanitiser (lightweight — schema already validates shape) ──────────

function coerceType(v: unknown): OrgBrainNodeType {
  if (typeof v !== "string") return "note";
  const candidate = v.toLowerCase() as OrgBrainNodeType;
  return VALID_TYPES.includes(candidate) ? candidate : "note";
}

function sanitizeProposed(raw: unknown, sourceLabel?: string): OrgBrainInput[] {
  if (!raw || typeof raw !== "object" || !("proposed" in raw)) return [];
  const arr = (raw as { proposed: unknown }).proposed;
  if (!Array.isArray(arr)) return [];

  const out: OrgBrainInput[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const slug = typeof it.slug === "string" ? it.slug.trim() : "";
    const label = typeof it.label === "string" ? it.label.trim() : "";
    const body = typeof it.body === "string" ? it.body.trim() : "";
    if (!slug || !label || !body) continue;

    const triggers = Array.isArray(it.triggers)
      ? (it.triggers as unknown[])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    out.push({
      slug,
      label,
      type: coerceType(it.type),
      description:
        typeof it.description === "string" ? it.description.trim() : "",
      triggers,
      sources: sourceLabel ? [sourceLabel, "ai-extracted"] : ["ai-extracted"],
      linkedNodes: [],
      body,
    });
  }
  return out;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function buildBrainNodesFromText(
  input: BrainBuilderInput
): Promise<BrainBuilderResult> {
  const text = (input.text ?? "").trim();
  if (!text) {
    return {
      proposed: [],
      modelUsed: "none",
      inputChars: 0,
      notes: "empty input",
    };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set — Brain Builder unavailable");
  }

  const model = process.env.BRAIN_BUILDER_MODEL ?? TWIN_MODEL_PRIMARY;
  const prompt = input.sourceLabel
    ? `Source: ${input.sourceLabel}\n\n---\n\n${text}`
    : text;

  let structuredOutput: unknown = null;

  const stream = query({
    prompt,
    options: {
      model,
      fallbackModel: TWIN_MODEL_FALLBACK,
      systemPrompt: SYSTEM_PROMPT,
      allowedTools: [],
      maxTurns: 1,
      outputFormat: {
        type: "json_schema",
        schema: BRAIN_NODE_SCHEMA,
      },
      permissionMode: "bypassPermissions",
      settingSources: [],
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
    },
  });

  for await (const message of stream) {
    if (message.type === "result") {
      structuredOutput = (message as { structured_output?: unknown }).structured_output ?? null;
      if ((message as { subtype?: string }).subtype === "error_max_structured_output_retries") {
        throw new Error("Brain Builder: model failed to produce valid JSON after retries");
      }
    }
  }

  const proposed = sanitizeProposed(structuredOutput, input.sourceLabel);
  const notes =
    structuredOutput && typeof structuredOutput === "object" && "notes" in structuredOutput
      ? typeof (structuredOutput as { notes: unknown }).notes === "string"
        ? ((structuredOutput as { notes: string }).notes.trim() || undefined)
        : undefined
      : undefined;

  return {
    proposed,
    modelUsed: model,
    inputChars: text.length,
    notes,
  };
}
