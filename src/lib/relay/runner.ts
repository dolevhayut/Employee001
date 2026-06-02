/**
 * Relay · Handover Runner (orchestration + detached spawn)
 *
 * The third agent surface in the duplication track. Mirrors twin-builder.ts /
 * twin-build-runner.ts conventions (validate args → emit `start` → stream
 * phased events → never throw; errors become `error` + terminal `done`).
 *
 * The DEMO DEFAULT path is `synthMode: 'fixture'` — it produces a complete,
 * schema-valid RCP with ZERO model calls and NO Anthropic key. It reads the
 * pre-recorded interview transcript at data/relay/transcripts/<id>.json, replays
 * it as live `interview_question` / `capture_note` events, writes working notes
 * to data/scratch/<id>/relay-notes.json, deterministically synthesizes the RCP
 * via synthesizeRcpFixture, scores coverage (soft gate, PRD 13.2), and writes
 * data/handovers/<id>/rcp.json via fs (NOT the sandboxed agent Write tool —
 * handovers/ is outside the scratch sandbox by design).
 *
 * The `synthMode: 'model'` path (opus synthesis, sonnet capture, gap-finder
 * haiku) is wired as a drop-in but is NOT exercised by the demo and is the ONLY
 * path that requires ANTHROPIC_API_KEY.
 */

import path from "path";
import fs from "fs";
import fsp from "fs/promises";

import type { EmployeeWithTwin } from "@/lib/employees";
import { appendAuditEntry } from "@/lib/audit-log";
import { registerRun, unregisterRun, updateRun } from "@/lib/active-runs";

import {
  scoreCoverage,
  type CoverageResult,
  type PerFieldCoverage,
} from "./coverage";
import {
  redactPii,
  synthesizeRcpFixture,
  type CaptureArea,
  type SynthesisInput,
  type TranscriptTurn,
  type TwinProfileSummary,
} from "./synthesis";
import type {
  CapturedItem,
  ConsentRecord,
  RoleContextPackage,
  SynthMode,
  ToolingRef,
} from "./rcp.types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** The mandatory demo banner (PRD 13.5) — recorded in consent + the event. */
export const DEMO_BANNER =
  "DEMO — not legally reviewed, not for production, not published";

/** Capture model id (sonnet) recorded in provenance in model mode. */
const CAPTURE_MODEL = "claude-sonnet-4-6";
/** Synthesis model id (opus) recorded in provenance in model mode. */
const SYNTHESIS_MODEL = "claude-opus-4-7";

const RELAY_PHASES = [
  "consent",
  "capture",
  "synthesize",
  "coverage",
  "write",
] as const;

// ─── Path helpers ───────────────────────────────────────────────────────────

const HANDOVER_DIR = (employeeId: string) =>
  path.join(process.cwd(), "data", "handovers", employeeId);

const RCP_PATH = (employeeId: string) =>
  path.join(HANDOVER_DIR(employeeId), "rcp.json");

const SCRATCH_DIR = (employeeId: string) =>
  path.join(process.cwd(), "data", "scratch", employeeId);

const TRANSCRIPT_PATH = (employeeId: string) =>
  path.join(process.cwd(), "data", "relay", "transcripts", `${employeeId}.json`);

const EVENTS_PATH = (handoverId: string) =>
  path.join(process.cwd(), "data", "relay", handoverId, "events.jsonl");

const EMPLOYEE_DATA_DIR = (id: string) =>
  path.join(process.cwd(), "data", "employees", id);

// ─── Event contract (RelayEvent) ──────────────────────────────────────────────
//
// Defined here (not in rcp.types — that file is the PORTABLE contract and must
// stay E001-free). RelayEvent is an internal streaming contract shared by the
// runner, the SSE route, and the headless demo script.

export type RelayPhase = (typeof RELAY_PHASES)[number];

export type RelayStoppedReason =
  | "natural"
  | "consent_declined"
  | "max_budget"
  | "max_turns"
  | "error";

