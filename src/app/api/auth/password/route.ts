import { NextResponse, type NextRequest } from "next/server";
import { appendAuditEntry } from "@/lib/audit-log";
import { createSession, getUser, revokeUserSessions, updateUser } from "@/lib/auth/store";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { readJson, setSession } from "@/lib/auth/http";

export const runtime = "nodejs";

/** POST { current, next }: change your own password. Signs out every other
 *  session and starts a fresh one here. */
export async function POST(request: NextRequest) {
  const me = sessionUserFromHeaders(request.headers);
  const user = me ? getUser(me.id) : undefined;
  const body = await readJson<{ current?: string; next?: string }>(request);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.passwordHash && !verifyPassword(body?.current ?? "", user.passwordHash)) {
    return NextResponse.json({ error: "Your current password is wrong." }, { status: 400 });
  }
  const problem = passwordProblem(body?.next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  updateUser(user.id, { passwordHash: hashPassword(body!.next!) });
  revokeUserSessions(user.id);
  appendAuditEntry({ runId: `auth-${Date.now()}`, employeeId: "system", employeeName: "system", toolName: "passwordChanged", bareName: "passwordChanged", input: { userId: user.id }, verdict: "executed", requesterId: user.id });
  const res = NextResponse.json({ ok: true });
  setSession(res, createSession(user.id, "password", true), request);
  return res;
}
