import { readOrgSkill, writeOrgSkill } from "@/lib/org-skills";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const skill = readOrgSkill(id);
  if (!skill) return Response.json({ error: "skill not found" }, { status: 404 });
  return Response.json({ skill }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const existing = readOrgSkill(id);
  if (!existing) return Response.json({ error: "skill not found" }, { status: 404 });

  const body = (await request.json()) as {
    label?: string;
    description?: string;
    triggers?: string[];
    body?: string;
  };

  const skill = writeOrgSkill({
    id: existing.id,
    label: body.label ?? existing.label,
    description: body.description ?? existing.description,
    triggers: body.triggers ?? existing.triggers,
    body: body.body ?? existing.body,
  });

  return Response.json({ skill });
}
