import { NextResponse } from "next/server";
import { appendAuditEntry } from "@/lib/audit-log";
import { getUser, revokeUserSessions, updateUser } from "@/lib/auth/store";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { verifyTotp } from "@/lib/auth/totp";
import { readJson } from "@/lib/auth/http";

export const runtime = "nodejs";

/** POST { code }: turning MFA off needs a current code; signs out everywhere. */
export async function POST(request: Request) {
  const me = sessionUserFromHeaders(request.headers);
  const user = me ? getUser(me.id) : undefined;
  const body = await readJson<{ code?: string }>(request);
  if (!user?.totp?.enabled) return NextResponse.json({ error: "Two-factor sign-in is off." }, { status: 400 });
  if (verifyTotp(user.totp.secret, body?.code ?? "", user.totp.lastStep) === null) {
    return NextResponse.json({ error: "Enter a current code to turn it off." }, { status: 400 });
  }
  updateUser(user.id, { totp: undefined });
  revokeUserSessions(user.id);
  appendAuditEntry({ runId: `auth-${Date.now()}`, employeeId: "system", employeeName: "system", toolName: "mfaDisabled", bareName: "mfaDisabled", input: { userId: user.id }, verdict: "executed", requesterId: user.id });
  return NextResponse.json({ ok: true });
}
