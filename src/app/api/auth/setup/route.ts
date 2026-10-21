import { NextResponse, type NextRequest } from "next/server";
import { createFirstOwner } from "@/lib/auth/login";
import { accountsEnabled, bootstrapValid, BOOTSTRAP_COOKIE } from "@/lib/auth/store";
import { isLoopbackBind, readJson, setSession } from "@/lib/auth/http";

export const runtime = "nodejs";

/** Can this caller create the first owner? On loopback anyone at the
 *  machine can; on an exposed bind only the holder of the bootstrap cookie
 *  (traded for EMPLOYEE001_TOKEN by the proxy). */
function allowed(request: NextRequest): boolean {
  return isLoopbackBind() || bootstrapValid(request.cookies.get(BOOTSTRAP_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ needed: !accountsEnabled(), allowed: allowed(request) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (accountsEnabled()) return NextResponse.json({ error: "An owner already exists. Sign in instead." }, { status: 409 });
  if (!allowed(request)) return NextResponse.json({ error: "Open the access URL with the server token first." }, { status: 403 });
  const body = await readJson<{ email?: string; name?: string; password?: string }>(request);
  const result = createFirstOwner({ email: body?.email ?? "", name: body?.name ?? "", password: body?.password ?? "" });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  setSession(res, result.cookie, request);
  res.cookies.set({ name: BOOTSTRAP_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}
