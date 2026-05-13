import { NextRequest } from "next/server";
import { buildEmployeeGraph } from "@/lib/profile-graph-real";
import { hasEmployeeFiles } from "@/lib/employees-files";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!hasEmployeeFiles(id)) {
    return new Response(JSON.stringify({ error: "employee not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const graph = buildEmployeeGraph(id);
  return new Response(JSON.stringify(graph), {
    headers: { "Content-Type": "application/json" },
  });
}
