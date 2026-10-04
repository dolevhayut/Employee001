function hostname(value: string): string | undefined {
  try { return new URL(value.includes("://") ? value : `http://${value}`).hostname; } catch { return undefined; }
}

function jsonRpcError(message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32003, message }, id: null }), {
    status: 403, headers: { "content-type": "application/json" },
  });
}

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Manual host/origin guard. See proxy.ts for the separate bind check. */
export function checkLocalRequest(req: Request): Response | null {
  const host = hostname(req.headers.get("host") ?? "");
  if (!host || !LOCAL.has(host)) return jsonRpcError("forbidden host");
  const origin = req.headers.get("origin");
  if (origin && !LOCAL.has(hostname(origin) ?? "")) return jsonRpcError("forbidden origin");
  return null;
}
