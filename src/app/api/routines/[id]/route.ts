import { NextRequest, NextResponse } from "next/server";
import { updateRoutine, deleteRoutine, getRoutine, computeNextRun, type Schedule } from "@/lib/routines";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const patch = (await req.json()) as {
    enabled?: boolean;
    name?: string;
    task?: string;
    schedule?: Schedule;
  };
  const existing = getRoutine(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const merged = { ...existing, ...patch };
  // Recompute nextRunAt when the schedule itself changed — otherwise the
  // scheduler keeps firing on the old cadence until the old nextRunAt is
  // hit and only THEN advances onto the new schedule. Also handles the
  // re-enable case (next-run was in the past).
  const scheduleChanged = patch.schedule !== undefined;
  if (
    scheduleChanged ||
    (patch.enabled && (!merged.nextRunAt || new Date(merged.nextRunAt).getTime() < Date.now()))
  ) {
    merged.nextRunAt = computeNextRun(merged.schedule).toISOString();
  }
  const updated = updateRoutine(id, merged);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const ok = deleteRoutine(id);
  return NextResponse.json({ ok });
}
