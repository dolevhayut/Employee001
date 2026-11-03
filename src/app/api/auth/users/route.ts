import { NextResponse } from "next/server";
import { appendAuditEntry } from "@/lib/audit-log";
import { createUser, listUsers, publicUser } from "@/lib/auth/store";
import { ROLES, sessionUserFromHeaders, type Role } from "@/lib/auth/request-user";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { readJson } from "@/lib/auth/http";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ users: listUsers().map(publicUser) }, { headers: { "Cache-Control": "no-store" } });
}

/** POST { email, name, role, password?, employeeId? }. Only an owner can
 *  create an owner. A user without a password signs in with SSO. */
export async function POST(request: Request) {
  const me = sessionUserFromHeaders(request.headers);
  const body = await readJson<{ email?: string; name?: string; role?: Role; password?: string; employeeId?: string }>(request);
  if (!me || !body?.email || !body.role || !ROLES.includes(body.role)) return NextResponse.json({ error: "Email and a valid role are required." }, { status: 400 });
  if (body.role === "owner" && me.role !== "owner") return NextResponse.json({ error: "Only an owner can add an owner." }, { status: 403 });
  if (body.role === "employee" && !body.employeeId) return NextResponse.json({ error: "Pick the twin this employee may see." }, { status: 400 });
  if (body.password !== undefined) {
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }
  try {
    const user = createUser({
      email: body.email,
      name: body.name?.trim() || body.email,
      role: body.role,
      ...(body.employeeId ? { employeeId: body.employeeId } : {}),
      ...(body.password ? { passwordHash: hashPassword(body.password) } : {}),
      createdBy: me.id,
    });
    appendAuditEntry({ runId: `auth-${Date.now()}`, employeeId: "system", employeeName: "system", toolName: "userCreated", bareName: "userCreated", input: { userId: user.id, role: user.role }, verdict: "executed", approvedBy: me.id, approvalChannel: "ui" });
    return NextResponse.json({ user: publicUser(user) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create the user." }, { status: 400 });
  }
}
