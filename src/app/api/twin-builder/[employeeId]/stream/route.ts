import { NextRequest } from "next/server";
import {
  getActiveBuild,
  readBuildEvents,
  type ActiveBuildEntry,
} from "@/lib/twin-versions";

export const runtime = "nodejs";
// Tail can outlive a single page view; cap matches the runner's cap.
export const maxDuration = 600;

/**
 * Tail an in-flight Twin Builder run by reading its `.events.jsonl` file.
 *
 * Three modes:
 *  - `?buildId=<id>` — tail that specific build (used by the live UI when a
 *    fresh page load reattaches to an existing run).
 *  - no buildId, employee has an active build → tail it.
 *  - no buildId, no active build → 404. The UI should fall back to its
 *    preflight state and offer a Start button.
 *
 * The stream:
 *  - Replays every event already on disk on connect (so latecomers see the
 *    full history).
 *  - Polls the file every ~250 ms for new events.
 *  - Closes once it reads a `done` event, OR the active sentinel disappears
 *    AND no new events appear for 2 ticks (build crashed).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;
  const url = new URL(request.url);
  const queryBuildId = url.searchParams.get("buildId") ?? undefined;

  const active: ActiveBuildEntry | null = getActiveBuild(employeeId);
  const buildId = queryBuildId ?? active?.buildId;
  if (!buildId) {
    return Response.json(
      { error: "no active build for this employee" },
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

      // Browser disconnects — stop the loop. The build itself isn't affected
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

      // Heartbeat so middleboxes don't kill the connection during long
      // gaps between agent turns.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cancelled = true;
        }
      }, 15_000);

      while (!cancelled) {
        const { events, nextOffset } = readBuildEvents(
          employeeId,
          buildId,
          offset
        );
        if (events.length > 0) {
          for (const ev of events) {
            send(ev);
            if (
              typeof ev === "object" &&
              ev !== null &&
              "type" in ev &&
              (ev as { type: string }).type === "done"
            ) {
              sawDone = true;
            }
          }
          offset = nextOffset;
          idleTicks = 0;
          if (sawDone) break;
          continue;
        }

        // No new events. Two reasons: (a) build is mid-tool-call, just wait;
        // (b) build process is gone. We use the active sentinel to tell the
        // difference. If the sentinel disappears and we go N idle ticks
        // without seeing a `done` event, treat it as crashed and exit.
        const stillActive = getActiveBuild(employeeId)?.buildId === buildId;
        if (!stillActive) {
          idleTicks += 1;
          if (idleTicks >= 4) {
            // ~1s after sentinel cleared — runner had its `done` chance
            // and didn't take it. Tell the client and bail.
            send({
              type: "done",
              filesWritten: [],
              turns: 0,
              costUsd: 0,
              stoppedReason: "natural",
              ts: 0,
            });
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
