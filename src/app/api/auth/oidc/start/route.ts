import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl, newAuthRequest, oidcConfig } from "@/lib/auth/oidc";
import { rememberOidcRequest } from "@/lib/auth/login";

export const runtime = "nodejs";

/** GET ?next=/path → redirect to the identity provider. */
export async function GET(request: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return NextResponse.json({ error: "Single sign-on isn't configured." }, { status: 404 });
  const req = newAuthRequest();
  rememberOidcRequest(req.state, req.nonce, req.verifier, request.nextUrl.searchParams.get("next") ?? "/");
  try {
    return NextResponse.redirect(await authorizationUrl(cfg, req));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "SSO is unavailable." }, { status: 502 });
  }
}
