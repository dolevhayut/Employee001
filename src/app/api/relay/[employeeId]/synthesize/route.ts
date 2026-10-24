import { NextRequest } from "next/server";
import { synthesizeHandover } from "@/lib/relay/live-interview";
import { loadHandoverState } from "@/lib/relay/handover-state";
import { modelErrorMessage } from "@/lib/model-provider";

export const runtime = "nodejs";
export const maxDuration = 600;

/** Build (or rebuild) the draft handover package from the saved interview. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await ctx.params;
  const state = await loadHandoverState(employeeId);
  if (!state) return Response.json({ error: "Twin not found" }, { status: 404 });
  if (state.lifecycle !== "handover") return Response.json({ error: "No handover is open for this twin." }, { status: 409 });
  if (!state.model.ok) return Response.json({ error: state.model.reason }, { status: 503 });
  try {
    const { rcp, coverage } = await synthesizeHandover(employeeId);
    return Response.json({ package: rcp, coverage });
  } catch (err) {
    return Response.json({ error: modelErrorMessage(err instanceof Error ? err.message : "Synthesis failed") }, { status: 500 });
  }
}
