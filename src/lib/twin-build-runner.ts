// Detached twin-builder spawn helper.
//
// Shared by:
//  - POST /api/twin-builder/[employeeId]/route.ts (manual "build now")
//  - POST /api/invites/[token]/complete/route.ts (auto-fire on consent)
//  - GET  /api/connections/[id]/route.ts         (auto-resume after first ACTIVE)
//
// Single source of truth for how a build is registered, persisted, and
// reaped. The runner itself lives in src/lib/twin-builder.ts — this module
// only wires it into the active-build sentinel + per-build event log.

import "server-only";
import path from "path";
import fs from "fs/promises";
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
import type { EmployeeWithTwin } from "@/lib/employees";

export type PendingBuildSidecar = {
  status: "pending_toolkits";
  lookbackDays: number;
  createdAt: string;
  ceoContext?: string;
};

const PENDING_FILE = (employeeId: string) =>
  path.join(
    process.cwd(),
    "data",
    "employees",
    employeeId,
    ".builder-pending.json"
  );

/** Write the "waiting on first ACTIVE connection" sidecar. */
export async function writePendingBuild(
  employeeId: string,
  body: Omit<PendingBuildSidecar, "status" | "createdAt">
): Promise<void> {
  const dir = path.dirname(PENDING_FILE(employeeId));
  await fs.mkdir(dir, { recursive: true });
  const payload: PendingBuildSidecar = {
    status: "pending_toolkits",
    createdAt: new Date().toISOString(),
    ...body,
  };
  await fs.writeFile(
    PENDING_FILE(employeeId),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

export async function readPendingBuild(
  employeeId: string
): Promise<PendingBuildSidecar | null> {
  try {
    const raw = await fs.readFile(PENDING_FILE(employeeId), "utf8");
    return JSON.parse(raw) as PendingBuildSidecar;
  } catch {
    return null;
  }
}

export async function clearPendingBuild(employeeId: string): Promise<void> {
  try {
    await fs.unlink(PENDING_FILE(employeeId));
  } catch {
    /* not present — fine */
  }
}

export type SpawnResult =
  | { spawned: true; buildId: string; startedAt: string; alreadyRunning: false }
  | {
      spawned: false;
      reason: "already_running";
      buildId: string;
      startedAt: string;
      alreadyRunning: true;
    };

/**
 * Spawn the twin-builder detached. Returns immediately; the runner survives
 * client disconnect. Idempotent per employee — if a build is already active
 * for this employee, returns its id without spawning a duplicate.
 */
export function spawnDetachedBuild(args: {
  employee: EmployeeWithTwin;
  lookbackDays: number;
  ceoContext?: string;
  maxBudgetUsd?: number;
}): SpawnResult {
  const { employee, lookbackDays, ceoContext, maxBudgetUsd } = args;
  const employeeId = employee.id;

  const existing = getActiveBuild(employeeId);
  if (existing) {
    return {
      spawned: false,
      reason: "already_running",
      buildId: existing.buildId,
      startedAt: existing.startedAt,
      alreadyRunning: true,
    };
  }

  const buildId = newBuildId();
  const startedAt = new Date().toISOString();

  markBuildActive({
    employeeId,
    buildId,
    startedAt,
    lastEventTs: 0,
    eventCount: 0,
    filesWritten: 0,
    filesTotal: TWIN_FILE_NAMES.length,
    costUsd: 0,
    ceoContext,
  });

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

  void runTwinBuilder({
    employee,
    buildId,
    ceoContext,
    maxBudgetUsd,
    lookbackDays,
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
        /* disk wedged */
      }
    })
    .finally(() => {
      try {
        clearBuildActive(employeeId);
      } catch {
        /* ignore */
      }
    });

  return { spawned: true, buildId, startedAt, alreadyRunning: false };
}

/** Count ACTIVE connections from a Composio state object. */
export function countActiveConnections(state: {
  connections: Record<string, { status: string }>;
}): number {
  return Object.values(state.connections).filter((c) => c.status === "ACTIVE")
    .length;
}
