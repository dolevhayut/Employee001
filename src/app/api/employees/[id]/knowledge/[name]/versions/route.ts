import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import {
  canonicalKnowledgeTextName,
  listKnowledgeVersions,
} from "@/lib/knowledge-versions";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  if (!hasEmployeeFiles(id)) {
    return Response.json({ error: "employee not found" }, { status: 404 });
  }
  if (!canonicalKnowledgeTextName(name)) {
    return Response.json(
      { error: "invalid file name or unsupported extension" },
      { status: 400 },
    );
  }
  const versions = listKnowledgeVersions(id, name);
  return Response.json(
    { versions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
