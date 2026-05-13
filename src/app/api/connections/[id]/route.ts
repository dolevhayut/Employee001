import { NextRequest } from "next/server";
import {
  refreshConnections,
  isComposioConfigured,
  readState,
  getEmployeeToolkits,
} from "@/lib/composio-client";
import { hasEmployeeFiles } from "@/lib/employees-files";

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
  const state = configured
    ? await refreshConnections(id)
    : await readState(id);
  const allowedToolkits = getEmployeeToolkits(id);

  return new Response(
    JSON.stringify({ ...state, configured, allowedToolkits }),
    { headers: { "Content-Type": "application/json" } }
  );
}
