import { NextRequest, NextResponse } from "next/server";
import { readTaskRuns, type TaskStatus } from "@/lib/task-history";

const VALID_STATUSES: TaskStatus[] = [
  "running",
  "complete",
  "error",
  "aborted",
];

/**
 * GET /api/tasks
 *
 * Query params:
 *   employeeId? — filter to one employee
 *   status?     — running | complete | error | aborted
 *   limit?      — max number to return (default 50)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const employeeId = sp.get("employeeId") ?? undefined;
  const statusParam = sp.get("status");
  const status =
    statusParam && (VALID_STATUSES as string[]).includes(statusParam)
      ? (statusParam as TaskStatus)
      : undefined;
  const limitParam = sp.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam))) : 50;

  const runs = readTaskRuns({ employeeId, status, limit });

  return NextResponse.json({ runs });
}
