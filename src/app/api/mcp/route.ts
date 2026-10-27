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

const MAX_BODY_BYTES = 1_000_000;

function rpcError(code: number, message: string, status = 403): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

/** Read the request body as text, or null once it passes `maxBytes` (the rest is never buffered). */
async function readCappedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request): Promise<Response> {
  const rejected = checkLocalRequest(request);
  if (rejected) return rejected;

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const personal = personalSignInEnabled();
  // A personal session is looked up on every request, so a revoke takes effect
  // on the very next one.
  const session = personal && bearer ? resolveBearer(bearer) : null;

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

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return rpcError(-32600, "request too large", 413);
  }
  // Content-Length can be absent (chunked) or wrong, so the stream itself is capped.
  const body = await readCappedBody(request, MAX_BODY_BYTES);
  if (body === null) return rpcError(-32600, "request too large", 413);
  const tools = toolsInBody(body);
  if (!tools) return rpcError(-32600, "request too large or too many calls in one batch", 413);
  const written = auditMcpRequest(identity, tools, { verdict: "executed" });
  // With personal sign-in on, a request that cannot be attributed is not served.
  if (!written && personal) return rpcError(-32005, "audit log unavailable", 503);

  const server = buildPublicMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  // The body stream is spent; hand the transport the text we already read.
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return transport.handleRequest(new Request(request.url, { method: request.method, headers, body }));
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
