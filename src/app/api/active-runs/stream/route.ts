import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { listActiveRuns } from "@/lib/active-runs";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "active-runs.json");

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const includeRecent = url.searchParams.get("includeRecent") === "1";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Immediate snapshot on connect.
      send(listActiveRuns({ includeRecent }));

      // Debounce: avoid burst writes causing many rapid pushes.
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const onFileChange = () => {
        if (closed) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          send(listActiveRuns({ includeRecent }));
        }, 150);
      };

      // Watch the file (and directory so we catch atomic renames).
      let watcher: fs.FSWatcher | null = null;
      try {
        const dir = path.dirname(FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Watch the directory — atomic rename (tmp→file) triggers "rename" on file.
        watcher = fs.watch(dir, (eventType, filename) => {
          if (filename === path.basename(FILE)) onFileChange();
        });
      } catch {
        // fs.watch unavailable (e.g. some Docker environments) — heartbeat keeps connection alive.
      }

      // Heartbeat comment every 20 s to prevent proxy timeouts.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 20_000);

      // Cleanup on client disconnect.
      req.signal.addEventListener("abort", () => {
        closed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        clearInterval(heartbeat);
        try { watcher?.close(); } catch { /* ok */ }
        try { controller.close(); } catch { /* ok */ }
      });
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
