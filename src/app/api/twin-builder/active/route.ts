import { listActiveBuilds } from "@/lib/twin-versions";

export const runtime = "nodejs";

/** Workspace-wide active builds — feeds the global header banner. */
export async function GET() {
  const builds = listActiveBuilds();
  return Response.json(
    { builds },
    { headers: { "Cache-Control": "no-store" } }
  );
}
