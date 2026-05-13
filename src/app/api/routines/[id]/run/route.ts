import { NextRequest, NextResponse } from "next/server";
import { getRoutine } from "@/lib/routines";
import { fireRoutine } from "@/lib/routine-scheduler";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const r = getRoutine(id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Fire-and-forget: the routine runs in the background and may pause for approval.
  // Returning immediately means the UI polls /pending for the approval card.
  void fireRoutine(r, "manual");

  return NextResponse.json({ ok: true });
}
