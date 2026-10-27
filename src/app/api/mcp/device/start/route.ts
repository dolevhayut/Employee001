import { DEVICE_CODE_TTL_MS, issueDeviceCode, publicBaseUrl } from "@/lib/mcp-server/device-auth";
import { fail, json, takeSlot } from "../respond";

export const runtime = "nodejs";

/** POST → { device_code, user_code, verification_uri, verification_uri_complete,
 *  expires_in, interval }. Public: the MCP client has no session yet. The device
 *  code is the client's secret; the user code is what the person types in the app. */
export async function POST(request: Request) {
  if (!takeSlot("start", 30)) return fail(429, "rate_limited", "Too many sign-in attempts. Try again in a minute.");
  const issued = await issueDeviceCode();
  const verificationUri = `${publicBaseUrl(request.url)}/mcp/device`;
  return json({
    device_code: issued.deviceCode,
    user_code: issued.userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(issued.userCode)}`,
    expires_in: Math.round(DEVICE_CODE_TTL_MS / 1000),
    interval: issued.intervalSeconds,
  });
}
