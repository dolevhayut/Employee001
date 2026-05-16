import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { readEmployeeFileBody } from "@/lib/profile-graph-real";
import { writeEmployeeFileBody } from "@/lib/employees-files";
import type { RealNode } from "@/lib/profile-graph-real";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Look up a memory card by id from data/memory/<id>/cards.jsonl. Returns
 *  a synthetic FileContent shape so the existing drawer renders it. */
function loadMemoryCard(employeeId: string, cardId: string) {
  const file = path.join(
    process.cwd(),
    "data",
    "memory",
    employeeId,
    "cards.jsonl"
  );
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const c = JSON.parse(lines[i]) as {
        id?: string;
        content?: string;
        question?: string;
        answerPreview?: string;
        createdAt?: string;
        surface?: string;
        runId?: string;
      };
      if (c.id !== cardId) continue;
      const body = `# Memory card

**Question / context**

${c.question?.trim() || "_(no question recorded)_"}

**Answer (preview)**

${c.answerPreview?.trim() || "_(no preview)_"}

${
  c.content && c.content !== c.question
    ? `\n---\n\n**Full context**\n\n${c.content.trim()}\n`
    : ""
}
---

_Recorded ${c.createdAt ?? "—"} · surface: ${c.surface ?? "—"} · run: \`${c.runId ?? "—"}\`_`;
      const fm: RealNode = {
        name: `memory:${cardId}`,
        tokens: Math.round(body.length / 4),
        confidence: 0.7,
        lastUpdated: c.createdAt ?? "",
        sources: ["memory", c.surface ?? "chat"],
        linkedFiles: [],
        tags: ["memory", "working-memory"],
      };
      return { frontmatter: fm, body };
    } catch {
      /* skip malformed line */
    }
  }
  return null;
}

/** Read a scratch markdown file from data/scratch/<id>/<filename>.md. */
function loadScratchFile(employeeId: string, filename: string) {
  // Strip any directory traversal attempts.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const file = path.join(process.cwd(), "data", "scratch", employeeId, safeName);
  if (!fs.existsSync(file)) return null;
  try {
    const body = fs.readFileSync(file, "utf8");
    const stat = fs.statSync(file);
    const fm: RealNode = {
      name: `scratch:${safeName}`,
      tokens: Math.round(body.length / 4),
      confidence: 0.85,
      lastUpdated: stat.mtime.toISOString(),
      sources: ["scratch", "ai-written"],
      linkedFiles: [],
      tags: ["scratch", "working-memory"],
    };
    return { frontmatter: fm, body };
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;

  // Working memory pseudo-files written by the agent.
  if (name.startsWith("memory:")) {
    const result = loadMemoryCard(id, name.slice("memory:".length));
    if (!result) return jsonResponse({ error: "memory card not found" }, 404);
    return jsonResponse(result);
  }

  if (name.startsWith("scratch:")) {
    const result = loadScratchFile(id, name.slice("scratch:".length));
    if (!result) return jsonResponse({ error: "scratch file not found" }, 404);
    return jsonResponse(result);
  }

  const result = readEmployeeFileBody(id, name);
  if (!result) return jsonResponse({ error: "file not found" }, 404);
  return jsonResponse(result);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;
  const body = (await request.json()) as { body?: string };
  if (typeof body.body !== "string") {
    return new Response(JSON.stringify({ error: "body is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let ok: string | null = null;
  try {
    ok = writeEmployeeFileBody(id, name, body.body);
  } catch (err) {
    // Disk full, permission denied, read-only filesystem, etc. — return a
    // clean structured error so the UI can show a user-visible message
    // instead of a 500 stack trace. The app keeps running.
    const message = err instanceof Error ? err.message : "Unknown disk error";
    const lower = message.toLowerCase();
    const reason =
      lower.includes("eacces") || lower.includes("eperm")
        ? "Permission denied — the data directory is not writable. Check filesystem permissions."
        : lower.includes("enospc")
        ? "Disk is full — free up space and try again."
        : lower.includes("erofs")
        ? "Filesystem is read-only — the data directory cannot be written."
        : `Could not save: ${message}`;
    console.warn(`[profile-write] save failed for ${id}/${name}: ${message}`);
    return new Response(
      JSON.stringify({ error: reason, code: "disk_write_failed" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!ok) {
    return new Response(JSON.stringify({ error: "invalid file or employee" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return the freshly-parsed view so the client can re-render
  const result = readEmployeeFileBody(id, name);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
