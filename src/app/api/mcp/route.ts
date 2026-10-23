import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkLocalRequest, timingSafeEqual } from "@/lib/mcp-server/guard";
import { buildPublicMcpServer, isLoopbackBind } from "@/lib/mcp-server/server";

export const dynamic = "force-dynamic";

function rpcError(code: number, message: string, status = 403): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = checkLocalRequest(request);
  if (rejected) return rejected;
  if (!isLoopbackBind(process.env.EMPLOYEE001_BIND)) {
    // Same tokens the proxy accepts: the MCP-only token, else the app token.
    const expected = [process.env.EMPLOYEE001_MCP_TOKEN, process.env.EMPLOYEE001_TOKEN].filter(
      (token): token is string => Boolean(token),
    );
    const bearer = request.headers.get("authorization");
    if (
      !bearer?.startsWith("Bearer ") ||
      !expected.some((token) => timingSafeEqual(bearer.slice("Bearer ".length), token))
    ) {
      return rpcError(-32004, "missing or invalid token", 401);
    }
  }
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
