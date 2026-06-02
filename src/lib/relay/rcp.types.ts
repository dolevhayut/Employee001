/**
 * Relay RCP contract — portable, no E001 coupling (PRD section 6).
 *
 * This file is the spinout-surviving contract for the Role Context Package (RCP).
 * It MUST have ZERO imports from anywhere else in this repo — pure types only.
 * Any consumer (the relay runner, exportRCP/ingestRCP, or a foreign successor
 * agent) can depend on this module without pulling in Employee001 internals.
 */

/**
 * Portable contract version literal. Frozen so `ingestRCP` can validate a
 * foreign RCP before seeding it. Bump on breaking changes to this contract.
 */
export const RCP_SCHEMA_VERSION = "relay-rcp-1" as const;

/** Where a captured fact came from. Per PRD 6, every item carries provenance. */
export type Provenance = "interview" | "confirmed-from-history";

/**
 * One structured, captured fact. Every captured-item type carries
 * provenance + confidence + gaps (PRD 6).
 */
export interface CapturedItem {
  /** Stable id for the item (used for audit + dedupe). */
  id: string;
  /** Short label. For glossary, this is the term being defined. */
  title: string;
  /** The fact prose. For playbooks this holds ordered steps (markdown list ok). */
  body: string;
  /** How this fact was obtained. */
  provenance: Provenance;
  /** Interviewer/synthesis confidence, 0..1. */
  confidence: number;
  /** Known unknowns / what still needs confirming for this item. */
  gaps: string[];
}

/**
 * A reference to a system/tool the person uses.
 *
 * REFERENCES ONLY. This type DELIBERATELY has no secret/credential field:
 * NEVER store passwords, API keys, tokens, or any secret values here. The
 * no-secrets invariant is enforced by (1) this type having no such field,
 * (2) `ingestRCP` validation, and (3) the PreToolUse redaction hook.
 *
 * Like CapturedItem, every ToolingRef carries provenance + confidence + gaps.
 */
export interface ToolingRef {
  /** Stable id for the reference (used for audit + dedupe). */
  id: string;
  /** System / tool name (e.g. "Datadog", "internal billing console"). */
  system: string;
  /** Where it lives (URL host, internal hostname, "behind VPN", etc.). */
  location: string;
  /** How access is granted — NOT the credential itself (e.g. "request via IT ticket"). */
  accessVia: string;
  /** Who owns / administers the system, if known. Role/handle only — no PII. */
  ownedBy?: string;
  /** How this reference was obtained. */
  provenance: Provenance;
  /** Confidence, 0..1. */
  confidence: number;
  /** Known unknowns for this reference. */
  gaps: string[];
}

/**
 * Consent record (PRD 13.5). `banner` must carry the literal demo banner
 * string: 'DEMO — not legally reviewed, not for production, not published'.
 */
export interface ConsentRecord {
  /** The twin/employee id the handover is about. */
  subjectId: string;
  /** ISO-8601 timestamp consent was granted. */
  grantedAt: string;
  /** The mandatory demo banner string shown to the subject. */
  banner: string;
}

/**
 * Package-level provenance roll-up. Per-item provenance (provenance +
 * confidence + gaps) lives on each CapturedItem / ToolingRef; this is the
 * document-level summary.
 */
export interface RcpProvenance {
  /** Model id that ran the capture interview (or "fixture"). */
  interviewerModel: string;
  /** Reference to the source transcript. */
  transcriptRef: string;
  /** Whether the PII-redaction pass was applied (PRD 13.5). */
  redactionApplied: boolean;
  /** Total captured items across all fields. */
  itemCount: number;
  /** Consent gate record (PRD 13.5). */
  consent: ConsentRecord;
  /** Run id used for audit attribution (equals the handoverId). */
  auditRunId: string;
}

/** How the RCP was produced — recorded for audit/repro. */
export type SynthMode = "fixture" | "model";

/** SOFT gate label (PRD 13.2). Never blocks export — purely an unlock/label. */
export type RcpStatus = "draft" | "handover-ready";

/**
 * Role Context Package — the portable handover artifact written to
 * data/handovers/<employeeId>/rcp.json (PRD section 6).
 *
 * source_twin_id / schema_version / generated_at / synth_mode / status /
 * provenance are document-level metadata and are NOT coverage-scored.
 */
export interface RoleContextPackage {
  /**
   * The twin/employee id this RCP was derived from (e.g. 'daniel-rivera').
   * Equals EmployeeWithTwin.id. NOT itself a captured item — no provenance wrapper.
   */
  source_twin_id: string;
  /**
   * Portable contract version literal. Frozen so `ingestRCP` can validate.
   * Bump on breaking changes.
   */
  schema_version: "relay-rcp-1";
  /** ISO-8601 timestamp the RCP was synthesized/written. */
  generated_at: string;
  /**
   * How this RCP was produced. 'fixture' = deterministic demo synthesis
   * (no API). 'model' = opus synthesis. Recorded for audit/repro.
   */
  synth_mode: SynthMode;
  /**
   * SOFT gate (demo default 13.2). Flips to 'handover-ready' when weighted
   * coverage >= coverageRubric.readyThreshold. Never blocks the user.
   */
  status: RcpStatus;
  /**
   * Decision rules, approval thresholds, when-to-escalate logic. Each
   * item.body is the rule prose. Coverage-weighted heavily.
   */
  decision_rules: CapturedItem[];
  /**
   * Step-by-step processes the person runs. item.body holds ordered steps
   * (markdown list ok).
   */
  playbooks: CapturedItem[];
  /**
   * Who owns what + informal key people. item.body names person + their area
   * + why they matter. References to humans only — no private contact info /
   * no PII beyond role + handle.
   */
  contact_graph: CapturedItem[];
  /**
   * Edge cases + war-story resolutions ('watch out for X'). item.body =
   * situation + how it was handled.
   */
  edge_cases: CapturedItem[];
  /**
   * Systems + access map. REFERENCES ONLY — system name, where it lives, who
   * grants access. NEVER passwords/keys/tokens/secret values. Enforced by
   * type (ToolingRef has no secret field) + PreToolUse redaction.
   */
  tooling_map: ToolingRef[];
  /**
   * Internal terms, acronyms, nicknames. item.body = definition;
   * item.title = the term.
   */
  glossary: CapturedItem[];
  /**
   * In-flight tasks / loose threads at the moment of handover. item.body =
   * task + current state + next action.
   */
  open_loops: CapturedItem[];
  /** Package-level provenance roll-up (per-item provenance lives on each item). */
  provenance: RcpProvenance;
}
