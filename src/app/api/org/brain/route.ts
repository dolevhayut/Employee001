import {
  listOrgBrainNodes,
  writeOrgBrainNode,
  type OrgBrainNodeType,
} from "@/lib/org-brain";

export async function GET() {
  return Response.json(
    { nodes: listOrgBrainNodes() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    slug?: string;
    label?: string;
    type?: OrgBrainNodeType;
    description?: string;
    triggers?: string[];
    sources?: string[];
    linkedNodes?: string[];
    body?: string;
  };

  if (!body.slug?.trim() || !body.label?.trim()) {
    return Response.json(
      { error: "slug and label are required" },
      { status: 400 }
    );
  }

  try {
    const node = writeOrgBrainNode({
      slug: body.slug,
      label: body.label,
      type: body.type,
      description: body.description ?? "",
      triggers: body.triggers ?? [],
      sources: body.sources ?? [],
      linkedNodes: body.linkedNodes ?? [],
      body: body.body ?? "",
    });
    return Response.json({ node }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to save node";
    return Response.json({ error: message }, { status: 400 });
  }
}
