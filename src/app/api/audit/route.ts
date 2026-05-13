import { NextRequest, NextResponse } from "next/server";
import { readAuditLog, type AuditVerdict } from "@/lib/audit-log";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const employeeId = sp.get("employee") ?? undefined;
  const toolName = sp.get("tool") ?? undefined;
  const verdict = (sp.get("verdict") as AuditVerdict) ?? undefined;

  const entries = readAuditLog({ employeeId, toolName, verdict });

  return NextResponse.json(entries, {
    headers: { "Cache-Control": "no-store" },
  });
}
