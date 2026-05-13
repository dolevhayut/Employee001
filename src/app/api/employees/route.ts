import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
import { getHiredEmployees } from "@/lib/hired-agents";

export async function GET() {
  const hired = getHiredEmployees();
  const all = [
    ...EMPLOYEES_WITH_TWIN,
    ...hired.filter((h) => !EMPLOYEES_WITH_TWIN.some((e) => e.id === h.id)),
  ];
  return Response.json(all, { headers: { "Cache-Control": "no-store" } });
}
