import { readFile } from "node:fs/promises";
import { demoAskAudioPath, loadDemoAskRecording } from "@/lib/demo-ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A recorded Ask answer in the twin's voice. Only in the demo, and only the
 *  files its recording names. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.EMPLOYEE001_DEMO !== "1") return Response.json({ error: "Not found" }, { status: 404 });
  const { id } = await ctx.params;
  try {
    const answer = (await loadDemoAskRecording()).answers.find((a) => a.id === id);
    const file = answer ? demoAskAudioPath(answer) : null;
    if (!file) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(await readFile(file)), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
