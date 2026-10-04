import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { decideProposal } from "@/lib/knowledge-proposals";

export const runtime = "nodejs";

const PROPOSAL_ID = /^kp_[0-9a-f-]{36}$/;

/** POST { action: "accept" | "dismiss" } — accept appends to the knowledge file. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  const { id, pid } = await params;
  if (!hasEmployeeFiles(id)) {
    return Response.json({ error: "employee not found" }, { status: 404 });
  }
  if (!PROPOSAL_ID.test(pid)) {
    return Response.json({ error: "invalid proposal id" }, { status: 400 });
  }
  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.action !== "accept" && body.action !== "dismiss") {
    return Response.json({ error: "action must be accept or dismiss" }, { status: 400 });
  }
  const result = await decideProposal(id, pid, body.action);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "already_decided" ? 409 : 500;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ proposal: result.proposal });
}
