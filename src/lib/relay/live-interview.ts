/**
 * Relay · live handover interview
 *
 *  - interviewerTurn() runs one interviewer turn: it appends the employee's
 *    answer to the saved transcript, asks the next question (streamed), and
 *    saves that too. The transcript lives on the server
 *    (data/handovers/<id>/interview.json), so the employee can pause and
 *    come back, and the interviewer's side can't be edited by the client.
 *  - synthesizeHandover() turns the transcript into the handover package
 *    (data/handovers/<id>/package.json), a draft until it is reviewed.
 *
 * Both go through relayTurn(), so they run on the workspace's model provider.
 */

import fs from "fs";
import path from "path";
import { dataDir } from "../app-home";
import { TWIN_MODEL_OPUS, TWIN_MODEL_PRIMARY } from "@/lib/sdk-defaults";

import { INTERVIEWER_SYSTEM_PROMPT, buildInterviewerPrompt } from "./interviewer";
import { scoreCoverage, type CoverageResult } from "./coverage";
import { redactPii } from "./redact";
import { verifyRcpEvidence } from "./evidence";
import { relayTurn } from "./model";
import { loadInterview, loadPackage, saveInterview, savePackage, type InterviewMessage } from "./package-store";
import {
  RCP_SCHEMA_VERSION,
  type CapturedItem,
  type Provenance,
  type RoleContextPackage,
  type ToolingRef,
} from "./rcp.types";

/** Capture = the fast primary model, synthesis = opus (deep reasoning). */
export const CAPTURE_MODEL = TWIN_MODEL_PRIMARY;
export const SYNTHESIS_MODEL = TWIN_MODEL_OPUS;

export type ChatMessage = InterviewMessage;

const PROFILE_FILES = [
  "EXPERTISE.md", "TONE.md", "CONTEXT.md", "DECISIONS.md", "PREFERENCES.md",
  "PEOPLE.md", "PROJECTS.md", "BOUNDARIES.md", "EMPLOYMENT.md",
];

/** Read the twin's profile files as a single text block for interviewer context. */
export function loadProfileText(employeeId: string): string {
  const dir = dataDir("employees", employeeId);
  return PROFILE_FILES.map((name) => {
    try {
      const c = fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, name), "utf8").trim();
      return c ? `### ${name}\n${c}` : null;
    } catch {
      return null;
    }
  })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function transcriptText(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.content && m.content.trim())
    .map((m) => `${m.role === "assistant" ? "INTERVIEWER" : "EMPLOYEE"}: ${m.content.trim()}`)
    .join("\n\n");
}

const OPENING =
  "Open the interview now. Greet them warmly and specifically, grounded in their profile. In a sentence, say what this is: a conversation of about 20 to 30 minutes so their know-how keeps helping the team, which they can pause any time and review before it's used. Then ask your first question.";

/**
 * Append the employee's answer (if any), run one interviewer turn streaming
 * via onDelta, save both, and return the updated transcript.
 */
export async function interviewerTurn(
  employeeId: string,
  answer: string | undefined,
  onDelta: (delta: string) => void,
): Promise<ChatMessage[]> {
  const messages = await loadInterview(employeeId);
  const text = answer?.trim();
  if (text) messages.push({ role: "user", content: text.slice(0, 8000) });
  if (text) await saveInterview(employeeId, messages);

  const draft = await loadPackage(employeeId);
  const gaps = draft ? scoreCoverage(draft).gaps.join(", ") : "";
  const system = `${INTERVIEWER_SYSTEM_PROMPT}\n\n---\n\n${buildInterviewerPrompt(loadProfileText(employeeId), gaps)}`;
  const prompt = messages.length === 0
    ? OPENING
    : `The interview so far:\n\n${transcriptText(messages)}\n\nWrite the interviewer's next message.`;

  const reply = await relayTurn({ employeeId, model: CAPTURE_MODEL, system, prompt, onDelta });
  if (!reply) throw new Error("The interviewer returned an empty message. Try again.");
  messages.push({ role: "assistant", content: reply });
  await saveInterview(employeeId, messages);
  return messages;
}

// ─── Synthesis (opus) ─────────────────────────────────────────────────────────

interface RawItem {
  title?: string;
  body?: string;
  confidence?: number;
  gaps?: string[];
  evidenceQuote?: string;
}
interface RawTooling {
  system?: string;
  location?: string;
  accessVia?: string;
  ownedBy?: string;
  confidence?: number;
  gaps?: string[];
  evidenceQuote?: string;
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

- "decision_rules": rules / approval thresholds / when-to-escalate. Each: { "title", "body", "confidence" (0..1), "gaps": [string], "evidenceQuote" }
- "playbooks": step-by-step processes. Each: { "title", "body" (ordered steps, markdown list ok), "confidence", "gaps", "evidenceQuote" }
- "contact_graph": who owns what + informal key people. Each: { "title" (person/role), "body" (what they own + why they matter), "confidence", "gaps", "evidenceQuote" }. Role/handle only — NO private contact info.
- "edge_cases": war stories / "watch out for X". Each: { "title", "body" (situation + how handled), "confidence", "gaps", "evidenceQuote" }
- "tooling_map": systems + access. Each: { "system", "location", "accessVia" (how access is granted — a PROCESS), "ownedBy" (role/handle), "confidence", "gaps", "evidenceQuote" }. REFERENCES ONLY — NEVER passwords, API keys, tokens, or any secret value.
- "glossary": internal terms/acronyms. Each: { "title" (term), "body" (definition), "confidence", "gaps", "evidenceQuote" }
- "open_loops": in-flight tasks at handover. Each: { "title", "body" (task + state + next action), "confidence", "gaps", "evidenceQuote" }

Rules:
- Only capture what the EMPLOYEE actually said. Do not invent. If a field has nothing real, return an empty array for it.
- Be honest in "confidence" and "gaps" — note what is still thin or unconfirmed.
- evidenceQuote is required for every item: copy a short, verbatim excerpt from an EMPLOYEE answer that supports it; never paraphrase.
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
      evidenceQuote: redactPii(String(r.evidenceQuote ?? "").trim()),
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
      evidenceQuote: redactPii(String(r.evidenceQuote ?? "").trim()),
    };
  });
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}

/**
 * Turn the saved interview into the handover package and save it as a draft
 * (any earlier review is cleared: the content changed).
 */
export async function synthesizeHandover(
  employeeId: string,
): Promise<{ rcp: RoleContextPackage; coverage: CoverageResult }> {
  const messages = await loadInterview(employeeId);
  if (!messages.some((m) => m.role === "user" && m.content.trim())) {
    throw new Error("No answers yet. Answer a few questions first.");
  }
  const profile = loadProfileText(employeeId);
  const conversation = transcriptText(messages);

  const text = (await relayTurn({
    employeeId,
    model: SYNTHESIS_MODEL,
    system: "You turn handover interviews into structured JSON. Output only JSON.",
    prompt: buildLiveSynthesisPrompt(profile, conversation),
  })).trim();
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

  const synthesizedRcp: RoleContextPackage = {
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
      transcriptRef: "interview.json",
      redactionApplied: true,
      itemCount,
      consent: {
        subjectId: employeeId,
        grantedAt: generatedAt,
        banner: "relay-handover-interview",
      },
      auditRunId: `relay-${employeeId}`,
    },
  };

  const rcp = verifyRcpEvidence(synthesizedRcp, conversation);

  const coverage = scoreCoverage(rcp);
  rcp.status = coverage.status;

  await savePackage(employeeId, rcp);

  return { rcp, coverage };
}
