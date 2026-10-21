import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const [fromDisk, hired] = await Promise.all([
    loadEmployeesFromDisk(),
    Promise.resolve(getHiredEmployees()),
  ]);
  const all = [
    ...fromDisk,
    ...hired.filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  // An employee-role user sees only their own twin.
  const me = sessionUserFromHeaders(request.headers);
  const visible = me?.role === "employee" ? all.filter((e) => e.id === me.employeeId) : all;
  return Response.json(visible, { headers: { "Cache-Control": "no-store" } });
}
