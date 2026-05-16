import { NextRequest, NextResponse } from "next/server";
import { classifyInvite, findInvite, materializeEmployeeFromInvite } from "@/lib/invites";
import { disconnectToolkit, isComposioConfigured } from "@/lib/composio-client";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string; toolkit: string }> };

/**
 * POST /api/invites/[token]/connections/[toolkit]/disconnect
 *
 * Disconnects a toolkit on behalf of the invite-bearing employee. Mirrors the
 * CEO-scoped /api/connections/[id]/disconnect route but routes the auth
 * through the invite token instead of the workspace LAN token.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { token, toolkit } = await params;
  const cls = classifyInvite(token);
  // For disconnect we allow `used` invites too (in case the user finished
  // consent and wants to drop a connection from the thank-you page).
  if (!cls.ok && cls.reason === "not_found") {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!cls.ok && cls.reason === "expired") {
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }
  if (!isComposioConfigured()) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY is not set" }, { status: 500 });
  }
  if (!toolkit) {
    return NextResponse.json({ error: "toolkit is required" }, { status: 400 });
  }

  // Resolve employeeId without forcing materialization if it doesn't exist.
  const invite = findInvite(token);
  let employeeId = invite?.employeeId;
  if (!employeeId) {
    try {
      const m = await materializeEmployeeFromInvite(token);
      employeeId = m.employeeId;
    } catch {
      return NextResponse.json({ ok: true, noop: true });
    }
  }

  await disconnectToolkit(employeeId, toolkit);
  return NextResponse.json({ ok: true });
}
