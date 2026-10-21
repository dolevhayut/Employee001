import { exportAuditChain, verifyAuditChain } from "@/lib/audit-log";

export const runtime = "nodejs";

/**
 * GET /api/audit/export: the whole audit log (archives then active) as one
 * JSONL file in chain order, verifiable offline with
 * `npx employee001 audit verify <file>`. Admin/owner only (src/proxy.ts).
 */
export async function GET() {
  const body = exportAuditChain();
  const verification = verifyAuditChain();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="employee001-audit-${stamp}.jsonl"`,
      "Cache-Control": "no-store",
      "X-Audit-Chain": verification.ok ? `ok; rows=${verification.checked}` : `broken; reason=${verification.reason ?? "unknown"}`,
    },
  });
}
