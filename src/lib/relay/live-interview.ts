/**
 * Relay · LIVE interview (model-backed)
 *
 * The interactive counterpart to the fixture demo. Here a real human answers:
 *  - streamInterviewerTurn() runs the warm interviewer agent (sonnet) one turn
 *    at a time — it asks, the employee types a real answer, it asks the next.
 *  - synthesizeFromConversation() takes the full live transcript and runs the
 *    opus synthesis to produce a real RoleContextPackage.
 *
 * IMPORTANT — does NOT touch the static investor fixture. Live RCPs are written
 * to data/handovers/<id>/rcp.live.json (the fixture stays at rcp.json).
 *
 * The interviewer's behaviour is governed entirely by INTERVIEWER_SYSTEM_PROMPT
 * in ./interviewer — edit that file to tune the agent; the dev server hot-reloads
 * the route so the next turn uses the new prompt.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

import { INTERVIEWER_SYSTEM_PROMPT, buildInterviewerPrompt } from "./interviewer";
import { scoreCoverage, type CoverageResult } from "./coverage";
import { redactPii } from "./synthesis";
import {
  RCP_SCHEMA_VERSION,
  type CapturedItem,
  type Provenance,
  type RoleContextPackage,
  type ToolingRef,
} from "./rcp.types";

/** PRD: capture = sonnet (fast/warm), synthesis = opus (deep reasoning). */
export const CAPTURE_MODEL = "claude-sonnet-4-6";
export const SYNTHESIS_MODEL = "claude-opus-4-8";

/** The mandatory demo banner (ConsentRecord.banner literal, PRD 13.5). */
const DEMO_BANNER =
  "DEMO — not legally reviewed, not for production, not published";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const PROFILE_FILES = [
  "EXPERTISE.md", "TONE.md", "CONTEXT.md", "DECISIONS.md", "PREFERENCES.md",
  "PEOPLE.md", "PROJECTS.md", "BOUNDARIES.md", "EMPLOYMENT.md",
];

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Read the twin's profile files as a single text block for interviewer context. */
export function loadProfileText(employeeId: string): string {
  const dir = path.join(process.cwd(), "data", "employees", employeeId);
  return PROFILE_FILES.map((name) => {
    try {
      const c = fs.readFileSync(path.join(dir, name), "utf8").trim();
      return c ? `### ${name}\n${c}` : null;
    } catch {
      return null;
    }
  })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** Full system prompt = the tunable interviewer prompt + "what's already known". */
function buildInterviewSystem(employeeId: string): string {
  const profile = loadProfileText(employeeId) || "(no profile on file)";
  return `${INTERVIEWER_SYSTEM_PROMPT}\n\n---\n\n${buildInterviewerPrompt(
    profile,
    "(read-only history not loaded in live mode — rely on the profile above)",
  )}`;
}

/**
 * The Anthropic API requires the first message to be role:user. The visible
 * transcript starts with the interviewer's greeting (assistant), so we prepend
 * a hidden kickoff user turn to keep roles alternating.
 */
const KICKOFF: ChatMessage = {
  role: "user",
  content:
    "[The handover interview is starting now. Greet me warmly and specifically — grounded in what you already know about me from the profile — then ask your first question. Ask one question at a time and follow the thread.]",
};

function normalizeForModel(messages: ChatMessage[]): ChatMessage[] {
  const clean = messages.filter((m) => m.content && m.content.trim());
  if (clean.length === 0 || clean[0].role !== "user") return [KICKOFF, ...clean];
  return clean;
}

/**
 * Run ONE interviewer turn, streaming the question text via onDelta.
 * Returns the full assistant message text.
 */
export async function streamInterviewerTurn(
  employeeId: string,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
): Promise<string> {
  const client = getClient();
  const system = buildInterviewSystem(employeeId);
  const msgs = normalizeForModel(messages);

  let full = "";
  const stream = client.messages.stream({
    model: CAPTURE_MODEL,
    max_tokens: 1024,
    system,
    messages: msgs.map((m) => ({ role: m.role, content: m.content })),
  });
  stream.on("text", (t) => {
    full += t;
    onDelta(t);
  });
  await stream.finalMessage();
  return full.trim();
}

// ─── Synthesis (opus) ─────────────────────────────────────────────────────────

const rcpLivePath = (employeeId: string) =>
  path.join(process.cwd(), "data", "handovers", employeeId, "rcp.live.json");

export const RCP_LIVE_PATH = rcpLivePath;

interface RawItem {
  title?: string;
  body?: string;
  confidence?: number;
  gaps?: string[];
}
interface RawTooling {
  system?: string;
  location?: string;
  accessVia?: string;
  ownedBy?: string;
  confidence?: number;
  gaps?: string[];
}

function buildLiveSynthesisPrompt(profile: string, conversation: string): string {
  return `You are synthesizing a Role Context Package (RCP) from a real handover interview.

Below is (1) the departing employee's existing profile and (2) the full interview transcript between the INTERVIEWER and the EMPLOYEE. Extract the durable, operational knowledge into a structured RCP.

## Existing profile (background — do not just copy it; the substance is the interview)
${profile || "(no profile on file)"}

## Interview transcript
${conversation}

## Your task
Produce a JSON object capturing the tacit knowledge from the EMPLOYEE's answers. Use ONLY these top-level keys, each an array:

- "decision_rules": rules / approval thresholds / when-to-escalate. Each: { "title", "body", "confidence" (0..1), "gaps": [string] }
- "playbooks": step-by-step processes. Each: { "title", "body" (ordered steps, markdown list ok), "confidence", "gaps" }
- "contact_graph": who owns what + informal key people. Each: { "title" (person/role), "body" (what they own + why they matter), "confidence", "gaps" }. Role/handle only — NO private contact info.
- "edge_cases": war stories / "watch out for X". Each: { "title", "body" (situation + how handled), "confidence", "gaps" }
- "tooling_map": systems + access. Each: { "system", "location", "accessVia" (how access is granted — a PROCESS), "ownedBy" (role/handle), "confidence", "gaps" }. REFERENCES ONLY — NEVER passwords, API keys, tokens, or any secret value.
- "glossary": internal terms/acronyms. Each: { "title" (term), "body" (definition), "confidence", "gaps" }
- "open_loops": in-flight tasks at handover. Each: { "title", "body" (task + state + next action), "confidence", "gaps" }

Rules:
- Only capture what the EMPLOYEE actually said. Do not invent. If a field has nothing real, return an empty array for it.
- Be honest in "confidence" and "gaps" — note what is still thin or unconfirmed.
- NEVER include secrets in tooling_map. Reference where things live and how access is requested, not the credentials.
- Output ONLY the JSON object. No prose, no markdown fences.`;
}

function toItems(raw: unknown, employeeId: string, field: string): CapturedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r0, i) => {
    const r = (r0 ?? {}) as RawItem;
    return {
      id: `${employeeId}:live:${field}:${i + 1}`,
      title: redactPii(String(r.title ?? "").trim()) || "(untitled)",
      body: redactPii(String(r.body ?? "").trim()),
      provenance: "interview" as Provenance,
      confidence:
        typeof r.confidence === "number" ? clamp01(r.confidence) : 0.7,
      gaps: Array.isArray(r.gaps) ? r.gaps.map((g) => redactPii(String(g))) : [],
    };
  });
}

