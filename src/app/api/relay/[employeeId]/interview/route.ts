import { NextRequest } from "next/server";
import { streamInterviewerTurn, hasApiKey, type ChatMessage } from "@/lib/relay/live-interview";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * LIVE interview — one interviewer turn, streamed as SSE.
 *
 * Body: `{ messages: { role: 'user'|'assistant'; content: string }[] }`
 * The client sends the full visible transcript each turn (starting with the
 * interviewer's greeting). An empty array opens the interview.
 *
 * Emits SSE events: `{ type:'text_delta', delta }` per token, then
 * `{ type:'done', text }` (or `{ type:'error', message }` + done on failure).
 *
 * Uses the sonnet capture model. Requires ANTHROPIC_API_KEY (live mode only —
 * the static fixture demo at POST /api/relay/[id] needs no key).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { messages?: ChatMessage[] };
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      if (!hasApiKey()) {
        send({ type: "error", message: "AZURE_OPENAI_ENDPOINT is not configured (live interview needs a key)." });
        send({ type: "done", text: "" });
        try { controller.close(); } catch { /* noop */ }
        return;
      }

      try {
        const full = await streamInterviewerTurn(employeeId, messages, (delta) =>
          send({ type: "text_delta", delta }),
        );
        send({ type: "done", text: full });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "interview turn failed" });
        send({ type: "done", text: "" });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