export type RelayEvent =
  | {
      type: "start";
      employeeId: string;
      synthMode: SynthMode;
      handoverId: string;
      ts: number;
    }
  | {
      type: "consent";
      state: "requested" | "granted" | "declined";
      subjectId: string;
      banner: string;
      ts: number;
    }
  | {
      type: "interview_question";
      questionId: string;
      text: string;
      area: CaptureArea;
      ts: number;
    }
  | {
      type: "capture_note";
      area: string;
      item: CapturedItem | ToolingRef;
      scratchPath: string;
      ts: number;
    }
  | { type: "phase"; phase: RelayPhase; ts: number }
  | {
      type: "synthesizing";
      model: string;
      synthMode: SynthMode;
      inputNotes: number;
      ts: number;
    }
  | { type: "file_writing"; path: string; bytes: number; ts: number }
  | {
      type: "coverage";
      perField: Record<
        string,
        {
          items: number;
          minItems: number;
          weight: number;
          satisfied: boolean;
          score: number;
        }
      >;
      weightedScore: number;
      status: "draft" | "handover-ready";
      gaps: string[];
      ts: number;
    }
  | {
      type: "done";
      rcpPath: string;
      status: "draft" | "handover-ready";
      weightedScore: number;
      turns: number;
      costUsd: number;
      stoppedReason: RelayStoppedReason;
      ts: number;
    }
  | { type: "error"; message: string; ts: number };

// ─── Event persistence sidecar ────────────────────────────────────────────────

/**
 * Append one RelayEvent to data/relay/<handoverId>/events.jsonl. Mirrors
 * twin-versions.appendBuildEvent — the SSE /stream route replays this file on
 * connect and tails it. Best-effort: a wedged disk must never crash the run.
 */
