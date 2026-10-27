import { NextRequest, NextResponse } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { canRunContradictionScan, scanContradictions } from "@/lib/contradictions";

export const runtime = "nodejs";

// POST /api/inbox/contradictions → scan every twin's durable facts and profile
// claims for conflicts and file one Inbox item per new conflict. Idempotent:
// a conflict already in the Inbox (open or closed) is not filed again.
export async function POST(req: NextRequest) {
  const user = sessionUserFromHeaders(req.headers);
  const viewer = user ? { id: user.id, role: user.role } : null;
  if (!canRunContradictionScan(viewer)) {
    return NextResponse.json({ error: "Scanning twins for conflicts needs the member role." }, { status: 403 });
  }
  const result = await scanContradictions(viewer);
  return NextResponse.json({
    twinsScanned: result.twinsScanned,
    claimsCompared: result.claimsCompared,
    created: result.created,
    alreadyFiled: result.alreadyFiled,
    conflicts: result.conflicts,
  });
}
