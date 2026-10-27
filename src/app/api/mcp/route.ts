import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  SHARED_TOKEN_IDENTITY,
  UNAUTHENTICATED_IDENTITY,
  auditMcpRequest,
  toolsInBody,
} from "@/lib/mcp-server/audit";
import { matchesSharedToken, personalSignInEnabled, resolveBearer } from "@/lib/mcp-server/device-auth";
import { checkLocalRequest } from "@/lib/mcp-server/guard";
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

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const personal = personalSignInEnabled();
  // A personal session is looked up on every request, so a revoke takes effect
  // on the very next one.
  const session = bearer ? resolveBearer(bearer) : null;

  let identity: string | null = null;
  if (session) {
    identity = session.personId;
  } else if (personal || !isLoopbackBind(process.env.EMPLOYEE001_BIND)) {
    // Shared tokens (timing-safe compare) count only while the policy allows
    // them: never once personal sign-in is on, unless an admin opted in.
    if (bearer && matchesSharedToken(bearer)) identity = SHARED_TOKEN_IDENTITY;
  } else {
    identity = UNAUTHENTICATED_IDENTITY; // loopback with personal sign-in off: unchanged
  }

  if (!identity) {
    auditMcpRequest(UNAUTHENTICATED_IDENTITY, ["(refused)"], {
      verdict: "hard_blocked",
      reason: bearer ? "invalid, expired or revoked token" : "missing token",
    });
    return rpcError(-32004, "missing or invalid token", 401);
  }

  const written = auditMcpRequest(identity, toolsInBody(await request.clone().text()), {
    verdict: "executed",
  });
  // With personal sign-in on, a request that cannot be attributed is not served.
  if (!written && personal) return rpcError(-32005, "audit log unavailable", 503);

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
