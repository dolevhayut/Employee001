import { NextRequest, NextResponse } from "next/server";
import { listPendingApprovals, type ApprovalSurface } from "@/lib/approval-bus";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const surface = (sp.get("surface") as ApprovalSurface) || undefined;
  const pending = listPendingApprovals(surface ? { surface } : undefined);
  return NextResponse.json(pending, { headers: { "Cache-Control": "no-store" } });
}
