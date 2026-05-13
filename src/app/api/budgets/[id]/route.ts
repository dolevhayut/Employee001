import { NextRequest, NextResponse } from "next/server";
import { setDailyBudget, getTwinBudget } from "@/lib/twin-budget";

export const runtime = "nodejs";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { dailyBudgetUsd?: number };
  if (typeof body.dailyBudgetUsd !== "number" || body.dailyBudgetUsd < 0) {
    return NextResponse.json({ error: "dailyBudgetUsd must be a non-negative number" }, { status: 400 });
  }
  const updated = setDailyBudget(id, body.dailyBudgetUsd);
  return NextResponse.json(updated);
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return NextResponse.json(getTwinBudget(id));
}
