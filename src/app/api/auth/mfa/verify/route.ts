import { NextResponse, type NextRequest } from "next/server";
import { completeMfa } from "@/lib/auth/login";
import { SESSION_COOKIE } from "@/lib/auth/store";
import { clientIp, readJson, setSession } from "@/lib/auth/http";

export const runtime = "nodejs";

/** POST { code }: second step of sign-in. */
export async function POST(request: NextRequest) {
  const body = await readJson<{ code?: string }>(request);
  const done = completeMfa(request.cookies.get(SESSION_COOKIE)?.value, body?.code ?? "", clientIp(request));
  if (!done) return NextResponse.json({ error: "That code didn't work. Codes change every 30 seconds." }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  setSession(res, done.cookie, request);
  return res;
}
