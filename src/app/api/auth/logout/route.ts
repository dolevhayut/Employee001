import { NextResponse, type NextRequest } from "next/server";
import { endSession, SESSION_COOKIE } from "@/lib/auth/store";
import { clearSession } from "@/lib/auth/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  endSession(request.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  clearSession(res);
  return res;
}
