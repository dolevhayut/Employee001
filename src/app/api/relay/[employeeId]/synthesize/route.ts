import { NextRequest } from "next/server";
import { synthesizeFromConversation, hasApiKey, type ChatMessage } from "@/lib/relay/live-interview";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * LIVE synthesis — turn a real interview transcript into a Role Context Package
 * via the opus synthesis model. Writes data/handovers/<id>/rcp.live.json
 * (NEVER the static investor fixture rcp.json).
 *
 * Body: `{ messages: { role:'user'|'assistant'; content:string }[] }`.
 * Returns `{ rcp, coverage }`.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await context.params;

  if (!hasApiKey()) {
    return Response.json(
      { error: "AZURE_OPENAI_ENDPOINT is not configured (live synthesis needs a key)." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { messages?: ChatMessage[] };
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (messages.filter((m) => m.role === "user" && m.content?.trim()).length === 0) {
    return Response.json(
      { error: "No answers to synthesize yet — answer a few questions first." },
      { status: 400 },
    );
  }

  try {
    const { rcp, coverage } = await synthesizeFromConversation(employeeId, messages);
    return Response.json({ rcp, coverage });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "synthesis failed" },
      { status: 500 },
    );
  }
}
