import { NextRequest } from "next/server";
import { listBuilds } from "@/lib/twin-versions";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const builds = listBuilds(id);
  return Response.json(
    { builds: builds.slice().reverse() }, // newest first for the UI
    { headers: { "Cache-Control": "no-store" } }
  );
}
