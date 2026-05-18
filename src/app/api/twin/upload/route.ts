// POST /api/twin/upload — multipart upload of a single reference file the
// CEO is attaching to their next chat turn. We persist under
// `data/uploads/<employeeId>/<id>-<safe-name>` and return the path relative
// to the dataRoot the twin runner cd's into. The twin's Read tool is
// already sandboxed to `data/`, so passing this path back through the
// prompt lets the twin read the file with zero further wiring.
//
// Size/type policy: 25MB hard cap, no MIME filtering (the twin can decline
// to read a binary blob just fine). Filenames are slugified to avoid
// path-traversal and OS-illegal chars.

import { NextRequest } from "next/server";
import fsp from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Strip path separators, normalise unicode, cap length. Preserve extension. */
function safeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/]+/g, "_");
  const ext = path.extname(trimmed).slice(0, 16); // sane extensions
  const base = path
    .basename(trimmed, ext)
    .normalize("NFKD")
    // Keep letters, digits, dot, dash, underscore — drop everything else.
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return (base || "file") + ext.toLowerCase();
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "expected multipart/form-data" }, 400);

  const employeeId = String(form.get("employeeId") ?? "").trim();
  if (!/^[a-z0-9_-]+$/i.test(employeeId)) {
    return json({ error: "invalid employeeId" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ error: "file field is required" }, 400);
  }
  if (file.size === 0) return json({ error: "file is empty" }, 400);
  if (file.size > MAX_BYTES) {
    return json({ error: `file exceeds ${MAX_BYTES / (1024 * 1024)}MB limit` }, 413);
  }

  const dir = path.join(process.cwd(), "data", "uploads", employeeId);
  await fsp.mkdir(dir, { recursive: true });

  const id = randomBytes(4).toString("hex");
  const safe = safeFilename(file.name || "file");
  const filename = `${id}-${safe}`;
  const absPath = path.join(dir, filename);

  const buf = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(absPath, buf);

  // The twin runner cd's into `data/`, so the relative form would in
  // theory be enough. In practice the SDK's Read tool requires an
  // absolute path, so we return both:
  //   path     — the absolute filesystem path the model should pass to Read
  //   relPath  — the data-relative form, handy for debugging / display
  // The client splices `path` into the <attached> block.
  const relPath = path.posix.join("uploads", employeeId, filename);

  return json({
    ok: true,
    path: absPath,
    relPath,
    filename: safe,
    size: file.size,
    contentType: file.type || "application/octet-stream",
  });
}
