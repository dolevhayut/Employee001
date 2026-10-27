import { appendAuditEntry } from "@/lib/audit-log";
import { readJson } from "@/lib/auth/http";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { ROLE_RANK } from "@/lib/auth/rbac";
import { revokePersonSessions } from "@/lib/mcp-server/device-auth";
import { fail, json } from "../respond";

export const runtime = "nodejs";

/** POST { person_id? } revokes MCP sessions. With no person_id (or your own) it
 *  signs you out of every MCP client; an admin can name another person. */
export async function POST(request: Request) {
  const me = sessionUserFromHeaders(request.headers);
  if (!me) return fail(401, "unauthorized", "Sign in to Employee001 to revoke MCP sessions.");
  const body = await readJson<{ person_id?: unknown }>(request);
  if (body?.person_id !== undefined && (typeof body.person_id !== "string" || !body.person_id || body.person_id.length > 128)) {
    return fail(400, "invalid_request", "person_id must be a non-empty string.");
  }
  const target = typeof body?.person_id === "string" ? body.person_id : me.id;
  if (target !== me.id && ROLE_RANK[me.role] < ROLE_RANK.admin) {
    return fail(403, "forbidden", "Only an admin can revoke another person's MCP sessions.");
  }

  const revoked = await revokePersonSessions(target);
  appendAuditEntry({
    runId: `mcp-device-${Date.now()}`,
    employeeId: "system",
    employeeName: "system",
    toolName: "mcpSessionsRevoked",
    bareName: "mcpSessionsRevoked",
    input: { personId: target, revoked },
    verdict: "executed",
    approvedBy: me.id,
    approvalChannel: "ui",
  });
  return json({ revoked });
}
