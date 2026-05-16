import { NextRequest } from "next/server";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { spawnDetachedBuild } from "@/lib/twin-build-runner";

export const runtime = "nodejs";
// The route returns immediately after kicking off the runner; the runner
// itself is unbounded by this. Keep the cap high in case Vercel-style
// platforms tie the function to the response anyway.
export const maxDuration = 600;

/**
 * Start (or rejoin) a Twin Builder run for an employee.
 *
 * The run is **detached** — once started, the runner continues even if the
 * client disconnects, the page is closed, or `next dev` keeps going across
 * tabs. Events are persisted to `data/employees/{id}/.versions/builds/
 * {buildId}.events.jsonl` so a fresh page load can tail them via the
 * companion GET `/stream` endpoint.
 *
 * Idempotency: if a build is already active for this employee, returns
 * `{ buildId, alreadyRunning: true }` without spawning a duplicate run.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    ceoContext?: string;
    maxBudgetUsd?: number;
    /** Historical window the builder will search. Clamped to [30, 360]; defaults to 90. */
    lookbackDays?: number;
  };

  // Clamp + default the lookback window before forwarding to the runner.
  // Manual "build now" button posts an empty body — keep that backward-compatible.
  const rawLookback =
    typeof body.lookbackDays === "number" && Number.isFinite(body.lookbackDays)
      ? Math.round(body.lookbackDays)
      : 90;
  const lookbackDays = Math.min(360, Math.max(30, rawLookback));

  const fromDisk = await loadEmployeesFromDisk();
  const allEmployees = [
    ...fromDisk,
    ...getHiredEmployees().filter(
      (h) => !fromDisk.some((e) => e.id === h.id)
    ),
  ];
  const employee = allEmployees.find((e) => e.id === employeeId);

  if (!employee) {
    return Response.json(
      { error: `unknown employee: ${employeeId}` },
      { status: 404 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const result = spawnDetachedBuild({
    employee,
    lookbackDays,
    ceoContext: body.ceoContext,
    maxBudgetUsd: body.maxBudgetUsd,
  });

  return Response.json({
    buildId: result.buildId,
    alreadyRunning: result.alreadyRunning,
    startedAt: result.startedAt,
  });
}
