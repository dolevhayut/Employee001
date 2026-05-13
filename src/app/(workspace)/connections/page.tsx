import { redirect } from "next/navigation";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";

/**
 * /connections (no employee id) → redirect to the first ready twin's
 * connections page. Each twin has its own connection scope, so we never
 * need a generic "all integrations" view.
 */
export default function ConnectionsIndex() {
  const firstReady =
    EMPLOYEES_WITH_TWIN.find((e) => e.twinStatus === "ready") ??
    EMPLOYEES_WITH_TWIN[0];
  // No twins yet (fresh install or demo mode off) → send the user to the
  // employees page where they can add the first one.
  if (!firstReady) redirect("/employees");
  redirect(`/connections/${firstReady.id}`);
}
