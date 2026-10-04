import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { listPendingProposals } from "@/lib/knowledge-proposals";

export const runtime = "nodejs";

/** GET /api/employees/[id]/knowledge/proposals → pending knowledge proposals. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!hasEmployeeFiles(id)) {
    return Response.json({ error: "employee not found" }, { status: 404 });
  }
  return Response.json(
    { proposals: listPendingProposals(id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
