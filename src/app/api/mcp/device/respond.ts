import { NextResponse } from "next/server";

// Shared by the device-code routes: every response is uncacheable because it
// can carry a session token or reveal whether a code exists.
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, error: string, message: string): NextResponse {
  return json({ error, message }, status);
}
