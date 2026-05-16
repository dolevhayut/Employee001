import { NextRequest, NextResponse } from "next/server";
import { classifyInvite, findInvite } from "@/lib/invites";
import { readState } from "@/lib/composio-client";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

/**
 * GET /api/invites/[token]/connections
 *
 * Employee-side connection status, scoped by invite token. Returns the
 * Composio state for the (possibly not-yet-materialized) employee bound
 * to this invite.
 *
 * - If the invite is not_found / expired → 404 / 410.
 * - If the invite is already `used` (consent already submitted), we still
 *   return the connection snapshot so the post-consent thank-you page can
 *   render a final view.
 * - If the employee hasn't been materialized yet (no first OAuth click),
 *   returns `{ employeeId: null, connections: {}, pendingEmployee: true }`.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const cls = classifyInvite(token);
  if (!cls.ok && cls.reason === "not_found") {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!cls.ok && cls.reason === "expired") {
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }
  // For "used" we keep going — caller may want to see the final state.
  const invite = (cls.ok ? cls.invite : cls.invite) ?? findInvite(token);
  const employeeId = invite?.employeeId ?? null;
  if (!employeeId) {
    return NextResponse.json({
      employeeId: null,
      connections: {},
      pendingEmployee: true,
    });
  }
  const state = await readState(employeeId);
  return NextResponse.json({
    employeeId,
    connections: state.connections,
    pendingEmployee: false,
  });
}
