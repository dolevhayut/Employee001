import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "@/lib/mcp-server/guard";
import { matchesSharedToken, personalSignInEnabled, resolveBearer } from "@/lib/mcp-server/device-auth";
import { authorizeApi, authorizePage, type Caller } from "@/lib/auth/rbac";
import { USER_EMPLOYEE_HEADER, USER_ID_HEADER, USER_ROLE_HEADER } from "@/lib/auth/request-user";
import {
  accountsEnabled,
  getUser,
  bootstrapCookie,
  bootstrapValid,
  BOOTSTRAP_COOKIE,
  resolveSession,
  SESSION_COOKIE,
  SESSION_MAX_MS,
} from "@/lib/auth/store";

// Access control, in three modes:
//   1. No accounts yet, loopback bind (the default local install): the OS is
//      the boundary, the caller acts as the implicit local owner.
//   2. No accounts yet, exposed bind (EMPLOYEE001_BIND=0.0.0.0 …):
//      EMPLOYEE001_TOKEN is only a bootstrap credential. Presenting it sets
//      a short-lived signed cookie (never the token itself) that unlocks
//      /auth/setup, where the first owner account is created. The token stays
//      valid as the MCP client bearer.
//   3. Accounts exist (any bind, loopback included): every request needs a
//      signed session (src/lib/auth/store.ts) and passes the RBAC table
//      (src/lib/auth/rbac.ts). The proxy strips the identity headers from
//      every incoming request and sets them only after verifying the session.

// First-visit gate: send the user to /welcome unless they've dismissed it.
// Set independently of the access token cookie so it works on loopback too.
const WELCOME_COOKIE = "e001_welcomed";

function isLoopbackBind(bind: string | undefined): boolean {
  if (!bind) return true;
  const v = bind.trim();
  return v === "" || v === "127.0.0.1" || v === "::1" || v === "localhost";
}

const IDENTITY_HEADERS = [USER_ID_HEADER, USER_ROLE_HEADER, USER_EMPLOYEE_HEADER];

/** Continue with verified identity headers (and nothing a client sent). */
function nextWith(request: NextRequest, caller: Caller): NextResponse {
  const headers = new Headers(request.headers);
  for (const h of IDENTITY_HEADERS) headers.delete(h);
  if (caller) {
    headers.set(USER_ID_HEADER, caller.id);
    headers.set(USER_ROLE_HEADER, caller.role);
    if (caller.employeeId) headers.set(USER_EMPLOYEE_HEADER, caller.employeeId);
  }
  return NextResponse.next({ request: { headers } });
}

function jsonError(status: number, error: string, reason: string): NextResponse {
  return new NextResponse(JSON.stringify({ error, reason }), { status, headers: { "content-type": "application/json" } });
}

function setSessionCookie(res: NextResponse, value: string, secure: boolean): void {
  res.cookies.set({ name: SESSION_COOKIE, value, httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: Math.floor(SESSION_MAX_MS / 1000) });
}

