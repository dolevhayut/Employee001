import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";

export const runtime = "nodejs";

export async function GET() {
  const [fromDisk, hired] = await Promise.all([
    loadEmployeesFromDisk(),
    Promise.resolve(getHiredEmployees()),
  ]);
  const all = [
    ...fromDisk,
    ...hired.filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  return Response.json(all, { headers: { "Cache-Control": "no-store" } });
}
