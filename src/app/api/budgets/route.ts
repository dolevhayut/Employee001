import { NextResponse } from "next/server";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
import { getHiredEmployees } from "@/lib/hired-agents";
import { getTwinBudget } from "@/lib/twin-budget";

export const runtime = "nodejs";

export function GET() {
  const all = [
    ...EMPLOYEES_WITH_TWIN,
    ...getHiredEmployees().filter(
      (h) => !EMPLOYEES_WITH_TWIN.some((e) => e.id === h.id)
    ),
  ];
  const budgets = all.map((emp) => ({
    employeeId: emp.id,
    employeeName: emp.name,
    employeeFirstName: emp.firstName,
    role: emp.role,
    ...getTwinBudget(emp.id),
  }));
  return NextResponse.json(budgets);
}
