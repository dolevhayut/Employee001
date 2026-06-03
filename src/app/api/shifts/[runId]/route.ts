import { NextRequest, NextResponse } from "next/server";
import { readShiftArchive, readArtifactContent, readShiftEvents } from "@/lib/shift-archive";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const sp = req.nextUrl.searchParams;
  // ?artifact=filename → fetch a specific artifact's content
  const artifactName = sp.get("artifact");
  if (artifactName) {
    const content = readArtifactContent(runId, artifactName);
    if (!content) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ content });
  }
  // ?events=1 → full chronological activity timeline (thinking, tools, results)
  if (sp.get("events")) {
    return NextResponse.json({ events: readShiftEvents(runId) });
  }
  const data = readShiftArchive(runId);
  if (!data.manifest) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