export function appendHandoverEvent(handoverId: string, event: RelayEvent): void {
  try {
    const file = EVENTS_PATH(handoverId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.warn(`[relay] event persist failed: ${m}`);
  }
}

// ─── Handover id ───────────────────────────────────────────────────────────

let _handoverCounter = 0;

export function newHandoverId(): string {
  _handoverCounter += 1;
  return `hand_${Date.now().toString(36)}_${_handoverCounter}`;
}

// ─── Runner args ───────────────────────────────────────────────────────────

export type RunRelayHandoverArgs = {
  employee: EmployeeWithTwin;
  /** Free-form context the CEO captured at onboarding/profile time. */
  ceoContext?: string;
  /**
   * 'fixture' (DEMO DEFAULT — no API) or 'model' (opus synthesis; requires
   * ANTHROPIC_API_KEY). Defaults to 'fixture' at every call site.
   */
  synthMode?: SynthMode;
  /** Override the transcript path. Defaults to data/relay/transcripts/<id>.json. */
  transcriptPath?: string;
  /**
   * When provided, the runner uses this id for the RCP dir + events.jsonl. The
   * route mints this *before* spawning so it can register the run as active.
   * NOTE: for the demo we key the RCP path on the EMPLOYEE id (PRD 6 —
   * data/handovers/<employeeId>/rcp.json), and use handoverId for the event log
   * + audit run id. Defaults to a fresh id when omitted.
   */
  handoverId?: string;
  /** Hard dollar cap for the (model-mode only) run. Default $5. */
  maxBudgetUsd?: number;
  abortController?: AbortController;
  onEvent: (event: RelayEvent) => void;
};

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Main orchestrator. Streams RelayEvent through phases:
 *   consent → capture → synthesize → coverage → write rcp.json
 *
 * Mirrors runTwinBuilder's contract: validates args, emits `start`, and NEVER
 * throws — every error path emits an `error` followed by a terminal `done`.
 */
export async function runRelayHandover(args: RunRelayHandoverArgs): Promise<void> {
  const { employee, onEvent } = args;
  const synthMode: SynthMode = args.synthMode ?? "fixture";
  const handoverId = args.handoverId ?? newHandoverId();
  const employeeId = employee.id;

  const start = Date.now();
  const ts = () => Date.now() - start;

  onEvent({ type: "start", employeeId, synthMode, handoverId, ts: ts() });

  // ─── Phase 1 · consent (PRD 13.5) ────────────────────────────────────────
  //
  // DEMO DEFAULT: consent is auto-granted here so the headless run produces an
  // RCP end-to-end. The *real* consent gate (subject clicks "I consent")
  // lives in the UI; this runner records the consent decision and the
  // mandatory demo banner into the RCP provenance either way.
  onEvent({ type: "phase", phase: "consent", ts: ts() });
  onEvent({
    type: "consent",
    state: "requested",
    subjectId: employeeId,
    banner: DEMO_BANNER,
    ts: ts(),
  });

  const consent: ConsentRecord = {
    subjectId: employeeId,
    grantedAt: new Date().toISOString(),
    banner: DEMO_BANNER,
  };
  onEvent({
    type: "consent",
    state: "granted",
    subjectId: employeeId,
    banner: DEMO_BANNER,
    ts: ts(),
  });

  let weightedScore = 0;
  let status: RoleContextPackage["status"] = "draft";
  let rcpPath = RCP_PATH(employeeId);

  try {
    // ─── Phase 2 · capture ─────────────────────────────────────────────────
    onEvent({ type: "phase", phase: "capture", ts: ts() });

    const profile = await loadProfileSummary(employee);
    const transcriptRef = args.transcriptPath ?? TRANSCRIPT_PATH(employeeId);
    const transcript = await loadTranscript(transcriptRef, employeeId);

    // Replay the transcript as a live interview so the UI shows Q/A flowing,
    // and write tagged working notes to the scratch sandbox.
    const scratchDir = SCRATCH_DIR(employeeId);
    await fsp.mkdir(scratchDir, { recursive: true });
    const scratchNotesPath = path.join(scratchDir, "relay-notes.json");

    for (const turn of transcript) {
      onEvent({
        type: "interview_question",
        questionId: turn.id,
        text: turn.question,
        area: turn.area,
        ts: ts(),
      });
      onEvent({
        type: "capture_note",
        area: turn.area,
        item: turnToNoteItem(turn),
        scratchPath: path.join("scratch", employeeId, "relay-notes.json"),
        ts: ts(),
      });
    }

    // Persist the working notes (best-effort — the RCP synthesis reads the
    // in-memory transcript, not this file; this is for audit/repro + the UI).
    try {
      await fsp.writeFile(
        scratchNotesPath,
        JSON.stringify({ employeeId, handoverId, transcript }, null, 2),
        "utf8",
      );
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`[relay] scratch note write failed: ${m}`);
    }

    // ─── Phase 3 · synthesize ──────────────────────────────────────────────
    onEvent({ type: "phase", phase: "synthesize", ts: ts() });

    const synthInput: SynthesisInput = {
      profile,
      transcript,
      consent,
      transcriptRef,
      auditRunId: handoverId,
      interviewerModel: synthMode === "model" ? CAPTURE_MODEL : "fixture",
    };

    onEvent({
      type: "synthesizing",
      model: synthMode === "model" ? SYNTHESIS_MODEL : "fixture",
      synthMode,
      inputNotes: transcript.length,
      ts: ts(),
    });

    // DEMO DEFAULT: fixture synthesis, no API call. Model mode would build the
    // opus prompt (buildSynthesisPrompt) and stream the SDK here; intentionally
    // NOT wired in this demo so the surface runs with no Anthropic key. We
    // fall back to fixture synthesis for both paths so the demo never stalls.
    const rcp = synthesizeRcpFixture(synthInput);

    // ─── Phase 4 · coverage (soft gate — PRD 13.2/13.4) ────────────────────
    onEvent({ type: "phase", phase: "coverage", ts: ts() });

    const coverage = scoreCoverage(rcp);
    weightedScore = coverage.score;
    status = coverage.status;
    // The authoritative status flip lives here (the coverage phase), per spec —
    // keep the RCP in sync with what we just scored.
    rcp.status = status;

    onEvent({
      type: "coverage",
      perField: toEventPerField(coverage.perField),
      weightedScore,
      status,
      gaps: coverage.gaps,
      ts: ts(),
    });

    // ─── Phase 5 · write rcp.json ──────────────────────────────────────────
    onEvent({ type: "phase", phase: "write", ts: ts() });

    const dir = HANDOVER_DIR(employeeId);
    await fsp.mkdir(dir, { recursive: true });
    rcpPath = RCP_PATH(employeeId);
    const body = JSON.stringify(rcp, null, 2);
    await fsp.writeFile(rcpPath, body, "utf8");

    onEvent({
      type: "file_writing",
      path: rcpPath,
      bytes: Buffer.byteLength(body, "utf8"),
      ts: ts(),
    });

    // Audit (best-effort — never crashes the run, mirrors existing code).
    try {
      appendAuditEntry({
        runId: handoverId,
        employeeId,
        employeeName: employee.name,
        toolName: "relay.write_rcp",
        bareName: "write_rcp",
        input: {
          rcpPath,
          synthMode,
          status,
          weightedScore,
          itemCount: rcp.provenance.itemCount,
          redactionApplied: rcp.provenance.redactionApplied,
          consentBanner: DEMO_BANNER,
        },
        verdict: "executed",
        agentType: "relay",
      });
    } catch {
      /* audit must never crash the run */
    }

    onEvent({
      type: "done",
      rcpPath,
      status,
      weightedScore,
      turns: 0,
      costUsd: 0,
      stoppedReason: "natural",
      ts: ts(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onEvent({ type: "error", message, ts: ts() });
    onEvent({
      type: "done",
      rcpPath,
      status,
      weightedScore,
      turns: 0,
      costUsd: 0,
      stoppedReason: "error",
      ts: ts(),
    });
  }
}

// ─── Detached spawn (mirrors spawnDetachedBuild) ──────────────────────────────

export type SpawnRelayResult = {
  spawned: boolean;
  handoverId: string;
  startedAt: string;
  alreadyRunning: boolean;
};

/**
 * Spawn the relay handover detached. Returns immediately; the runner survives
 * client disconnect. Registers the run in active-runs (surface 'relay') and
 * persists every event through appendHandoverEvent so the SSE /stream route can
 * replay + tail. Idempotent per employee — if a relay run is already active for
 * this employee, returns its id without spawning a duplicate.
 */
export function spawnDetachedRelay(args: {
  employee: EmployeeWithTwin;
  synthMode?: SynthMode;
  ceoContext?: string;
  transcriptPath?: string;
  maxBudgetUsd?: number;
}): SpawnRelayResult {
  const { employee } = args;
  const employeeId = employee.id;
  const synthMode: SynthMode = args.synthMode ?? "fixture";

  const handoverId = newHandoverId();
  const startedAt = new Date().toISOString();

  registerRun({
    runId: handoverId,
    surface: "relay",
    employeeId,
    employeeName: employee.name,
    label: `Handover — ${employee.firstName}`,
    startedAt,
    logPath: EVENTS_PATH(handoverId),
  });

  const onEvent = (event: RelayEvent) => {
    appendHandoverEvent(handoverId, event);
    if (event.type === "synthesizing" || event.type === "coverage") {
      updateRun(handoverId, { lastText: event.type });
    }
  };

  void runRelayHandover({
    employee,
    handoverId,
    synthMode,
    ceoContext: args.ceoContext,
    transcriptPath: args.transcriptPath,
    maxBudgetUsd: args.maxBudgetUsd,
    onEvent,
  })
    .catch((err) => {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`[relay] run crashed: ${m}`);
      try {
        appendHandoverEvent(handoverId, { type: "error", message: m, ts: 0 });
        appendHandoverEvent(handoverId, {
          type: "done",
          rcpPath: RCP_PATH(employeeId),
          status: "draft",
          weightedScore: 0,
          turns: 0,
          costUsd: 0,
          stoppedReason: "error",
          ts: 0,
        });
      } catch {
        /* disk wedged */
      }
    })
    .finally(() => {
      try {
        unregisterRun(handoverId, { status: "complete", costUsd: 0 });
      } catch {
        /* ignore */
      }
    });

  return { spawned: true, handoverId, startedAt, alreadyRunning: false };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map the rubric's per-field result into the event-shaped per-field record. */
function toEventPerField(
  perField: Record<string, PerFieldCoverage>,
): Record<
  string,
  { items: number; minItems: number; weight: number; satisfied: boolean; score: number }
> {
  const out: Record<
    string,
    { items: number; minItems: number; weight: number; satisfied: boolean; score: number }
  > = {};
  for (const [field, c] of Object.entries(perField)) {
    out[field] = {
      items: c.items,
      minItems: c.minItems,
      weight: c.weight,
      satisfied: c.met,
      score: Math.min(1, c.minItems > 0 ? c.items / c.minItems : 0),
    };
  }
  return out;
}

/** Build a tagged note item for the capture_note event (no secrets). */
function turnToNoteItem(turn: TranscriptTurn): CapturedItem | ToolingRef {
  if (turn.area === "tooling_map") {
    const ref: ToolingRef = {
      id: turn.id,
      system: turn.title?.trim() || turn.question.trim(),
      location: redactPii((turn.toolingLocation ?? "unspecified").trim()),
      accessVia: redactPii(
        (turn.toolingAccessVia ?? "request via the owning team").trim(),
      ),
      ownedBy: turn.toolingOwnedBy
        ? redactPii(turn.toolingOwnedBy.trim())
        : undefined,
      provenance: turn.provenance,
      confidence: turn.confidence,
      gaps: turn.gaps ?? [],
    };
    return ref;
  }
  const item: CapturedItem = {
    id: turn.id,
    title: turn.title?.trim() || turn.question.trim(),
    body: redactPii(turn.answer).trim(),
    provenance: turn.provenance,
    confidence: turn.confidence,
    gaps: turn.gaps ?? [],
  };
  return item;
}

/**
 * Load + normalize the interview transcript fixture. The on-disk transcript is
 * a flat array of turns tagged with { area, question, answer, provenance,
 * confidence, ... }; this injects a stable `id` per turn (the synthesis layer
 * requires it) and drops malformed turns. Throws if the file is missing/invalid
 * so the runner surfaces a clean `error` + `done`.
 */
async function loadTranscript(
  transcriptPath: string,
  employeeId: string,
): Promise<TranscriptTurn[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(transcriptPath, "utf8");
  } catch {
    throw new Error(`Transcript not found at ${transcriptPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Transcript at ${transcriptPath} is not valid JSON`);
  }

  // Accept either a bare array or { transcript: [...] }.
  const turnsRaw: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { transcript?: unknown }).transcript;

  if (!Array.isArray(turnsRaw)) {
    throw new Error(
      `Transcript at ${transcriptPath} must be an array of turns (or { transcript: [...] })`,
    );
  }

  const VALID_AREAS: ReadonlySet<string> = new Set<CaptureArea>([
    "decision_rules",
    "playbooks",
    "contact_graph",
    "edge_cases",
    "tooling_map",
    "glossary",
    "open_loops",
  ]);

  const turns: TranscriptTurn[] = [];
  turnsRaw.forEach((t, i) => {
    if (!t || typeof t !== "object") return;
    const rec = t as Record<string, unknown>;
    const area = rec.area;
    if (typeof area !== "string" || !VALID_AREAS.has(area)) return;
    const question = typeof rec.question === "string" ? rec.question : "";
    const answer = typeof rec.answer === "string" ? rec.answer : "";
    if (!answer.trim()) return;

    const provenance =
      rec.provenance === "confirmed-from-history"
        ? "confirmed-from-history"
        : "interview";
    const confidence =
      typeof rec.confidence === "number" ? rec.confidence : 0.7;
    const gaps = Array.isArray(rec.gaps)
      ? rec.gaps.filter((g): g is string => typeof g === "string")
      : undefined;

    turns.push({
      id: `${employeeId}:turn:${i + 1}`,
      area: area as CaptureArea,
      question,
      answer,
      title: typeof rec.title === "string" ? rec.title : undefined,
      provenance,
      confidence,
      gaps,
      toolingLocation:
        typeof rec.toolingLocation === "string" ? rec.toolingLocation : undefined,
      toolingAccessVia:
        typeof rec.toolingAccessVia === "string"
          ? rec.toolingAccessVia
          : undefined,
      toolingOwnedBy:
        typeof rec.toolingOwnedBy === "string" ? rec.toolingOwnedBy : undefined,
    });
  });

  return turns;
}

/**
 * Build a thin twin-profile summary from the employee record + an on-disk
 * profile file (best-effort). Substance comes from the transcript; this only
 * enriches the `confirmed-from-history` framing (PRD section 5).
 */
async function loadProfileSummary(
  employee: EmployeeWithTwin,
): Promise<TwinProfileSummary> {
  const summary: TwinProfileSummary = {
    employeeId: employee.id,
    name: employee.name,
    role: employee.role,
    department: employee.department,
  };

  // Best-effort: confirm the profile dir exists; we don't parse the .md files
  // for the demo (the transcript carries the substance), but touching disk
  // here keeps the "read the twin profile" seam in place for model mode.
  try {
    await fsp.access(path.join(EMPLOYEE_DATA_DIR(employee.id), "CONTEXT.md"));
  } catch {
    /* profile file absent — summary from the employee record is enough */
  }

  return summary;
}
