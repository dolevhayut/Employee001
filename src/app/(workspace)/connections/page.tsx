import { redirect } from "next/navigation";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";

/**
 * /connections (no employee id) → redirect to the first ready twin's
 * connections page. Each twin has its own connection scope, so we never
 * need a generic "all integrations" view.
 */
export default async function ConnectionsIndex() {
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  const firstReady =
    roster.find((e) => e.twinStatus === "ready") ?? roster[0];
  // No twins yet (fresh install or demo mode off) → send the user to the
  // employees page where they can add the first one.
  if (!firstReady) redirect("/employees");
  redirect(`/connections/${firstReady.id}`);
}
