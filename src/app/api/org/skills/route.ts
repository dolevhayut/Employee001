import { listOrgSkills, writeOrgSkill } from "@/lib/org-skills";

export async function GET() {
  return Response.json({ skills: listOrgSkills() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    id?: string;
    label?: string;
    description?: string;
    triggers?: string[];
    body?: string;
  };

  if (!body.id?.trim() || !body.label?.trim()) {
    return Response.json({ error: "id and label are required" }, { status: 400 });
  }

  try {
    const skill = writeOrgSkill({
      id: body.id,
      label: body.label,
      description: body.description ?? "",
      triggers: body.triggers ?? [],
      body: body.body ?? "",
    });
    return Response.json({ skill }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to save skill";
    return Response.json({ error: message }, { status: 400 });
  }
}
