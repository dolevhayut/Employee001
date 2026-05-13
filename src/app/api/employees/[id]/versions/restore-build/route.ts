import { NextRequest } from "next/server";
import { restoreBuild } from "@/lib/twin-versions";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { buildId?: string };
  if (typeof body.buildId !== "string" || body.buildId.length === 0) {
    return Response.json({ error: "buildId is required" }, { status: 400 });
  }
  const result = restoreBuild(id, body.buildId);
  if (!result.ok) {
    return Response.json({ error: result.error ?? "restore failed" }, { status: 400 });
  }
  return Response.json({ ok: true, restored: result.restored });
}
