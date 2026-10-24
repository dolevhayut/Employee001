import { NextRequest } from "next/server";
import { interviewerTurn } from "@/lib/relay/live-interview";
import { loadHandoverState } from "@/lib/relay/handover-state";
import { modelErrorMessage } from "@/lib/model-provider";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One interviewer turn, streamed as SSE. Body: `{ answer?: string }`: the
 * employee's answer to the last question (omit to open the interview). The
 * transcript is kept on the server.
 *
 * Events: `{ type:'text_delta', delta }`, then `{ type:'done', messages }`,
 * or `{ type:'error', message }`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await ctx.params;
  const state = await loadHandoverState(employeeId);
  if (!state) return Response.json({ error: "Twin not found" }, { status: 404 });
  if (state.lifecycle !== "handover") return Response.json({ error: "No handover is open for this twin." }, { status: 409 });
  if (!state.model.ok) return Response.json({ error: state.model.reason }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { answer?: unknown };
  const answer = typeof body.answer === "string" ? body.answer : undefined;
  // An empty answer opens the interview, or retries after a failed turn
  // (the last saved message is then the employee's).
  if (!answer?.trim() && state.messages.length > 0 && state.messages.at(-1)?.role !== "user") {
    return Response.json({ error: "Write an answer first." }, { status: 400 });
  }

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
      try {
        const messages = await interviewerTurn(employeeId, answer, (delta) => send({ type: "text_delta", delta }));
        send({ type: "done", messages });
      } catch (err) {
        send({ type: "error", message: modelErrorMessage(err instanceof Error ? err.message : "Interview turn failed") });
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
