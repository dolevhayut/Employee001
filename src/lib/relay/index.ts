/**
 * Relay · public barrel — the SPINOUT-SURVIVING CONTRACT SURFACE (PRD section 7).
 *
 * This is the thin, deliberate boundary the rest of Employee001 (and any future
 * spinout / agent→agent successor) imports from. Kept PRAGMATIC for the demo —
 * NO adapters/ports ceremony. The portable type contract lives in ./rcp.types
 * (zero E001 imports); this barrel re-exports it plus the four contract
 * functions:
 *
 *   - createHandover  — mint a handover + run it (wrapper of runRelayHandover)
 *   - exportRCP       — portable READ side: load + validate data/handovers/<id>/rcp.json
 *   - ingestRCP       — portable INGEST side: validate a foreign RCP (Phase 2 agent→agent)
 *   - the RoleContextPackage type + schema-version constant
 *
 * exportRCP / ingestRCP have ZERO dependency on E001 internals beyond the
 * portable ./rcp.types — they are the read/write halves of the spinout contract.
 */

import fs from "fs";
import path from "path";

import {
  RCP_SCHEMA_VERSION,
  type RoleContextPackage,
} from "./rcp.types";
import {
  runRelayHandover,
  newHandoverId,
  type RelayEvent,
  type RunRelayHandoverArgs,
} from "./runner";

// ─── Re-exports (the portable contract) ───────────────────────────────────────

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
export {
  runRelayHandover,
  spawnDetachedRelay,
  appendHandoverEvent,
  newHandoverId,
  DEMO_BANNER,
} from "./runner";
export type {
  RelayEvent,
  RelayPhase,
  RelayStoppedReason,
  RunRelayHandoverArgs,
  SpawnRelayResult,
} from "./runner";
export { scoreCoverage } from "./coverage";
export type { CoverageResult } from "./coverage";

// ─── Path helper (kept local so the barrel is self-contained) ─────────────────

const RCP_PATH = (employeeId: string) =>
  path.join(process.cwd(), "data", "handovers", employeeId, "rcp.json");

// ─── createHandover ───────────────────────────────────────────────────────────

/**
 * Mint a handoverId + run the relay handover to completion (collecting events).
 * Thin wrapper over runRelayHandover for callers that want a one-shot, awaited
 * run (e.g. the headless demo script). The detached/streamed path is
 * spawnDetachedRelay (used by the POST route).
 *
 * synthMode defaults to 'fixture' — the no-API demo default.
 */
export async function createHandover(
  args: Omit<RunRelayHandoverArgs, "handoverId" | "onEvent"> & {
    handoverId?: string;
    onEvent?: (e: RelayEvent) => void;
  },
): Promise<{ handoverId: string; rcpPath: string; events: RelayEvent[] }> {
  const handoverId = args.handoverId ?? newHandoverId();
  const events: RelayEvent[] = [];

  await runRelayHandover({
    ...args,
    synthMode: args.synthMode ?? "fixture",
    handoverId,
    onEvent: (e) => {
      events.push(e);
      args.onEvent?.(e);
    },
  });

  return { handoverId, rcpPath: RCP_PATH(args.employee.id), events };
}

// ─── exportRCP (portable READ side of the contract) ───────────────────────────

/**
 * Read + validate data/handovers/<employeeId>/rcp.json and return the typed
 * RCP, or null if the file is absent or fails validation. Zero dependency on
 * E001 internals — the portable read side of the contract.
 */
export function exportRCP(employeeId: string): RoleContextPackage | null {
  try {
    const raw = fs.readFileSync(RCP_PATH(employeeId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const result = validateRCP(parsed);
    return result.ok ? result.rcp : null;
  } catch {
    return null;
  }
}

// ─── ingestRCP (portable INGEST side — Phase 2 agent→agent) ───────────────────

/**
 * Validate a FOREIGN RCP (schema_version, required fields, and the no-secrets
 * invariant on tooling_map) so it can seed a successor twin. For the demo this
 * validates + persists to data/handovers/<source_twin_id>/rcp.json; it does NOT
 * spin a model. Returns a discriminated result.
 */
export function ingestRCP(
  rcp: RoleContextPackage,
): { ok: true; employeeId: string } | { ok: false; error: string } {
  const result = validateRCP(rcp as unknown);
  if (!result.ok) return { ok: false, error: result.error };

  const employeeId = result.rcp.source_twin_id;
  try {
    const dest = RCP_PATH(employeeId);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(result.rcp, null, 2), "utf8");
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
