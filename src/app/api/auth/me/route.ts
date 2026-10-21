import { NextResponse, type NextRequest } from "next/server";
import { accountsEnabled, getUser, publicUser, resolveSession, SESSION_COOKIE } from "@/lib/auth/store";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { oidcConfig } from "@/lib/auth/oidc";

export const runtime = "nodejs";

/** Who is signed in, and how sign-in works on this install. */
export async function GET(request: NextRequest) {
  const forwarded = sessionUserFromHeaders(request.headers);
  const resolved = resolveSession(request.cookies.get(SESSION_COOKIE)?.value);
  const user = forwarded && forwarded.id !== "local-owner" ? getUser(forwarded.id) : undefined;
  return NextResponse.json(
    {
      accounts: accountsEnabled(),
      sso: Boolean(oidcConfig()),
      user: user ? publicUser(user) : forwarded?.id === "local-owner" ? { id: "local-owner", role: "owner", name: "Local owner" } : null,
      mfaPending: Boolean(resolved && !resolved.session.mfaPassed),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
