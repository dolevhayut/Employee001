import { NextRequest } from "next/server";
import { employeeExists } from "@/lib/employees-files";
import { getEmployee } from "@/lib/employees";
import { isRetiredSync } from "@/lib/twin-lifecycle";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import {
  applyClaudeCodeImport,
  ImportChangedError,
  previewClaudeCodeImport,
  previewForClient,
} from "@/lib/claude-code-import";

export const runtime = "nodejs";

/**
 * Opt-in import from a person's Claude Code folder. Nothing is read until this
 * is called. Without `previewDigest` it only previews; with the digest of a
 * preview the person saw, it imports exactly that and writes an audit row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!employeeExists(id)) return Response.json({ error: "employee not found" }, { status: 404 });
  if (isRetiredSync(id)) {
    return Response.json({ error: "This twin is retired and read-only." }, { status: 409 });
  }

  let body: { previewDigest?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  // The source is always the server user's own ~/.claude; the client can't choose a path.
  const sourceDir = undefined;

  try {
    if (typeof body.previewDigest !== "string") {
      return Response.json({ preview: previewForClient(await previewClaudeCodeImport(id, sourceDir)) });
    }
    const user = sessionUserFromHeaders(request.headers);
    const result = await applyClaudeCodeImport({
      employeeId: id,
      employeeName: getEmployee(id)?.name ?? id,
      sourceDir,
      previewDigest: body.previewDigest,
      actorId: user?.id ?? "local",
    });
    return Response.json({ result });
  } catch (err) {
    if (err instanceof ImportChangedError) return Response.json({ error: err.message }, { status: 409 });
    return Response.json({ error: err instanceof Error ? err.message : "import failed" }, { status: 400 });
  }
}
