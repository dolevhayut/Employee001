const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isLoopbackBind(bind: string | undefined): boolean {
  if (!bind) return true;
  const value = bind.trim();
  return value === "" || value === "127.0.0.1" || value === "::1" || value === "localhost";
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function hostname(value: string): string | undefined {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return undefined;
  }
}

function originMatchesHost(originValue: string, hostValue: string): boolean {
  try {
    const origin = new URL(originValue);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
    const host = new URL(`http://${hostValue}`);
    if (origin.hostname !== host.hostname) return false;
    const defaultPort = origin.protocol === "https:" ? "443" : "80";
    return (origin.port || defaultPort) === (host.port || defaultPort);
  } catch {
    return false;
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
  const origin = request.headers.get("origin");
  const loopback = isLoopbackBind(process.env.EMPLOYEE001_BIND);
  if (loopback) {
    if (!host || !LOCAL_HOSTS.has(host)) return jsonRpcError("forbidden host");
    if (origin && !LOCAL_HOSTS.has(hostname(origin) ?? ""))
      return jsonRpcError("forbidden origin");
  } else if (origin && !originMatchesHost(origin, request.headers.get("host") ?? "")) {
    return jsonRpcError("forbidden origin");
  }
  return null;
}
