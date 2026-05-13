import { NextRequest, NextResponse } from "next/server";
import { readTaskRuns } from "@/lib/task-history";

type EmployeeAgg = {
  employeeId: string;
  employeeName: string;
  runs: number;
  totalUsd: number;
  avgUsd: number;
  budgetHits: number; // count of runs that stopped at the budget cap
};

type CostsResponse = {
  windowStart: string;     // ISO start of the window (UTC)
  totalUsd: number;
  totalRuns: number;
  byEmployee: EmployeeAgg[];
};

/**
 * GET /api/tasks/costs?month=current|all
 *
 * Aggregates execution costs from the task-history log. Default window is the
 * current calendar month (UTC); pass `month=all` to aggregate everything.
 */
export async function GET(req: NextRequest): Promise<NextResponse<CostsResponse>> {
  const month = req.nextUrl.searchParams.get("month") ?? "current";

  // Window cutoff
  let cutoff = 0;
  let windowStart = new Date(0).toISOString();
  if (month === "current") {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    cutoff = start.getTime();
    windowStart = start.toISOString();
  }

  const all = readTaskRuns();
  const inWindow = all.filter((r) => {
    const t = new Date(r.startedAt).getTime();
    return t >= cutoff;
  });

  // Group by employee
  const groups = new Map<string, EmployeeAgg>();
  let totalUsd = 0;
  for (const r of inWindow) {
    const cost = typeof r.costUsd === "number" ? r.costUsd : 0;
    totalUsd += cost;
    const existing = groups.get(r.employeeId);
    if (existing) {
      existing.runs += 1;
      existing.totalUsd += cost;
      if (r.stoppedReason === "max_budget") existing.budgetHits += 1;
    } else {
      groups.set(r.employeeId, {
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        runs: 1,
        totalUsd: cost,
        avgUsd: 0, // computed below
        budgetHits: r.stoppedReason === "max_budget" ? 1 : 0,
      });
    }
  }

  const byEmployee = Array.from(groups.values())
    .map((g) => ({ ...g, avgUsd: g.runs > 0 ? g.totalUsd / g.runs : 0 }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  return NextResponse.json({
    windowStart,
    totalUsd,
    totalRuns: inWindow.length,
    byEmployee,
  });
}
