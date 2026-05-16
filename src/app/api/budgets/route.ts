import { NextResponse } from "next/server";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { getTwinBudget } from "@/lib/twin-budget";

export const runtime = "nodejs";

export async function GET() {
  const fromDisk = await loadEmployeesFromDisk();
  const all = [
    ...fromDisk,
    ...getHiredEmployees().filter(
      (h) => !fromDisk.some((e) => e.id === h.id)
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
