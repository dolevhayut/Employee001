import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import {
  listKnowledgeFiles,
  saveUploadedKnowledgeFile,
  writeKnowledgeFile,
  type KnowledgeFile,
} from "@/lib/knowledge-files";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Map a raw disk error to a structured 503 like the base-file route does. */
function diskErrorResponse(context: string, message: string) {
  const lower = message.toLowerCase();
  const reason =
    lower.includes("eacces") || lower.includes("eperm")
      ? "Permission denied — the data directory is not writable. Check filesystem permissions."
      : lower.includes("enospc")
      ? "Disk is full — free up space and try again."
      : lower.includes("erofs")
      ? "Filesystem is read-only — the data directory cannot be written."
      : `Could not save: ${message}`;
  console.warn(`[knowledge-write] ${context}: ${message}`);
  return jsonResponse({ error: reason, code: "disk_write_failed" }, 503);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!hasEmployeeFiles(id)) {
    return jsonResponse({ error: "employee not found" }, 404);
  }
  const files = listKnowledgeFiles(id);
  return jsonResponse({ files });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!hasEmployeeFiles(id)) {
    return jsonResponse({ error: "employee not found" }, 404);
  }

  const contentType = request.headers.get("content-type") ?? "";

  // (a) multipart/form-data upload.
  if (contentType.includes("multipart/form-data")) {
    let file: File | null = null;
    try {
      const form = await request.formData();
      const field = form.get("file");
      if (field instanceof File) file = field;
    } catch {
      return jsonResponse({ error: "invalid form data" }, 400);
    }
    if (!file) {
      return jsonResponse({ error: "no file provided" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = saveUploadedKnowledgeFile(id, file.name, buffer);
    if ("error" in result) {
      const lower = result.error.toLowerCase();
      if (
        lower.includes("eacces") ||
        lower.includes("eperm") ||
        lower.includes("enospc") ||
        lower.includes("erofs")
      ) {
        return diskErrorResponse(`upload ${id}/${file.name}`, result.error);
      }
      return jsonResponse({ error: result.error }, 400);
    }
    return jsonResponse({ file: result });
  }

  // (b) application/json — create a new text file.
  let body: { name?: string; body?: string };
  try {
    body = (await request.json()) as { name?: string; body?: string };
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  if (typeof body.name !== "string" || typeof body.body !== "string") {
    return jsonResponse({ error: "name and body are required" }, 400);
  }

  let kf: KnowledgeFile | null;
  try {
    kf = writeKnowledgeFile(id, body.name, body.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown disk error";
    return diskErrorResponse(`create ${id}/${body.name}`, message);
  }
  if (!kf) {
    return jsonResponse(
      { error: "invalid file name or unsupported extension" },
      400
    );
  }
  return jsonResponse({ file: kf });
}
