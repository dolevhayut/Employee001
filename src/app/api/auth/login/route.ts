import { NextResponse } from "next/server";
import { loginWithPassword } from "@/lib/auth/login";
import { clientIp, readJson, setSession } from "@/lib/auth/http";

export const runtime = "nodejs";

/** POST { email, password } → { status: "ok" | "mfa_required" }. */
export async function POST(request: Request) {
  const body = await readJson<{ email?: string; password?: string }>(request);
  if (!body?.email || !body.password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  const result = loginWithPassword(body.email, body.password, clientIp(request));
  if (result.status === "locked") return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  if (result.status === "invalid") return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  const res = NextResponse.json({ status: result.status });
  setSession(res, result.cookie, request);
  return res;
}
