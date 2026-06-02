import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import {
  readKnowledgeFile,
  writeKnowledgeFile,
  deleteKnowledgeFile,
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
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;
  if (!hasEmployeeFiles(id)) {
    return jsonResponse({ error: "employee not found" }, 404);
  }
  const result = readKnowledgeFile(id, name);
  if (!result) {
    return jsonResponse({ error: "file not found" }, 404);
  }
  return jsonResponse(result);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;
  if (!hasEmployeeFiles(id)) {
    return jsonResponse({ error: "employee not found" }, 404);
  }

  let body: { body?: string };
  try {
    body = (await request.json()) as { body?: string };
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.body !== "string") {
    return jsonResponse({ error: "body is required" }, 400);
  }

  let meta: KnowledgeFile | null;
  try {
    meta = writeKnowledgeFile(id, name, body.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown disk error";
    return diskErrorResponse(`save ${id}/${name}`, message);
  }
  if (!meta) {
    return jsonResponse(
      { error: "invalid file name or unsupported extension" },
      400
    );
  }
  return jsonResponse({ meta });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;
  if (!hasEmployeeFiles(id)) {
    return jsonResponse({ error: "employee not found" }, 404);
  }
  const ok = deleteKnowledgeFile(id, name);
  if (!ok) {
    return jsonResponse({ error: "file not found" }, 404);
  }
  return jsonResponse({ ok: true });
}
