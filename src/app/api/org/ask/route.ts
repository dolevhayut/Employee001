import { NextRequest } from "next/server";
import { canRunModel } from "@/lib/model-provider";
import { briefFrom, briefFromOrgBrain, briefFromSystems, pickTwins, readyTwins, synthesize } from "@/lib/org-ask";

// POST /api/org/ask { question } → SSE. The company answers with one voice:
//   route        → which twins were asked, and why
//   source_*     → each source's read-only brief (start, tool calls, done):
//                  the company brain, the connected systems, each twin
//   answer_delta → the single synthesized answer, with [[twin-id]] citations
//   done | error
export async function POST(req: NextRequest) {
  let question = "";
  try {
    question = String(((await req.json()) as { question?: unknown }).question ?? "").trim();
  } catch {
    // fall through to the 400
  }
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });
  const modelRun = canRunModel();
  if (!modelRun.ok) return Response.json({ error: modelRun.reason }, { status: 500 });

  const twins = await readyTwins();
  if (twins.length === 0) return Response.json({ error: "no ready twins" }, { status: 400 });

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client went away
        }
      };
      try {
        // Documents and systems start right away; twins once the router picked them.
        const fromBrain = briefFromOrgBrain(question, send);
        const fromSystems = briefFromSystems(question, send, abort);
        const { picks, by } = await pickTwins(question, twins);
        send({ type: "route", picks, by });
        const chosen = picks.map((p) => twins.find((t) => t.id === p.id)).filter((t): t is (typeof twins)[number] => Boolean(t));
        // Sources work in parallel: this is a lookup, not a meeting.
        const briefs = [fromBrain, ...(await Promise.all([fromSystems, ...chosen.map((twin) => briefFrom(twin, question, send, abort))]))];
        if (!abort.signal.aborted) {
          await synthesize(question, briefs, (delta) => send({ type: "answer_delta", delta }));
          send({ type: "done" });
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
