import { NextRequest } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { applyLifecycleAction, type LifecycleAction } from "@/lib/twin-lifecycle";
import { loadHandoverState } from "@/lib/relay/handover-state";
import { deleteHandover, withHandoverLock } from "@/lib/relay/package-store";

export const runtime = "nodejs";

/** The twin's handover: lifecycle, interview so far, draft or reviewed package. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await ctx.params;
  const state = await loadHandoverState(employeeId);
  return state ? Response.json(state) : Response.json({ error: "Twin not found" }, { status: 404 });
}

const ACTIONS: LifecycleAction[] = ["start-handover", "cancel-handover", "retire"];

/** Admin lifecycle actions. Body: { action: "start-handover" | "cancel-handover" | "retire" }. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = ACTIONS.find((a) => a === body.action);
  if (!action) return Response.json({ error: "Unknown action" }, { status: 400 });
  if (!(await loadHandoverState(employeeId))) return Response.json({ error: "Twin not found" }, { status: 404 });

  const me = sessionUserFromHeaders(req.headers);
  const result = await applyLifecycleAction(employeeId, action, { userId: me?.id, role: me?.role });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  // A cancelled handover leaves nothing behind: transcript and draft go too.
  if (action === "cancel-handover") await withHandoverLock(employeeId, () => deleteHandover(employeeId));
  return Response.json(await loadHandoverState(employeeId));
}
