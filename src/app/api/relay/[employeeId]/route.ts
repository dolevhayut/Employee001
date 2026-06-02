import { NextRequest } from "next/server";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { spawnDetachedRelay } from "@/lib/relay/runner";
import { exportRCP, type SynthMode } from "@/lib/relay";

export const runtime = "nodejs";
// The route returns immediately after kicking off the runner; the runner
// itself is detached and unbounded by this. Keep the cap high in case
// Vercel-style platforms tie the function to the response anyway.
export const maxDuration = 600;

/**
 * Start (or rejoin) a Relay handover run for an employee.
 *
 * Mirrors the Twin Builder POST route: the run is **detached** — once started,
 * the runner continues even if the client disconnects. Events are persisted to
 * `data/relay/{handoverId}/events.jsonl` so a fresh page load can tail them via
 * the companion GET `/stream` endpoint.
 *
 * Body: `{ synthMode?: 'fixture' | 'model'; ceoContext?: string;
 *          transcriptPath?: string; maxBudgetUsd?: number }`.
 * `synthMode` defaults to `'fixture'` — the no-API demo default. ONLY
 * `synthMode: 'model'` requires `ANTHROPIC_API_KEY`; the fixture demo must run
 * end-to-end with no key configured (so we do NOT replicate the twin-builder
 * hard key guard for fixture mode).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    synthMode?: SynthMode;
    ceoContext?: string;
    transcriptPath?: string;
    maxBudgetUsd?: number;
  };

  // Default to the deterministic, no-API fixture path. Anything other than the
  // explicit literal 'model' falls back to 'fixture'.
  const synthMode: SynthMode = body.synthMode === "model" ? "model" : "fixture";

  const fromDisk = await loadEmployeesFromDisk();
  const allEmployees = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  const employee = allEmployees.find((e) => e.id === employeeId);

  if (!employee) {
    return Response.json(
      { error: `unknown employee: ${employeeId}` },
      { status: 404 }
    );
  }

  // The key is ONLY required for the model-synthesis path. Fixture mode (the
  // demo default) produces a complete rcp.json with zero model calls.
  if (synthMode === "model" && !process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "ANTHROPIC_API_KEY is not configured (only required for synthMode: 'model')",
      },
      { status: 500 }
    );
  }

  const result = spawnDetachedRelay({
    employee,
    synthMode,
    ceoContext: body.ceoContext,
    transcriptPath: body.transcriptPath,
    maxBudgetUsd: body.maxBudgetUsd,
  });

  return Response.json({
    handoverId: result.handoverId,
    synthMode,
    alreadyRunning: result.alreadyRunning,
    startedAt: result.startedAt,
  });
}

/**
 * Return the latest persisted RCP status for an employee, if any.
 *
 * Reads + validates `data/handovers/{employeeId}/rcp.json` via the portable
 * `exportRCP` contract. Used by the UI preflight to decide whether to show a
 * "Start handover" button or rehydrate an already-produced package.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;

  const rcp = exportRCP(employeeId);
  if (!rcp) {
    return Response.json({ exists: false }, { status: 404 });
  }

  return Response.json({
    exists: true,
    employeeId: rcp.source_twin_id,
    status: rcp.status,
    synthMode: rcp.synth_mode,
    generatedAt: rcp.generated_at,
    schemaVersion: rcp.schema_version,
    rcp,
  });
}
