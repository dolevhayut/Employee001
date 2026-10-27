import { NextResponse } from "next/server";
import { personalSignInEnabled } from "@/lib/mcp-server/device-auth/shared-token-policy";

// Shared by the device-code routes: every response is uncacheable because it
// can carry a session token or reveal whether a code exists.
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Public routes take the store lock and rewrite the file, so cap them before
// they get there. One global rolling window per route: a spoofable client IP
// would make a per-IP cap useless, and a personal install has few real clients.
const hits = new Map<string, number[]>();

/** True and consumes a slot when `bucket` has fewer than `limit` calls in the last minute. */
export function takeSlot(bucket: string, limit: number, now = Date.now()): boolean {
  const recent = (hits.get(bucket) ?? []).filter((t) => t > now - 60_000);
  if (recent.length >= limit) {
    hits.set(bucket, recent);
    return false;
  }
  hits.set(bucket, [...recent, now]);
  return true;
}

export function resetSlots(): void {
  hits.clear();
}

export function fail(status: number, error: string, message: string): NextResponse {
  return json({ error, message }, status);
}

/** A 404 while personal sign-in is off, so no device code or session can be minted
 *  that would start working the moment the flag is turned on; null when it is on. */
export function signInOff(): NextResponse | null {
  if (personalSignInEnabled()) return null;
  return fail(404, "not_found", "Personal MCP sign-in is not enabled.");
}
