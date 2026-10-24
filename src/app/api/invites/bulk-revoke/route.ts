import { NextRequest, NextResponse } from "next/server";
import { bulkRevokeInvites, type BulkRevokeScope } from "@/lib/invites";
import { purgeAbandonedInviteTwins } from "@/lib/invite-cleanup";

export const runtime = "nodejs";

const VALID: BulkRevokeScope[] = ["expired", "unused"];

export async function POST(request: NextRequest) {
  let body: { scope?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* empty body */
  }
  const scope = body.scope;
  if (typeof scope !== "string" || !VALID.includes(scope as BulkRevokeScope)) {
    return NextResponse.json(
      { error: "invalid_scope", message: `scope must be one of: ${VALID.join(", ")}` },
      { status: 400 },
    );
  }
  const result = bulkRevokeInvites(scope as BulkRevokeScope);
  const purged = await purgeAbandonedInviteTwins();
  return NextResponse.json({ ...result, purged });
}
