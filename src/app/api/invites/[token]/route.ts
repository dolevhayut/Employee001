import { NextRequest, NextResponse } from "next/server";
import { findInvite, isInviteRedeemable, revokeInvite } from "@/lib/invites";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const redeemable = isInviteRedeemable(token);
  if (redeemable) {
    return NextResponse.json({ status: "redeemable", invite: redeemable });
  }
  const found = findInvite(token);
  if (!found) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (found.completedAt) {
    return NextResponse.json({ status: "used", invite: found }, { status: 410 });
  }
  return NextResponse.json({ status: "expired", invite: found }, { status: 410 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const ok = revokeInvite(token);
  if (!ok) return NextResponse.json({ status: "not_found" }, { status: 404 });
  return NextResponse.json({ status: "revoked" });
}
