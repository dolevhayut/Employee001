import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { addAnswerCorrection, answerStats, listPendingProposals } from "@/lib/knowledge-proposals";

export const runtime = "nodejs";

/** GET /api/employees/[id]/knowledge/proposals → pending knowledge proposals. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!hasEmployeeFiles(id)) {
    return Response.json({ error: "employee not found" }, { status: 404 });
  }
  return Response.json(
    { proposals: listPendingProposals(id), stats: answerStats(id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** POST { question, answer, correction } — a reader flags an Ask answer; creates a pending proposal. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!hasEmployeeFiles(id)) {
    return Response.json({ error: "employee not found" }, { status: 404 });
  }
  let body: { question?: unknown; answer?: unknown; correction?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const result = await addAnswerCorrection(id, body ?? {});
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ proposal: result.proposal, stats: answerStats(id) }, { status: 201 });
}
