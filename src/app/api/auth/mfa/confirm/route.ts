import { NextResponse } from "next/server";
import { appendAuditEntry } from "@/lib/audit-log";
import { getUser, updateUser } from "@/lib/auth/store";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { verifyTotp } from "@/lib/auth/totp";
import { readJson } from "@/lib/auth/http";

export const runtime = "nodejs";

/** POST { code }: finish enrollment with a code from the authenticator. */
export async function POST(request: Request) {
  const me = sessionUserFromHeaders(request.headers);
  const user = me ? getUser(me.id) : undefined;
  const body = await readJson<{ code?: string }>(request);
  if (!user?.totp || user.totp.enabled) return NextResponse.json({ error: "Start enrollment first." }, { status: 400 });
  const step = verifyTotp(user.totp.secret, body?.code ?? "", user.totp.lastStep);
  if (step === null) return NextResponse.json({ error: "That code didn't match. Check the time on your phone and try again." }, { status: 400 });
  updateUser(user.id, { totp: { ...user.totp, enabled: true, lastStep: step, confirmedAt: new Date().toISOString() } });
  appendAuditEntry({ runId: `auth-${Date.now()}`, employeeId: "system", employeeName: "system", toolName: "mfaEnabled", bareName: "mfaEnabled", input: { userId: user.id }, verdict: "executed", requesterId: user.id });
  return NextResponse.json({ ok: true });
}
