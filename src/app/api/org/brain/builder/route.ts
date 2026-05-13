import { buildBrainNodesFromText } from "@/lib/org-brain-builder";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let payload: { text?: string; sourceLabel?: string };
  try {
    payload = (await request.json()) as { text?: string; sourceLabel?: string };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = (payload.text ?? "").trim();
  if (!text) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 60_000) {
    return Response.json(
      { error: "text exceeds 60,000 chars — split before submitting" },
      { status: 413 }
    );
  }

  try {
    const result = await buildBrainNodesFromText({
      text,
      sourceLabel: payload.sourceLabel?.trim() || undefined,
    });
    return Response.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Brain Builder failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