function isHttps(request: NextRequest): boolean {
  return request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

/** Who an MCP bearer belongs to: a shared token (if the policy still allows
 *  them) or a personal sign-in session while personal sign-in is on. Null when
 *  it is neither. /api/mcp re-checks either way and attributes the request. */
function bearerCaller(request: NextRequest): Caller {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const bearer = header.slice("Bearer ".length);
  if (matchesSharedToken(bearer)) return { id: "mcp-client", role: "member" };
  if (!personalSignInEnabled()) return null;
  const session = resolveBearer(bearer);
  // The implicit local owner only exists while there are no accounts.
  if (!session) return null;
  if (session.personId === "local-owner") return accountsEnabled() ? null : { id: session.personId, role: "member" };
  // Once accounts exist the person must still have an enabled account.
  const user = accountsEnabled() ? getUser(session.personId) : undefined;
  if (accountsEnabled() && (!user || user.disabled)) return null;
  return { id: session.personId, role: "member" };
}

function unauthorizedHtml(pathAndQuery: string): string {
  const safePath = pathAndQuery.replace(/[<>"']/g, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Employee001 — access token required</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .card { background: #141414; border: 1px solid #262626; border-radius: 12px; padding: 32px; max-width: 420px; width: 90%; }
    h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
    p { color: #a3a3a3; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
    form { display: flex; gap: 8px; }
    input { flex: 1; background: #0a0a0a; border: 1px solid #404040; color: #e5e5e5; padding: 10px 12px; border-radius: 8px; font-size: 14px; font-family: ui-monospace, monospace; }
    input:focus { outline: none; border-color: #525252; }
    button { background: #e5e5e5; color: #0a0a0a; border: none; padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
    button:hover { background: #fafafa; }
    code { background: #0a0a0a; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Access token required</h1>
    <p>This Employee001 instance is exposed beyond <code>127.0.0.1</code>. Paste the token printed when the server started, or visit the access URL it gave you.</p>
    <form method="get" action="${safePath}">
      <input name="token" type="password" autocomplete="off" autofocus placeholder="token" />
      <button type="submit">Unlock</button>
    </form>
  </main>
</body>
</html>`;
}

function firstVisitRedirect(request: NextRequest): NextResponse | null {
  // Only intercept top-level navigation requests. Don't touch API, static,
  // or non-GET. The /welcome page itself must always be reachable.
  if (request.method !== "GET") return null;
  const { pathname } = request.nextUrl;
  if (pathname !== "/" && pathname !== "/index.html") return null;
  if (request.cookies.get(WELCOME_COOKIE)?.value === "1") return null;

  const url = request.nextUrl.clone();
  url.pathname = "/welcome";
  return NextResponse.redirect(url);
}

// Invite tokens bypass the LAN-token gate on /join and the invite endpoints
// (validate + complete). The invite token IS the auth — the CEO chose to
// hand it out, so its bearer is allowed to walk through the door once.
function isInvitePath(pathname: string): boolean {
  if (pathname === "/join") return true;
  if (pathname === "/onboarding") return true;
  if (pathname.startsWith("/api/invites/")) return true;
  return false;
}

function extractInviteToken(request: NextRequest): string | undefined {
  const q = request.nextUrl.searchParams.get("invite");
  if (q && q.startsWith("inv_")) return q;
  const path = request.nextUrl.pathname;
  // /api/invites/<token>[/<sub>...] — matches the bare validate / complete
  // endpoints AND the employee-side OAuth surface under
  // /api/invites/<token>/connections/* (initiate + per-toolkit disconnect).
  // The trailing `(\/|$)` is what makes the deeper paths fall into this
  // bypass; don't tighten without re-checking the onboarding OAuth flow.
  const m = path.match(/^\/api\/invites\/(inv_[a-f0-9]+)(\/|$)/);
  return m?.[1];
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Authority = { name: string; port: string | undefined };

// Strict HTTP Host grammar: a hostname or [IPv6], optional :port. Anything
// else (userinfo, path, fragment, spaces) is rejected rather than "parsed".
const HOST_RE = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i;

function parseHost(value: string | null): Authority | undefined {
  const m = value?.trim().match(HOST_RE);
  if (!m) return undefined;
  return { name: m[1].toLowerCase().replace(/\.$/, ""), port: m[2] };
}

function parseOrigin(value: string): (Authority & { defaultPort: string }) | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return {
      name: url.hostname.toLowerCase().replace(/\.$/, ""),
      port: url.port || undefined,
      defaultPort: url.protocol === "https:" ? "443" : "80",
    };
  } catch {
    return undefined; // includes the opaque "null" origin
  }
}

function samePort(origin: Authority & { defaultPort: string }, host: Authority): boolean {
  const originPort = origin.port ?? origin.defaultPort;
  return host.port ? originPort === host.port : originPort === origin.defaultPort;
}

function extraAllowedHosts(): Set<string> {
  return new Set(
    (process.env.EMPLOYEE001_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  );
}

function forbidden(reason: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: "forbidden", reason }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

// Cross-site guard. A web page open in the user's browser can send requests
// to the local app, and with DNS rebinding (evil.example resolving to
// 127.0.0.1) it can even read the responses. So:
//   - on a loopback bind, the Host header must be a loopback name (or one
//     listed in EMPLOYEE001_ALLOWED_HOSTS, e.g. for `tailscale serve`);
//   - on every bind, a state-changing request from a browser must be
//     same-origin: its Origin must match the Host (a loopback alias on the
//     same port, or an allow-listed host, also counts on a loopback bind).
//     Requests with no Origin and no cross-site Sec-Fetch-Site (curl, CLIs,
//     webhooks) are allowed.
export function crossSiteBlock(request: NextRequest, loopback: boolean): NextResponse | null {
  const host = parseHost(request.headers.get("host"));
  const allowed = extraAllowedHosts();
  if (loopback && (!host || (!LOOPBACK_HOSTNAMES.has(host.name) && !allowed.has(host.name)))) {
    return forbidden("host");
  }
  if (!UNSAFE_METHODS.has(request.method)) return null;

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return request.headers.get("sec-fetch-site") === "cross-site" ? forbidden("origin") : null;
  }
  const origin = parseOrigin(originHeader);
  if (!origin || !host) return forbidden("origin");
  if (origin.name === host.name && samePort(origin, host)) return null;
  if (loopback && allowed.has(origin.name)) return null;
  if (loopback && LOOPBACK_HOSTNAMES.has(origin.name) && LOOPBACK_HOSTNAMES.has(host.name) && samePort(origin, host)) {
    return null;
  }
  return forbidden("origin");
}

export function proxy(request: NextRequest) {
  const bind = process.env.EMPLOYEE001_BIND;
  const loopback = isLoopbackBind(bind);
  const blocked = crossSiteBlock(request, loopback);
  if (blocked) return blocked;

  const welcome = firstVisitRedirect(request);
  if (welcome) return welcome;

  if (accountsEnabled()) return gateWithAccounts(request);

  // Mode 1: local single-user install.
  if (loopback) return nextWith(request, { id: "local-owner", role: "owner" });

  // Mode 2: exposed, no accounts yet.
  return gateBootstrap(request);
}

/** Mode 3: signed session + RBAC. */
function gateWithAccounts(request: NextRequest): NextResponse {
  const url = request.nextUrl;
  const resolved = resolveSession(request.cookies.get(SESSION_COOKIE)?.value);
  const mfaPending = Boolean(resolved && !resolved.session.mfaPassed);
  const caller: Caller = resolved && !mfaPending
    ? { id: resolved.user.id, role: resolved.user.role, ...(resolved.user.employeeId ? { employeeId: resolved.user.employeeId } : {}) }
    : null;
  const finish = (res: NextResponse) => {
    if (resolved?.rotatedCookie) setSessionCookie(res, resolved.rotatedCookie, isHttps(request));
    return res;
  };

  if (url.pathname.startsWith("/api/")) {
    const decision = authorizeApi(url.pathname, request.method, caller);
    if (!decision.allow) {
      const status = decision.status === 401 && mfaPending ? 401 : decision.status;
      return finish(jsonError(status, status === 401 ? "unauthorized" : status === 404 ? "not_found" : "forbidden", mfaPending ? "second factor required" : decision.reason));
    }
    switch (decision.access.kind) {
      case "invite":
        return extractInviteToken(request) ? nextWith(request, null) : jsonError(401, "unauthorized", "invite token required");
      case "webhook":
        return request.method === "POST" && request.headers.has("webhook-signature")
          ? nextWith(request, null)
          : jsonError(401, "unauthorized", "signed webhook required");
      case "bearer": {
        if (caller) return finish(nextWith(request, caller));
        const bearer = bearerCaller(request);
        return bearer ? nextWith(request, bearer) : jsonError(401, "unauthorized", "sign in or MCP bearer token required");
      }
      default:
        return finish(nextWith(request, caller));
    }
  }

  const decision = authorizePage(url.pathname, caller);
  if (decision.allow) return finish(nextWith(request, caller));
  if (decision.status === 401) {
    const login = url.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", url.pathname + url.search);
    if (mfaPending) login.searchParams.set("step", "mfa");
    return NextResponse.redirect(login);
  }
  return finish(new NextResponse("You don't have access to this page.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } }));
}

/** Mode 2: exposed bind, no accounts yet. */
function gateBootstrap(request: NextRequest): NextResponse {
  const url = request.nextUrl;

  // Invite-token bypass: the bearer of a valid invite token can reach the
  // employee-onboarding surface. Full redeemability is checked by the route.
  if (isInvitePath(url.pathname) && extractInviteToken(request)) return nextWith(request, null);

  // Composio's signed webhooks can't hold a cookie; the routes verify the
  // signature (and replay window) themselves.
  if (
    request.method === "POST" &&
    (url.pathname === "/api/email/composio" || url.pathname === "/api/slack/composio") &&
    request.headers.has("webhook-signature")
  ) {
    return nextWith(request, null);
  }

  const expected = process.env.EMPLOYEE001_TOKEN;
  // Exposed with no token: refuse everything rather than serve an open app.
  if (!expected) {
    return new NextResponse(
      "Employee001 is bound to a non-loopback address but EMPLOYEE001_TOKEN is unset. Refusing to serve. Re-run `employee001 setup` or set the token in .env.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  if (url.pathname === "/api/mcp") {
    const bearer = bearerCaller(request);
    if (bearer) return nextWith(request, bearer);
  }

  // The token is traded for a signed, 30-minute bootstrap cookie that only
  // opens the first-owner setup. The raw token is never stored in a cookie.
  const queryToken = url.searchParams.get("token");
  if (queryToken && timingSafeEqual(queryToken, expected)) {
    const setup = url.clone();
    setup.pathname = "/auth/setup";
    setup.search = "";
    const res = NextResponse.redirect(setup);
    res.cookies.set({ name: BOOTSTRAP_COOKIE, value: bootstrapCookie(), httpOnly: true, sameSite: "lax", secure: isHttps(request), path: "/", maxAge: 30 * 60 });
    return res;
  }

  const bootstrapped = bootstrapValid(request.cookies.get(BOOTSTRAP_COOKIE)?.value);
  if (bootstrapped && (url.pathname === "/auth/setup" || url.pathname === "/api/auth/setup")) {
    return nextWith(request, null);
  }
  if (bootstrapped) {
    const setup = url.clone();
    setup.pathname = "/auth/setup";
    setup.search = "";
    return url.pathname.startsWith("/api/") ? jsonError(403, "forbidden", "create the first owner account at /auth/setup") : NextResponse.redirect(setup);
  }

  if (url.pathname.startsWith("/api/")) return jsonError(401, "unauthorized", "missing or invalid token");
  return new NextResponse(unauthorizedHtml(url.pathname), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)$).*)",
  ],
};
