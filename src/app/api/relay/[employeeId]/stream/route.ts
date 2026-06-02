import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { listActiveRuns, getActiveRun } from "@/lib/active-runs";
import type { RelayEvent } from "@/lib/relay";

export const runtime = "nodejs";
// Tail can outlive a single page view; cap matches the runner's cap.
export const maxDuration = 600;

/** Where spawnDetachedRelay/appendHandoverEvent persist the event log. */
const EVENTS_PATH = (handoverId: string) =>
  path.join(process.cwd(), "data", "relay", handoverId, "events.jsonl");

/**
 * Read new JSONL events from `offset` bytes onward, returning the parsed
 * events plus the new byte offset. Tolerates a partially-written trailing line
 * (the runner appends line-by-line) by only consuming up to the last newline.
 */
function readRelayEvents(
  handoverId: string,
  offset: number
): { events: RelayEvent[]; nextOffset: number } {
  const file = EVENTS_PATH(handoverId);
  let buf: string;
  try {
    buf = fs.readFileSync(file, "utf8");
  } catch {
    return { events: [], nextOffset: offset };
  }
  if (buf.length <= offset) {
    return { events: [], nextOffset: offset };
  }

  const slice = buf.slice(offset);
  const lastNl = slice.lastIndexOf("\n");
  if (lastNl < 0) {
    // No complete line yet — wait for the trailing newline.
    return { events: [], nextOffset: offset };
  }

  const consumable = slice.slice(0, lastNl);
  const events: RelayEvent[] = [];
  for (const line of consumable.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as RelayEvent);
    } catch {
      /* skip a malformed line */
    }
  }
  return { events, nextOffset: offset + lastNl + 1 };
}

/**
 * Tail an in-flight Relay handover by reading its `events.jsonl` file.
 *
 * Mirrors the Twin Builder `/stream` route exactly:
 *  - `?handoverId=<id>` — tail that specific handover (fresh page reattach).
 *  - no handoverId, employee has an active relay run → tail it.
 *  - no handoverId, no active run → 404. The UI falls back to its preflight
 *    state and offers a Start button.
 *
 * The stream:
 *  - Replays every event already on disk on connect (latecomers see history).
 *  - Polls the file every ~250 ms for new events.
 *  - Sends a 15 s heartbeat `: ping` so middleboxes don't kill the connection.
 *  - Closes once it reads a `done` event, OR the active sentinel disappears AND
 *    no new events appear for ~4 idle ticks (runner crashed).
 *
 * SSE framing: `data: ${JSON.stringify(event)}\n\n`.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;
  const url = new URL(request.url);
  const queryHandoverId = url.searchParams.get("handoverId") ?? undefined;

  // Find the active relay run for this employee (most recent first).
  const active = listActiveRuns({ employeeId, surface: "relay" })[0] ?? null;
  const handoverId = queryHandoverId ?? active?.runId;
  if (!handoverId) {
    return Response.json(
      { error: "no active handover for this employee" },
      { status: 404 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let offset = 0;
      let sawDone = false;
      let idleTicks = 0;
      let cancelled = false;

      // Browser disconnects — stop the loop. The handover itself isn't affected
      // because it's running detached from this request (see POST route).
      request.signal.addEventListener("abort", () => {
        cancelled = true;
      });

      const send = (event: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          cancelled = true;
        }
      };

      // Heartbeat so middleboxes don't kill the connection during long gaps
      // between phases.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cancelled = true;
        }
      }, 15_000);

      while (!cancelled) {
        const { events, nextOffset } = readRelayEvents(handoverId, offset);
        if (events.length > 0) {
          for (const ev of events) {
            send(ev);
            if (ev.type === "done") {
              sawDone = true;
            }
          }
          offset = nextOffset;
          idleTicks = 0;
          if (sawDone) break;
          continue;
        }

        // No new events. Either the runner is mid-phase (just wait) or the run
        // is gone. Use the active sentinel to tell the difference: if it has
        // disappeared and we go N idle ticks without a `done`, treat it as
        // crashed and synthesize a terminal `done` for the client.
        const stillActive = getActiveRun(handoverId)?.status === "running";
        if (!stillActive) {
          idleTicks += 1;
          if (idleTicks >= 4) {
            send({
              type: "done",
              rcpPath: "",
              status: "draft",
              weightedScore: 0,
              turns: 0,
              costUsd: 0,
              stoppedReason: "error",
              ts: 0,
            } satisfies RelayEvent);
            break;
          }
        } else {
          idleTicks = 0;
        }

        await new Promise((r) => setTimeout(r, 250));
      }

      clearInterval(heartbeat);
      try {
        controller.close();
      } catch {
        /* already closed */
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
