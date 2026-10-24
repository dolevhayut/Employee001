/**
 * Relay · the portable Role Context Package contract.
 *
 * exportRCP / ingestRCP are the read and write halves of the handover package
 * as a portable file (rcp.json): another tool, or another Employee001, can
 * read a package exported here. Zero dependency on E001 internals beyond
 * ./rcp.types and the package store.
 */

import { RCP_SCHEMA_VERSION, type RoleContextPackage } from "./rcp.types";
import { loadPackage, savePackage } from "./package-store";

export { RCP_SCHEMA_VERSION } from "./rcp.types";
export type {
  RoleContextPackage,
  CapturedItem,
  ToolingRef,
  ConsentRecord,
  RcpProvenance,
  Provenance,
  SynthMode,
  RcpStatus,
} from "./rcp.types";
export { scoreCoverage } from "./coverage";
export type { CoverageResult } from "./coverage";
export { verifyRcpEvidence } from "./evidence";

// ─── exportRCP (portable READ side of the contract) ───────────────────────────

/** The twin's handover package, validated, or null if absent or invalid. */
export async function exportRCP(employeeId: string): Promise<RoleContextPackage | null> {
  const result = validateRCP(await loadPackage(employeeId));
  return result.ok ? result.rcp : null;
}

// ─── ingestRCP (portable INGEST side — Phase 2 agent→agent) ───────────────────

/**
 * Validate a foreign RCP (schema_version, required fields, and the no-secrets
 * invariant on tooling_map) and save it as that twin's handover package.
 */
export async function ingestRCP(
  rcp: RoleContextPackage,
): Promise<{ ok: true; employeeId: string } | { ok: false; error: string }> {
  const result = validateRCP(rcp as unknown);
  if (!result.ok) return { ok: false, error: result.error };
  const employeeId = result.rcp.source_twin_id;
  if (!/^[a-z0-9_][a-z0-9_-]{1,63}$/.test(employeeId)) return { ok: false, error: "source_twin_id is not a valid twin id" };
  try {
    await savePackage(employeeId, result.rcp);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to persist ingested RCP: ${m}` };
  }
  return { ok: true, employeeId };
}

// ─── Validation (shared by exportRCP + ingestRCP) ─────────────────────────────

type ValidateResult =
  | { ok: true; rcp: RoleContextPackage }
  | { ok: false; error: string };

const ITEM_FIELDS = [
  "decision_rules",
  "playbooks",
  "contact_graph",
  "edge_cases",
  "glossary",
  "open_loops",
] as const;

/**
 * Validate an unknown value against the portable RCP contract:
 *  - schema_version equals the frozen RCP_SCHEMA_VERSION
 *  - source_twin_id is a non-empty string
 *  - the seven array fields are present + arrays
 *  - the NO-SECRETS invariant: no tooling_map entry carries a secret-looking key
 */
function validateRCP(value: unknown): ValidateResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "RCP is not an object" };
  }
  const rec = value as Record<string, unknown>;

  if (rec.schema_version !== RCP_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schema_version mismatch: expected "${RCP_SCHEMA_VERSION}", got ${JSON.stringify(
        rec.schema_version,
      )}`,
    };
  }

  if (typeof rec.source_twin_id !== "string" || !rec.source_twin_id.trim()) {
    return { ok: false, error: "source_twin_id missing or empty" };
  }

  for (const field of ITEM_FIELDS) {
    if (!Array.isArray(rec[field])) {
      return { ok: false, error: `field "${field}" must be an array` };
    }
  }
  if (!Array.isArray(rec.tooling_map)) {
    return { ok: false, error: `field "tooling_map" must be an array` };
  }

  // NO-SECRETS invariant on tooling_map (enforced by type AND here): reject any
  // entry that carries a secret-bearing key. The contract type has no secret
  // field; a foreign producer must not smuggle one in.
  const SECRET_KEYS = /^(secret|password|passwd|token|api[_-]?key|access[_-]?key|credential|bearer|private[_-]?key)$/i;
  for (const entry of rec.tooling_map as unknown[]) {
    if (entry && typeof entry === "object") {
      for (const key of Object.keys(entry as Record<string, unknown>)) {
        if (SECRET_KEYS.test(key)) {
          return {
            ok: false,
            error: `tooling_map entry carries a forbidden secret field "${key}" — RCP references only, never credentials`,
          };
        }
      }
    }
  }

  return { ok: true, rcp: value as RoleContextPackage };
}
