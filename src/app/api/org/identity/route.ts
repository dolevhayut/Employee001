import { readOrgIdentity, writeOrgIdentity } from "@/lib/org-identity";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ identity: readOrgIdentity() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  let body: { name?: unknown; description?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // Partial update: a field left out keeps its saved value.
  const current = readOrgIdentity();
  const identity = writeOrgIdentity({
    name: body.name === undefined ? current.name : body.name,
    description: body.description === undefined ? current.description : body.description,
  });
  return Response.json({ identity });
}
