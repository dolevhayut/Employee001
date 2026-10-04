import "server-only";

import { readFile } from "node:fs/promises";
import type { CouncilEvent } from "@/lib/council-runner";

export type DemoRecording = {
  version: 1;
  question: string;
  participantIds: string[];
  events: Array<{ dtMs: number; event: CouncilEvent }>;
};

type Sleep = (ms: number) => Promise<void>;
const delay: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertDemoRecording(value: unknown): asserts value is DemoRecording {
  if (!value || typeof value !== "object") throw new Error("Demo recording must be an object.");
  const recording = value as Partial<DemoRecording>;
  if (recording.version !== 1 || typeof recording.question !== "string" || !Array.isArray(recording.participantIds) || !Array.isArray(recording.events)) {
    throw new Error("Demo recording has an unsupported shape.");
  }
  for (const entry of recording.events) {
    if (!entry || typeof entry.dtMs !== "number" || entry.dtMs < 0 || !entry.event || typeof entry.event !== "object" || !("type" in entry.event)) {
      throw new Error("Demo recording contains an invalid event.");
    }
  }
}

export async function loadDemoRecording(recordingPath = process.env.EMPLOYEE001_DEMO_RECORDING): Promise<DemoRecording> {
  if (!recordingPath) throw new Error("EMPLOYEE001_DEMO_RECORDING is not configured.");
  const parsed: unknown = JSON.parse(await readFile(recordingPath, "utf8"));
  assertDemoRecording(parsed);
  return parsed;
}

/** Stream exactly the same SSE payload shape as a live council run. */
export function createDemoReplayStream(
  recording: DemoRecording,
  { signal, sleep = delay }: { signal?: AbortSignal; sleep?: Sleep } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for (const { dtMs, event } of recording.events) {
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

export async function createDemoReplayResponse(signal?: AbortSignal): Promise<Response> {
  const recording = await loadDemoRecording();
  return new Response(createDemoReplayStream(recording, { signal }), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
