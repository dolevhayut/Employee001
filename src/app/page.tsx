import { redirect } from "next/navigation";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";

// If an organization already exists (at least one twin on disk), skip the
// onboarding wizard and go straight to the launchpad. Only a fresh install
// with no employees should land on /setup.
export default async function Home() {
  const employees = await loadEmployeesFromDisk();
  redirect(employees.length > 0 ? "/launchpad" : "/setup");
}
