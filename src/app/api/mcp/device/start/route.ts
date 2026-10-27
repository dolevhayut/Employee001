import { DEVICE_CODE_TTL_MS, DeviceCodeLimitError, issueDeviceCode, publicBaseUrl } from "@/lib/mcp-server/device-auth";
import { accountsEnabled } from "@/lib/auth/store";
import { fail, json, signInOff, takeSlot } from "../respond";

export const runtime = "nodejs";

/** POST → { device_code, user_code, verification_uri, verification_uri_complete,
 *  expires_in, interval }. Public: the MCP client has no session yet. The device
 *  code is the client's secret; the user code is what the person types in the app. */
export async function POST(request: Request) {
  const off = signInOff();
  if (off) return off;
  // A session belongs to a person, so with no accounts nobody could approve it
  // and resolveBearer would refuse it anyway. Say so up front.
  if (!accountsEnabled()) {
    return fail(409, "accounts_required", "Personal sign-in needs accounts. Create the owner account in Employee001 first, then run login again.");
  }
  if (!takeSlot("start", 30)) return fail(429, "rate_limited", "Too many sign-in attempts. Try again in a minute.");
  let issued;
  try {
    issued = await issueDeviceCode();
  } catch (err) {
    if (err instanceof DeviceCodeLimitError) return fail(429, "rate_limited", "Too many pending sign-ins. Try again in a few minutes.");
    throw err;
  }
  const verificationUri = `${publicBaseUrl(request.url)}/device`;
  return json({
    device_code: issued.deviceCode,
    user_code: issued.userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(issued.userCode)}`,
    expires_in: Math.round(DEVICE_CODE_TTL_MS / 1000),
    interval: issued.intervalSeconds,
  });
}
