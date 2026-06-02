/**
 * Relay handover coverage scorer — the Gap-Finder rubric.
 *
 * DEMO-DEFAULT RUBRIC (PRD dilemma 13.4), pending Dolev's sign-off.
 * ------------------------------------------------------------------
 * Implements the demo-default coverage rubric: a weighted percentage of RCP
 * fields populated to a minimum item count. Weights sum to 1.0. This is a
 * SOFT gate (PRD 13.2) — it produces a meter + a `handover-ready` unlock and
 * is NEVER allowed to block export. The thresholds, weights, and minItems
 * below are demo defaults and may be revised once the rubric is signed off.
 *
 * Deterministic — no model call. Used by the coverage phase of
 * `runRelayHandover` and (read-only) by the gap-finder subagent's scoring.
 *
 * Document-level fields (source_twin_id, schema_version, generated_at,
 * synth_mode, status, provenance) are intentionally NOT scored.
 */

import type { RoleContextPackage } from "./rcp.types";

/** Fields the rubric scores. Document-level fields are excluded by design. */
type ScoredField =
  | "decision_rules"
  | "playbooks"
  | "contact_graph"
  | "edge_cases"
  | "tooling_map"
  | "open_loops"
  | "glossary";

interface RubricEntry {
  minItems: number;
  weight: number;
}

/**
 * DEMO-DEFAULT rubric (PRD 13.4). Weights sum to 1.0.
 * weightedScore = Σ weight * min(1, items / minItems).
 */
const COVERAGE_RUBRIC: Record<ScoredField, RubricEntry> = {
  decision_rules: { minItems: 4, weight: 0.25 },
  playbooks: { minItems: 3, weight: 0.2 },
  contact_graph: { minItems: 4, weight: 0.15 },
  edge_cases: { minItems: 3, weight: 0.15 },
  tooling_map: { minItems: 3, weight: 0.1 },
  open_loops: { minItems: 2, weight: 0.1 },
  glossary: { minItems: 3, weight: 0.05 },
};

/** Score at/above which `status` flips draft -> handover-ready. DEMO DEFAULT. */
const READY_THRESHOLD = 0.7;

const SCORED_FIELDS = Object.keys(COVERAGE_RUBRIC) as ScoredField[];

export interface PerFieldCoverage {
  items: number;
  minItems: number;
  met: boolean;
  weight: number;
}

export interface CoverageResult {
  perField: Record<ScoredField, PerFieldCoverage>;
  /** Weighted fraction of the rubric satisfied, 0..1. */
  score: number;
  status: "draft" | "handover-ready";
  /** Human-readable list of fields still under minItems (e.g. "decision_rules: 1/4"). */
  gaps: string[];
}

/**
 * Scores an RCP against the demo-default coverage rubric (13.4).
 *
 * Accepts the full RoleContextPackage or any partial that carries the seven
 * scored array fields — robust against in-progress / undefined fields.
 */
export function scoreCoverage(
  rcp: Pick<RoleContextPackage, ScoredField> | Partial<RoleContextPackage>,
): CoverageResult {
  const perField = {} as Record<ScoredField, PerFieldCoverage>;
  const gaps: string[] = [];
  let weightedScore = 0;

  for (const field of SCORED_FIELDS) {
    const { minItems, weight } = COVERAGE_RUBRIC[field];
    const value = (rcp as Partial<RoleContextPackage>)[field];
    const items = Array.isArray(value) ? value.length : 0;
    const met = items >= minItems;

    perField[field] = { items, minItems, met, weight };
    weightedScore += weight * Math.min(1, items / minItems);

    if (!met) {
      gaps.push(`${field}: ${items}/${minItems}`);
    }
  }

  // Clamp to guard against float drift; weights sum to 1.0 by construction.
  const score = Math.min(1, Math.max(0, weightedScore));
  const status: CoverageResult["status"] =
    score >= READY_THRESHOLD ? "handover-ready" : "draft";

  return { perField, score, status, gaps };
}

export { COVERAGE_RUBRIC, READY_THRESHOLD };
