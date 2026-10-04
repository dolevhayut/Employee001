import { z } from "zod";
import { createGoal, listGoals, GoalStatusSchema } from "@/lib/goals";

export const runtime = "nodejs";

const CreateGoalBodySchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  ownerEmployeeId: z.string().min(1).nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  status: GoalStatusSchema.optional(),
}).strict();

export async function GET() {
  return Response.json({ goals: listGoals() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = CreateGoalBodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  try {
    const goal = await createGoal(parsed.data);
    return Response.json({ goal }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_goal";
    return Response.json({ error: message }, { status: 400 });
  }
}
