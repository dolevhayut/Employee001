import { NextRequest } from "next/server";
import {
  refreshConnections,
  isComposioConfigured,
  readState,
  getEmployeeToolkits,
} from "@/lib/composio-client";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getActiveBuild } from "@/lib/twin-versions";
import {
  readPendingBuild,
  clearPendingBuild,
  spawnDetachedBuild,
  countActiveConnections,
} from "@/lib/twin-build-runner";

/**
 * GET /api/connections/[id]
 * Returns the employee's Composio state: { composioUserId, connections: {...},
 * configured: boolean, allowedToolkits: [...] }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!hasEmployeeFiles(id)) {
    return new Response(JSON.stringify({ error: "employee not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const configured = isComposioConfigured();
  let state;
  try {
    state = configured ? await refreshConnections(id) : await readState(id);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[connections/${id}] refreshConnections failed: ${m}`);
    state = await readState(id);
  }
  const allowedToolkits = getEmployeeToolkits(id);

  // ─── Auto-resume deferred twin-build (Wave 2A) ──────────────────────────
  // If onboarding completed without any ACTIVE connections, a pending sidecar
  // was left behind. The moment the first connection flips to ACTIVE (which
  // refreshConnections() just persisted above), fire the builder.
  // Guarded by getActiveBuild() so we never double-fire.
  try {
    const pending = await readPendingBuild(id);
    if (pending && countActiveConnections(state) > 0 && !getActiveBuild(id)) {
      await clearPendingBuild(id);
      if (process.env.AZURE_OPENAI_ENDPOINT) {
        const fromDisk = await loadEmployeesFromDisk();
        const employee = fromDisk.find((e) => e.id === id);
        if (employee) {
          spawnDetachedBuild({
            employee,
            lookbackDays: pending.lookbackDays,
            ceoContext: pending.ceoContext ?? "Auto-train on consent",
          });
        }
      }
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.warn(`[connections] pending-build resume failed: ${m}`);
  }

  return new Response(
    JSON.stringify({ ...state, configured, allowedToolkits }),
    { headers: { "Content-Type": "application/json" } }
  );
}
