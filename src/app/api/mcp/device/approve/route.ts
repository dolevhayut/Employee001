import { appendAuditEntry } from "@/lib/audit-log";
import { readJson } from "@/lib/auth/http";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { approveUserCode } from "@/lib/mcp-server/device-auth";
import { fail, json } from "../respond";

export const runtime = "nodejs";

/** POST { user_code } from the signed-in app session. The approving person (from
 *  the verified session, never from the body) becomes the owner of the MCP
 *  session the polling client receives. */
export async function POST(request: Request) {
  const me = sessionUserFromHeaders(request.headers);
  if (!me) return fail(401, "unauthorized", "Sign in to Employee001 to approve a device.");
  const body = await readJson<{ user_code?: unknown }>(request);
  const userCode = typeof body?.user_code === "string" ? body.user_code : "";
  if (!userCode || userCode.length > 32) return fail(400, "invalid_request", "user_code is required.");

  const result = await approveUserCode(userCode, me.id);
  if (!result.ok) {
    switch (result.reason) {
      case "rate_limited":
        return fail(429, "rate_limited", "Too many wrong codes. Wait for the codes to expire, then try again.");
      case "expired":
        return fail(400, "expired_token", "That code expired. Start sign-in again from the client.");
      case "already_approved":
        return fail(409, "already_approved", "That code was already approved.");
      default:
        return fail(404, "unknown_code", "No pending sign-in matches that code.");
    }
  }
  appendAuditEntry({
    runId: `mcp-device-${Date.now()}`,
    employeeId: "system",
    employeeName: "system",
    toolName: "mcpDeviceApproved",
    bareName: "mcpDeviceApproved",
    input: { personId: me.id },
    verdict: "executed",
    approvedBy: me.id,
    approvalChannel: "ui",
  });
  return json({ approved: true, approved_at: result.approvedAt });
}
