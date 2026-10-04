import { z } from "zod";
import { deleteGoal, getGoal, GoalStatusSchema, updateGoal } from "@/lib/goals";

export const runtime = "nodejs";

const UpdateGoalBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  ownerEmployeeId: z.string().min(1).nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  status: GoalStatusSchema.optional(),
}).strict();

type GoalRouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: GoalRouteContext) {
  const { id } = await context.params;
  const goal = getGoal(id);
  if (!goal) return Response.json({ error: "goal_not_found" }, { status: 404 });
  return Response.json({ goal }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: GoalRouteContext) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = UpdateGoalBodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  try {
    const goal = await updateGoal(id, parsed.data);
    if (!goal) return Response.json({ error: "goal_not_found" }, { status: 404 });
    return Response.json({ goal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_goal";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: GoalRouteContext) {
  const { id } = await context.params;
  const deleted = await deleteGoal(id);
  if (!deleted) return Response.json({ error: "goal_not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
