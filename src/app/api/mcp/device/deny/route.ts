import { readJson } from "@/lib/auth/http";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { denyUserCode } from "@/lib/mcp-server/device-auth";
import { fail, json } from "../respond";

export const runtime = "nodejs";

/** POST { user_code } from the signed-in app session. Invalidates the code so it
 *  can no longer be approved; the polling client gets access_denied. */
export async function POST(request: Request) {
  const me = sessionUserFromHeaders(request.headers);
  if (!me) return fail(401, "unauthorized", "Sign in to Employee001 to refuse a device.");
  const body = await readJson<{ user_code?: unknown }>(request);
  const userCode = typeof body?.user_code === "string" ? body.user_code : "";
  if (!userCode || userCode.length > 32) return fail(400, "invalid_request", "user_code is required.");

  const result = await denyUserCode(userCode, me.id);
  if (result.ok) return json({ denied: true });
  switch (result.reason) {
    case "denied":
      return json({ denied: true });
    case "rate_limited":
      return fail(429, "rate_limited", "Too many wrong codes. Wait for the codes to expire, then try again.");
    case "expired":
      return fail(400, "expired_token", "That code expired. Start sign-in again from the client.");
    case "already_approved":
      return fail(409, "already_approved", "That code was already approved. Revoke the session instead.");
    default:
      return fail(404, "unknown_code", "No pending sign-in matches that code.");
  }
}
