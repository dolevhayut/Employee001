import { loadEmployeesFromDisk } from "@/lib/employees-disk";

export const runtime = "nodejs";

/** Every twin with its Relay lifecycle, for the handover screen. */
export async function GET() {
  const employees = await loadEmployeesFromDisk();
  return Response.json(
    employees.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      initials: e.initials,
      avatarColor: e.avatarColor,
      twinStatus: e.twinStatus,
      lifecycle: e.lifecycle ?? "active",
      retiredAt: e.retiredAt ?? null,
    })),
  );
}
