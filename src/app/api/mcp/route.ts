import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkLocalRequest } from "@/lib/mcp-server/guard";
import { buildPublicMcpServer, isLoopbackBind } from "@/lib/mcp-server/server";

export const dynamic = "force-dynamic";

function rpcError(code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = checkLocalRequest(request);
  if (rejected) return rejected;
  if (!isLoopbackBind(process.env.EMPLOYEE001_BIND))
    return rpcError(-32001, "MCP is loopback-only in this version");
  const server = buildPublicMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
