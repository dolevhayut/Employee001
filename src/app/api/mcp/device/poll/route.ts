import { exchangeDeviceCode } from "@/lib/mcp-server/device-auth";
import { readJson } from "@/lib/auth/http";
import { clientKey, fail, json, takeSlot } from "../respond";

export const runtime = "nodejs";

/** Issued device codes are 32 random bytes in base64url. */
const DEVICE_CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** POST { device_code } → 200 { access_token, token_type, expires_at } once a
 *  person approved the code; otherwise 400 { error } with no token:
 *  authorization_pending, slow_down, expired_token, invalid_grant (unknown or
 *  already collected). The token is handed over exactly once. */
export async function POST(request: Request) {
  const body = await readJson<{ device_code?: unknown }>(request);
  const deviceCode = typeof body?.device_code === "string" ? body.device_code : "";
  // Malformed codes are refused before they cost a rate-limit slot or touch the store.
  if (!DEVICE_CODE_SHAPE.test(deviceCode)) return fail(400, "invalid_request", "device_code is required.");
  if (!takeSlot(`poll:${clientKey(request)}`, 300) || !takeSlot("poll:all", 6000)) return fail(429, "rate_limited", "Too many requests. Try again in a minute.");

  const result = await exchangeDeviceCode(deviceCode);
  switch (result.status) {
    case "approved":
      return json({ access_token: result.bearer, token_type: "Bearer", expires_at: result.expiresAt });
    case "pending":
      return fail(400, "authorization_pending", "Waiting for a person to approve this code in Employee001.");
    case "slow_down":
      return fail(400, "slow_down", "Polling too fast. Wait for the interval between requests.");
    case "denied":
      return fail(400, "access_denied", "The sign-in was refused in Employee001.");
    case "expired":
      return fail(400, "expired_token", "This device code expired. Start sign-in again.");
    case "consumed":
      return fail(400, "invalid_grant", "This device code was already used. Start sign-in again.");
    default:
      return fail(400, "invalid_grant", "Unknown device code. Start sign-in again.");
  }
}
