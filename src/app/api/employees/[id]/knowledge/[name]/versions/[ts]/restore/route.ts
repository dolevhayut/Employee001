import { NextRequest } from "next/server";
import { hasEmployeeFiles } from "@/lib/employees-files";
import {
  canonicalKnowledgeTextName,
  restoreKnowledgeVersion,
} from "@/lib/knowledge-versions";

export const runtime = "nodejs";

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
  console.warn(`[knowledge-restore] ${context}: ${message}`);
  return Response.json({ error: reason, code: "disk_write_failed" }, { status: 503 });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string; ts: string }> },
) {
  const { id, name, ts } = await params;
  if (!hasEmployeeFiles(id)) {
    return Response.json({ error: "employee not found" }, { status: 404 });
  }
  if (!canonicalKnowledgeTextName(name)) {
    return Response.json(
      { error: "invalid file name or unsupported extension" },
      { status: 400 },
    );
  }

  try {
    const result = restoreKnowledgeVersion(id, name, ts);
    if (!result.ok) {
      const status = result.error === "version not found" ? 404 : 400;
      return Response.json({ error: result.error ?? "restore failed" }, { status });
    }
    return Response.json(
      { ok: true, name, ts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown disk error";
    return diskErrorResponse(`restore ${id}/${name}@${ts}`, message);
  }
}
