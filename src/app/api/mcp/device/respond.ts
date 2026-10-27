import { NextResponse } from "next/server";

// Shared by the device-code routes: every response is uncacheable because it
// can carry a session token or reveal whether a code exists.
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Public routes take the store lock and rewrite the file, so cap them before
// they get there. Buckets are keyed per client (best-effort IP from the proxy
// headers) so one caller cannot exhaust the limit for everyone else.
const hits = new Map<string, number[]>();
const MAX_BUCKETS = 5_000;

/** Best-effort client key: first forwarded address, else a shared "local" bucket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip")?.trim() || "local").slice(0, 64);
}

/** True and consumes a slot when `bucket` has fewer than `limit` calls in the last minute. */
export function takeSlot(bucket: string, limit: number, now = Date.now()): boolean {
  if (hits.size >= MAX_BUCKETS && !hits.has(bucket)) {
    for (const [key, times] of hits) if (!times.some((t) => t > now - 60_000)) hits.delete(key);
    // Still full: drop the oldest buckets so the map stays bounded without locking new clients out.
    // The global ceiling in the routes is what limits a flood of rotating keys.
    for (const key of hits.keys()) {
      if (hits.size < MAX_BUCKETS) break;
      hits.delete(key);
    }
  }
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
