import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEMO_ASK_FALLBACK,
  findDemoAnswer,
  parseAskRecording,
  type DemoAskAnswer,
  type DemoAskEvent,
  type DemoAskRecording,
} from "@/lib/demo-ask-recording";

type Sleep = (ms: number) => Promise<void>;
const delay: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** bin/demo/ask.json: set by `employee001 demo`, else next to the meeting recording. */
export function demoAskPath(env: Record<string, string | undefined> = process.env): string | null {
  if (env.EMPLOYEE001_DEMO_ASK) return env.EMPLOYEE001_DEMO_ASK;
  return env.EMPLOYEE001_DEMO_RECORDING ? path.join(path.dirname(env.EMPLOYEE001_DEMO_RECORDING), "ask.json") : null;
}

export async function loadDemoAskRecording(file = demoAskPath()): Promise<DemoAskRecording> {
  if (!file) throw new Error("EMPLOYEE001_DEMO_ASK is not configured.");
  return parseAskRecording(JSON.parse(await readFile(file, "utf8")));
}

/** The recorded answer's audio file on disk, or null when it has none. */
export function demoAskAudioPath(answer: DemoAskAnswer, file = demoAskPath()): string | null {
  if (!answer.audio || !file) return null;
  return path.join(path.dirname(file), answer.audio.file);
}

const fallbackEvents = (): Array<{ dtMs: number; event: DemoAskEvent }> => [
  { dtMs: 300, event: { type: "text_delta", delta: DEMO_ASK_FALLBACK, ts: 300 } },
  { dtMs: 0, event: { type: "done", confidence: 0, cited_files: [], ts: 300 } },
];

/** Stream a recorded answer (or the demo hint) in the live /api/twin/chat SSE shape. */
export function createDemoAskStream(
  answer: DemoAskAnswer | null,
  { signal, sleep = delay }: { signal?: AbortSignal; sleep?: Sleep } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = answer?.events ?? fallbackEvents();
  return new ReadableStream({
    async start(controller) {
      try {
        for (const { dtMs, event } of events) {
          if (signal?.aborted) break;
          if (dtMs > 0) await sleep(dtMs);
          if (signal?.aborted) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } finally {
        try {
          controller.close();
        } catch {
          // A disconnected client can close the stream before replay finishes.
        }
      }
    },
  });
}

/** /api/twin/chat in a replay demo: never a model call. */
export async function createDemoAskResponse(employeeId: string | undefined, question: string, signal?: AbortSignal): Promise<Response> {
  let answer: DemoAskAnswer | null = null;
  try {
    answer = findDemoAnswer(await loadDemoAskRecording(), employeeId, question);
  } catch (err) {
    console.error("[demo] Ask recording unavailable:", err instanceof Error ? err.message : err);
  }
  return new Response(createDemoAskStream(answer, { signal }), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
