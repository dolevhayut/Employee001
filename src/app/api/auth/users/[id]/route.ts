import { NextResponse } from "next/server";
import { appendAuditEntry } from "@/lib/audit-log";
import { deleteUser, getUser, listUsers, publicUser, revokeUserSessions, updateUser } from "@/lib/auth/store";
import { ROLES, sessionUserFromHeaders, type Role } from "@/lib/auth/request-user";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { readJson } from "@/lib/auth/http";
import { revokePersonSessions } from "@/lib/mcp-server/device-auth";
import { addPersonProblem } from "@/lib/model-provider";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function audit(event: string, input: Record<string, unknown>, by: string) {
  appendAuditEntry({ runId: `auth-${Date.now()}`, employeeId: "system", employeeName: "system", toolName: event, bareName: event, input, verdict: "executed", approvedBy: by, approvalChannel: "ui" });
}

const otherActiveOwners = (id: string) => listUsers().filter((u) => u.role === "owner" && !u.disabled && u.id !== id).length;

/** PATCH { role?, disabled?, password?, employeeId? }. A role, password or
 *  disable change signs the user out everywhere. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const me = sessionUserFromHeaders(request.headers);
  const target = getUser(id);
  const body = await readJson<{ role?: Role; disabled?: boolean; password?: string; employeeId?: string | null }>(request);
  if (!me || !target || !body) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const touchesOwner = target.role === "owner" || body.role === "owner";
  if (touchesOwner && me.role !== "owner") return NextResponse.json({ error: "Only an owner can change an owner." }, { status: 403 });
  if (body.role && !ROLES.includes(body.role)) return NextResponse.json({ error: "Unknown role." }, { status: 400 });
  if (body.disabled === false && target.disabled) {
    const seat = addPersonProblem();
    if (seat) return NextResponse.json({ error: seat }, { status: 409 });
  }
  if (target.role === "owner" && (body.disabled || (body.role && body.role !== "owner")) && otherActiveOwners(id) === 0) {
    return NextResponse.json({ error: "Keep at least one active owner." }, { status: 400 });
  }
  const patch: Parameters<typeof updateUser>[1] = {};
  if (body.role) patch.role = body.role;
  if (typeof body.disabled === "boolean") patch.disabled = body.disabled;
  if (body.employeeId !== undefined) patch.employeeId = body.employeeId ?? undefined;
  if (body.password !== undefined) {
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    patch.passwordHash = hashPassword(body.password);
  }
  const updated = updateUser(id, patch);
  if (body.role || body.disabled || body.password !== undefined) revokeUserSessions(id);
  // Audit first: if the MCP store is busy the request fails, but the change is on record.
  audit("userUpdated", { userId: id, ...(body.role ? { role: body.role } : {}), ...(typeof body.disabled === "boolean" ? { disabled: body.disabled } : {}), ...(body.password !== undefined ? { passwordReset: true } : {}) }, me.id);
  if (body.role || body.disabled || body.password !== undefined) await revokePersonSessions(id);
  return NextResponse.json({ user: publicUser(updated) });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const me = sessionUserFromHeaders(request.headers);
  const target = getUser(id);
  if (!me || !target) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (target.role === "owner" && me.role !== "owner") return NextResponse.json({ error: "Only an owner can remove an owner." }, { status: 403 });
  if (target.role === "owner" && otherActiveOwners(id) === 0) return NextResponse.json({ error: "Keep at least one active owner." }, { status: 400 });
  deleteUser(id);
  await revokePersonSessions(id);
  audit("userDeleted", { userId: id }, me.id);
  return NextResponse.json({ ok: true });
}
