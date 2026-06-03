import { NextRequest, NextResponse } from "next/server";
import { readShiftArchive, readArtifactContent } from "@/lib/shift-archive";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  // Optional ?artifact=filename to fetch a specific artifact's content
  const artifactName = req.nextUrl.searchParams.get("artifact");
  if (artifactName) {
    const content = readArtifactContent(runId, artifactName);
    if (!content) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ content });
  }
  const data = readShiftArchive(runId);
  if (!data.manifest) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
