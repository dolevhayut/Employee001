import { NextRequest, NextResponse } from "next/server";
import { readTaskRun, readTaskEvents } from "@/lib/task-history";

/**
 * GET /api/tasks/[id]
 * Returns the task run header + the full event log for replay.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const run = readTaskRun(id);
  if (!run) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  const events = readTaskEvents(id);
  return NextResponse.json({ run, events });
}
