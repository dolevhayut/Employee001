import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { dataDir } from "@/lib/app-home";
import { readOrgIdentity } from "@/lib/org-identity";
import { listCustomMcp } from "@/lib/custom-mcp";
import { buildOrgGraph } from "@/lib/org-graph";

// GET /api/org/graph — the whole organization as one brain graph for the
// Company brain page (company hub, twins, shared tools). Names only, no secrets.
export async function GET() {
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))];
  const twins = roster
    .filter((e) => e.twinStatus === "ready" && hasEmployeeFiles(e.id))
    .map((e) => ({ id: e.id, firstName: e.firstName, role: e.role, dir: dataDir("employees", e.id) }));
  const custom = (await listCustomMcp().catch(() => [])).filter((s) => s.enabled).map((s) => s.name);
  const graph = buildOrgGraph(readOrgIdentity().name, twins, ["Company brain", "Web", ...custom]);
  return Response.json(graph, { headers: { "Cache-Control": "no-store" } });
}
