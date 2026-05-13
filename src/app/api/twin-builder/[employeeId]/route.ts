import { NextRequest } from "next/server";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
import { getHiredEmployees } from "@/lib/hired-agents";
import { runTwinBuilder, type TwinBuilderEvent } from "@/lib/twin-builder";
import {
  newBuildId,
  markBuildActive,
  bumpBuildActivity,
  clearBuildActive,
  getActiveBuild,
  appendBuildEvent,
} from "@/lib/twin-versions";
import { TWIN_FILE_NAMES } from "@/lib/twin-builder-types";

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
  };

  const allEmployees = [
    ...EMPLOYEES_WITH_TWIN,
    ...getHiredEmployees().filter(
      (h) => !EMPLOYEES_WITH_TWIN.some((e) => e.id === h.id)
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

  // Already running? Just point the client at it.
  const existing = getActiveBuild(employeeId);
  if (existing) {
    return Response.json({
      buildId: existing.buildId,
      alreadyRunning: true,
      startedAt: existing.startedAt,
    });
  }

  const buildId = newBuildId();
  const startedAt = new Date().toISOString();

  // Register the build as active *before* the runner spawns so a parallel
  // POST hits the idempotency check above. Snapshot the file count so the
  // shell banner has correct progress immediately on page load.
  markBuildActive({
    employeeId,
    buildId,
    startedAt,
    lastEventTs: 0,
    eventCount: 0,
    filesWritten: 0,
    filesTotal: TWIN_FILE_NAMES.length,
    costUsd: 0,
    ceoContext: body.ceoContext,
  });

  // The persistence onEvent: writes every event to disk + bumps the active
  // sentinel so the banner / page polls reflect progress without parsing
  // the events file. Best-effort — never throw out of the runner.
  let eventCount = 0;
  let filesWrittenCount = 0;
  let lastCostUsd = 0;

  const onEvent = (event: TwinBuilderEvent) => {
    eventCount += 1;
    if (event.type === "file_done") filesWrittenCount += 1;
    try {
      appendBuildEvent(employeeId, buildId, event);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`[twin-builder] event persist failed: ${m}`);
    }
    try {
      bumpBuildActivity(employeeId, {
        eventCount,
        lastEventTs: event.ts,
        filesWritten: filesWrittenCount,
        costUsd: event.type === "done" ? event.costUsd : lastCostUsd,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`[twin-builder] activity bump failed: ${m}`);
    }
  };

  // Detached — POST returns immediately, runner survives client disconnect.
  // We deliberately do NOT `await` this; the framework should not tie the
  // runner's lifetime to the HTTP response. (In Vercel serverless this still
  // gets killed when the function ends; a queue is the proper fix for
  // production. For local `next dev` and self-hosted Node this works.)
  void runTwinBuilder({
    employee,
    buildId,
    ceoContext: body.ceoContext,
    maxBudgetUsd: body.maxBudgetUsd,
    onEvent,
  })
    .catch((err) => {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`[twin-builder] run crashed: ${m}`);
      try {
        appendBuildEvent(employeeId, buildId, {
          type: "error",
          message: m,
          ts: 0,
        });
        appendBuildEvent(employeeId, buildId, {
          type: "done",
          filesWritten: [],
          turns: 0,
          costUsd: lastCostUsd,
          stoppedReason: "natural",
          ts: 0,
        });
      } catch {
        /* ignore — disk wedged */
      }
    })
    .finally(() => {
      try {
        clearBuildActive(employeeId);
      } catch {
        /* ignore */
      }
    });

  return Response.json({
    buildId,
    alreadyRunning: false,
    startedAt,
  });
}
