import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getHiredAgentIds, dismissAgent } from "@/lib/hired-agents";
import { appendAuditEntry } from "@/lib/audit-log";

// Slug pattern matches everything our materialisers emit:
// `dolev-hayut`, `pending-c7bc0d-c7bc0d`, `marketplace-sdr-alex`, etc.
// Reject anything that isn't lowercase letters / digits / single hyphens so
// a malicious id can't traverse out of data/employees/.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function isSafeId(id: string): boolean {
  return ID_PATTERN.test(id) && !id.includes("..") && !id.includes("/");
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!isSafeId(id)) {
    return NextResponse.json(
      { error: "invalid_id", message: "Employee id is not in the expected shape." },
      { status: 400 },
    );
  }

  const root = process.cwd();
  const dir = path.join(root, "data", "employees", id);

  // Defence in depth: resolve and confirm the target is still inside
  // data/employees/ after normalisation.
  const resolved = path.resolve(dir);
  const expectedRoot = path.resolve(path.join(root, "data", "employees")) + path.sep;
  if (!resolved.startsWith(expectedRoot)) {
    return NextResponse.json(
      { error: "path_escape", message: "Refused to delete outside data/employees/." },
      { status: 400 },
    );
  }

  // Branch 1 — marketplace hire. `dismissAgent` removes the directory and
  // the hired-agents.json row in one transactional step.
  if (getHiredAgentIds().includes(id)) {
    const ok = dismissAgent(id);
    if (!ok) {
      return NextResponse.json(
        { error: "dismiss_failed", message: "Could not dismiss marketplace hire." },
        { status: 500 },
      );
    }
    appendAuditEntry({
      runId: `delete-${Date.now()}`,
      employeeId: id,
      employeeName: id,
      toolName: "deleteEmployee",
      bareName: "deleteEmployee",
      input: { id, kind: "marketplace" },
      verdict: "executed",
    });
    return NextResponse.json({ ok: true, kind: "marketplace" });
  }

  // Branch 2 — invite-created or imported twin. Just remove the directory.
  // If it doesn't exist we still 200 — idempotent delete.
  let existed = true;
  try {
    await fs.access(dir);
  } catch {
    existed = false;
  }

  if (existed) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "delete_failed", message },
        { status: 500 },
      );
    }
  }

  appendAuditEntry({
    runId: `delete-${Date.now()}`,
    employeeId: id,
    employeeName: id,
    toolName: "deleteEmployee",
    bareName: "deleteEmployee",
    input: { id, kind: "disk", existed },
    verdict: "executed",
  });

  return NextResponse.json({ ok: true, kind: "disk", existed });
}
