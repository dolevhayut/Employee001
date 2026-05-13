import { NextRequest, NextResponse } from "next/server";
import { updateRoutine, deleteRoutine, getRoutine, computeNextRun } from "@/lib/routines";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const patch = (await req.json()) as { enabled?: boolean };
  const existing = getRoutine(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const merged = { ...existing, ...patch };
  // If we're (re-)enabling and the next-run is in the past, recompute it
  if (patch.enabled && (!merged.nextRunAt || new Date(merged.nextRunAt).getTime() < Date.now())) {
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
