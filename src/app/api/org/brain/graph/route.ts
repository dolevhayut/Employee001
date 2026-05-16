import { brainGraphStats, buildOrgBrainGraph } from "@/lib/brain-graph";

export async function GET() {
  try {
    const graph = await buildOrgBrainGraph();
    const stats = await brainGraphStats();
    return Response.json(
      { graph, stats },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "graph build failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
