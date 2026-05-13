import { NextRequest } from "next/server";
import { listActiveBuilds } from "@/lib/twin-versions";

export const runtime = "nodejs";

/** Workspace-wide active builds — feeds the global header banner. */
export async function GET(_request: NextRequest) {
  const builds = listActiveBuilds();
  return Response.json(
    { builds },
    { headers: { "Cache-Control": "no-store" } }
  );
}
