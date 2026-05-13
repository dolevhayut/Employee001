import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Employee001 runs as a single-user local app. By default it binds to
// 127.0.0.1, in which case this proxy is a no-op — the OS itself is the
// access boundary. When the user opts into LAN exposure with
// EMPLOYEE001_BIND=0.0.0.0 (or any non-loopback address), every request
// must present a shared-secret token, either as a `?token=` query param
// (first hit, then promoted to a cookie) or as an `e001_token` cookie.

const COOKIE_NAME = "e001_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// First-visit gate: send the user to /welcome unless they've dismissed it.
// Set independently of the access token cookie so it works on loopback too.
const WELCOME_COOKIE = "e001_welcomed";

function isLoopbackBind(bind: string | undefined): boolean {
  if (!bind) return true;
  const v = bind.trim();
  return v === "" || v === "127.0.0.1" || v === "::1" || v === "localhost";
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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

export function proxy(request: NextRequest) {
  const welcome = firstVisitRedirect(request);
  if (welcome) return welcome;

  const bind = process.env.EMPLOYEE001_BIND;
  if (isLoopbackBind(bind)) {
    return NextResponse.next();
  }

  const expected = process.env.EMPLOYEE001_TOKEN;
  // If exposure is enabled but no token is configured, refuse every request.
  // Better to fail closed than to serve an unauthenticated app on the LAN.
  if (!expected) {
    return new NextResponse(
      "Employee001 is bound to a non-loopback address but EMPLOYEE001_TOKEN is unset. Refusing to serve. Re-run `employee001 setup` or set the token in .env.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  const url = request.nextUrl;
  const queryToken = url.searchParams.get("token");
  if (queryToken && timingSafeEqual(queryToken, expected)) {
    const clean = url.clone();
    clean.searchParams.delete("token");
    const res = NextResponse.redirect(clean);
    res.cookies.set({
      name: COOKIE_NAME,
      value: expected,
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
    return res;
  }

  const cookieToken = request.cookies.get(COOKIE_NAME)?.value;
  if (cookieToken && timingSafeEqual(cookieToken, expected)) {
    return NextResponse.next();
  }

  const isApi = url.pathname.startsWith("/api/");
  if (isApi) {
    return new NextResponse(
      JSON.stringify({ error: "unauthorized", reason: "missing or invalid token" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

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
