import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import {
  canonicalKnowledgeTextName,
  readKnowledgeVersion,
} from "@/lib/knowledge-versions";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string; ts: string }> },
) {
  const { id, name, ts } = await params;
  if (!hasEmployeeFiles(id)) {
    return Response.json({ error: "employee not found" }, { status: 404 });
  }
  if (!canonicalKnowledgeTextName(name)) {
    return Response.json(
      { error: "invalid file name or unsupported extension" },
      { status: 400 },
    );
  }
  const body = readKnowledgeVersion(id, name, ts);
  if (body === null) {
    return Response.json({ error: "version not found" }, { status: 404 });
  }
  return Response.json(
    { name, ts, body },
    { headers: { "Cache-Control": "no-store" } },
  );
}
