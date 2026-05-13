import {
  deleteOrgBrainNode,
  readOrgBrainNode,
  writeOrgBrainNode,
  type OrgBrainNodeType,
} from "@/lib/org-brain";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const node = readOrgBrainNode(slug);
  if (!node) {
    return Response.json({ error: "node not found" }, { status: 404 });
  }
  return Response.json(
    { node },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const existing = readOrgBrainNode(slug);
  if (!existing) {
    return Response.json({ error: "node not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    label?: string;
    type?: OrgBrainNodeType;
    description?: string;
    triggers?: string[];
    sources?: string[];
    linkedNodes?: string[];
    body?: string;
  };

  const node = writeOrgBrainNode({
    slug: existing.slug,
    label: body.label ?? existing.label,
    type: body.type ?? existing.type,
    description: body.description ?? existing.description,
    triggers: body.triggers ?? existing.triggers,
    sources: body.sources ?? existing.sources,
    linkedNodes: body.linkedNodes ?? existing.linkedNodes,
    body: body.body ?? existing.body,
  });

  return Response.json({ node });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const existed = deleteOrgBrainNode(slug);
  if (!existed) {
    return Response.json({ error: "node not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
