import { NextRequest, NextResponse } from "next/server";
import { listWorkItems, enqueueWorkItem, type WorkItemStatus } from "@/lib/work-items";
import { ensureSchedulerStarted } from "@/lib/routine-scheduler";

export const runtime = "nodejs";

// GET /api/work-items[?status=queued] — the EmployeeX work queue.
// Hitting this also boots the scheduler (same pattern as /api/routines) so
// the work plane runs even if no routine page was ever opened.
export async function GET(req: NextRequest) {
  ensureSchedulerStarted();
  const status = req.nextUrl.searchParams.get("status") as WorkItemStatus | null;
  const items = listWorkItems(status ? { status } : undefined);
  // Newest first for the UI.
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/work-items — manually queue a task for a twin.
// Body: { assigneeEmployeeId, title, task, idempotencyKey? }
export async function POST(req: NextRequest) {
  ensureSchedulerStarted();
  let body: { assigneeEmployeeId?: string; title?: string; task?: string; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { assigneeEmployeeId, title, task } = body;
  if (!assigneeEmployeeId || !title || !task) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const { item, deduped } = enqueueWorkItem({
    type: "task",
    assigneeEmployeeId,
    title,
    payload: { task },
    idempotencyKey: body.idempotencyKey ?? `manual:${assigneeEmployeeId}:${title}:${Date.now()}`,
  });
  return NextResponse.json({ item, deduped }, { status: deduped ? 200 : 201 });
}
