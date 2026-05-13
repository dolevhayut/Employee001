import { NextRequest } from "next/server";
import { disconnectToolkit, isComposioConfigured } from "@/lib/composio-client";
import { hasEmployeeFiles } from "@/lib/employees-files";

/**
 * POST /api/connections/[id]/disconnect
 * Body: { toolkit: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!hasEmployeeFiles(id)) {
    return new Response(JSON.stringify({ error: "employee not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!isComposioConfigured()) {
    return new Response(
      JSON.stringify({ error: "COMPOSIO_API_KEY is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = (await req.json()) as { toolkit?: string };
  if (!body.toolkit) {
    return new Response(JSON.stringify({ error: "toolkit is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await disconnectToolkit(id, body.toolkit);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
