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
    return NextResponse.json(
      {
        status: "not_found",
        message: "This invite link is not recognized. Ask the CEO for a new one.",
      },
      { status: 404 },
    );
  }
  if (found.completedAt) {
    return NextResponse.json(
      {
        status: "already_redeemed",
        message: "This invite has already been redeemed. Ask the CEO for a new link.",
        invite: found,
      },
      { status: 410 },
    );
  }
  return NextResponse.json(
    {
      status: "expired",
      message: "This invite has expired. Ask the CEO for a new link.",
      invite: found,
    },
    { status: 410 },
  );
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const ok = revokeInvite(token);
  if (!ok) return NextResponse.json({ status: "not_found" }, { status: 404 });
  return NextResponse.json({ status: "revoked" });
}