function toTooling(raw: unknown, employeeId: string): ToolingRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r0, i) => {
    const r = (r0 ?? {}) as RawTooling;
    return {
      id: `${employeeId}:live:tooling_map:${i + 1}`,
      system: redactPii(String(r.system ?? "").trim()) || "(unnamed system)",
      location: redactPii(String(r.location ?? "").trim()),
      accessVia: redactPii(String(r.accessVia ?? "").trim()),
      ownedBy: r.ownedBy ? redactPii(String(r.ownedBy).trim()) : undefined,
      provenance: "interview" as Provenance,
      confidence:
        typeof r.confidence === "number" ? clamp01(r.confidence) : 0.7,
      gaps: Array.isArray(r.gaps) ? r.gaps.map((g) => redactPii(String(g))) : [],
    };
  });
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}

/**
 * Run the opus synthesis on a live transcript and write rcp.live.json.
 * Returns the validated RCP + its coverage score. Never overwrites the
 * static fixture (rcp.json).
 */
export async function synthesizeFromConversation(
  employeeId: string,
  messages: ChatMessage[],
): Promise<{ rcp: RoleContextPackage; coverage: CoverageResult }> {
  const client = getClient();
  const profile = loadProfileText(employeeId);
  const conversation = messages
    .filter((m) => m.content && m.content.trim())
    .map(
      (m) =>
        `${m.role === "assistant" ? "INTERVIEWER" : "EMPLOYEE"}: ${m.content.trim()}`,
    )
    .join("\n\n");

  const res = await client.messages.create({
    model: SYNTHESIS_MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: buildLiveSynthesisPrompt(profile, conversation) }],
  });

  const text = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error("Synthesis did not return valid JSON. Try a few more answers and re-run.");
  }

  const decision_rules = toItems(parsed.decision_rules, employeeId, "decision_rules");
  const playbooks = toItems(parsed.playbooks, employeeId, "playbooks");
  const contact_graph = toItems(parsed.contact_graph, employeeId, "contact_graph");
  const edge_cases = toItems(parsed.edge_cases, employeeId, "edge_cases");
  const glossary = toItems(parsed.glossary, employeeId, "glossary");
  const open_loops = toItems(parsed.open_loops, employeeId, "open_loops");
  const tooling_map = toTooling(parsed.tooling_map, employeeId);

  const itemCount =
    decision_rules.length + playbooks.length + contact_graph.length +
    edge_cases.length + glossary.length + open_loops.length + tooling_map.length;

  const generatedAt = new Date().toISOString();

  const rcp: RoleContextPackage = {
    source_twin_id: employeeId,
    schema_version: RCP_SCHEMA_VERSION,
    generated_at: generatedAt,
    synth_mode: "model",
    status: "draft", // overwritten from coverage below
    decision_rules,
    playbooks,
    contact_graph,
    edge_cases,
    tooling_map,
    glossary,
    open_loops,
    provenance: {
      interviewerModel: CAPTURE_MODEL,
      transcriptRef: "live-interview",
      redactionApplied: true,
      itemCount,
      consent: {
        subjectId: employeeId,
        grantedAt: generatedAt,
        banner: DEMO_BANNER,
      },
      auditRunId: "live",
    },
  };

  const coverage = scoreCoverage(rcp);
  rcp.status = coverage.status;

  const dest = rcpLivePath(employeeId);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, JSON.stringify(rcp, null, 2), "utf8");

  return { rcp, coverage };
}
