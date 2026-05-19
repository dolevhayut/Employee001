import { NextRequest, NextResponse } from "next/server";
import { readAuditLog, type AuditVerdict } from "@/lib/audit-log";

/**
 * GET /api/audit
 *
 * Query params:
 *   employee   — filter by employeeId
 *   tool       — substring match against bareName (case-insensitive)
 *   verdict    — executed | ceo_approved | ceo_denied | hard_blocked
 *   since      — ISO timestamp, lower bound (inclusive)
 *   until      — ISO timestamp, upper bound (inclusive)
 *   page       — 1-based page, default 1
 *   pageSize   — rows per page, default 100, hard cap 500
 *   archive    — read from data/audit.YYYY-MM.jsonl instead of the live file
 *
 * Response shape:
 *   { entries: AuditEntry[], totalCount, page, pageSize, archives: string[] }
 *
 * The archives array is always returned so the UI can populate a month
 * dropdown without a second request.
 *
 * BACK-COMPAT: For consumers that expect a plain array (the original shape),
 * pass `?compat=array` and we'll return `entries` only.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const employeeId = sp.get("employee") ?? undefined;
  const toolName = sp.get("tool") ?? undefined;
  const verdict = (sp.get("verdict") as AuditVerdict) ?? undefined;
  const since = sp.get("since") ?? undefined;
  const until = sp.get("until") ?? undefined;
  const page = sp.get("page") ? Number(sp.get("page")) : undefined;
  const pageSize = sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined;
  const archive = sp.get("archive") ?? undefined;
  const compat = sp.get("compat");

  const result = readAuditLog({
    employeeId,
    toolName,
    verdict,
    since,
    until,
    page,
    pageSize,
    archive,
  });

  if (compat === "array") {
    return NextResponse.json(result.entries, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
