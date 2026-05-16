import { NextRequest, NextResponse } from "next/server";
import { classifyInvite, materializeEmployeeFromInvite } from "@/lib/invites";
import { initiateConnection, isComposioConfigured } from "@/lib/composio-client";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

/**
 * POST /api/invites/[token]/connections/initiate
 * Body: { toolkit: string, callbackUrl?: string }
 *
 * Initiates a Composio OAuth handoff for the invite-bearing employee. The
 * employee is materialized on-demand (idempotent) so Composio has a stable
 * user_id to bind the connection to. Returns the Composio redirect URL.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const cls = classifyInvite(token);
  if (!cls.ok) {
    const httpStatus = cls.reason === "not_found" ? 404 : 410;
    return NextResponse.json({ status: cls.reason }, { status: httpStatus });
  }

  if (!isComposioConfigured()) {
    return NextResponse.json(
      { error: "COMPOSIO_API_KEY is not set on the workspace" },
      { status: 500 },
    );
  }

  let body: { toolkit?: string; callbackUrl?: string };
  try {
    body = (await req.json()) as { toolkit?: string; callbackUrl?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body.toolkit) {
    return NextResponse.json({ error: "toolkit is required" }, { status: 400 });
  }

  let employeeId: string;
  try {
    const m = await materializeEmployeeFromInvite(token);
    employeeId = m.employeeId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "materialize failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const result = await initiateConnection(employeeId, body.toolkit, body.callbackUrl);
    return NextResponse.json({ employeeId, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
