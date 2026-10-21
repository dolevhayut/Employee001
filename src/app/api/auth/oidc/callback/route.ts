import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, oidcConfig } from "@/lib/auth/oidc";
import { signInWithOidc, takeOidcRequest } from "@/lib/auth/login";
import { clientIp, setSession } from "@/lib/auth/http";

export const runtime = "nodejs";

function back(request: NextRequest, path: string): URL {
  const url = request.nextUrl.clone();
  const [pathname, search = ""] = path.split("?");
  url.pathname = pathname;
  url.search = search ? `?${search}` : "";
  return url;
}

/** The identity provider redirects here with ?code&state. */
export async function GET(request: NextRequest) {
  const cfg = oidcConfig();
  const params = request.nextUrl.searchParams;
  const pending = takeOidcRequest(params.get("state") ?? "");
  if (!cfg || !pending || !params.get("code")) return NextResponse.redirect(back(request, "/login?error=sso"));
  try {
    const claims = await exchangeCode(cfg, params.get("code")!, pending.verifier, pending.nonce);
    const result = signInWithOidc(claims, cfg, clientIp(request));
    if (result.status !== "ok" && result.status !== "mfa_required") return NextResponse.redirect(back(request, "/login?error=no_account"));
    const target = result.status === "mfa_required" ? `/login?step=mfa&next=${encodeURIComponent(pending.returnTo)}` : pending.returnTo;
    const res = NextResponse.redirect(back(request, target));
    setSession(res, result.cookie, request);
    return res;
  } catch {
    return NextResponse.redirect(back(request, "/login?error=sso"));
  }
}
