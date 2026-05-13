import { NextRequest } from "next/server";
import { initiateConnection, isComposioConfigured } from "@/lib/composio-client";
import { hasEmployeeFiles } from "@/lib/employees-files";

/**
 * POST /api/connections/[id]/initiate
 * Body: { toolkit: string, callbackUrl?: string }
 * Returns: { redirectUrl, connectedAccountId, authConfigId }
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

  const body = (await req.json()) as {
    toolkit?: string;
    callbackUrl?: string;
  };

  if (!body.toolkit) {
    return new Response(JSON.stringify({ error: "toolkit is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await initiateConnection(id, body.toolkit, body.callbackUrl);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
