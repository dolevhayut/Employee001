const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostname(value: string): string | undefined {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return undefined;
  }
}

function jsonRpcError(message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32003, message },
      id: null,
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

/** Block DNS rebinding: a loopback listener must only accept local Host/Origin values. */
export function checkLocalRequest(request: Request): Response | null {
  const host = hostname(request.headers.get("host") ?? "");
  if (!host || !LOCAL_HOSTS.has(host)) return jsonRpcError("forbidden host");
  const origin = request.headers.get("origin");
  if (origin && !LOCAL_HOSTS.has(hostname(origin) ?? ""))
    return jsonRpcError("forbidden origin");
  return null;
}
