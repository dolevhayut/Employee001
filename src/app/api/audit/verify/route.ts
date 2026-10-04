import { NextResponse } from "next/server";
import { verifyAuditChain } from "@/lib/audit-log";

export const runtime = "nodejs";

/** GET /api/audit/verify — validate the complete audit hash chain. */
export async function GET() {
  return NextResponse.json(verifyAuditChain(), {
    headers: { "Cache-Control": "no-store" },
  });
}
