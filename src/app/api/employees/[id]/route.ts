import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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

const NAME_HE_MAX = 80;

/** Trim, collapse whitespace, strip controls, then cap. Empty is allowed. */
function normalizeNameHe(raw: string): string | null {
  let value = raw.trim().replace(/\s+/g, " ");
  let stripped = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) continue;
    stripped += ch;
  }
  value = stripped.slice(0, NAME_HE_MAX);
  if (value === "") return "";
  if (!/[\u0590-\u05FF]/.test(value)) return null;
  return value;
}

function employeeDir(id: string, action: "delete" | "update"): { dir: string } | NextResponse {
  if (!isSafeId(id)) {
    return NextResponse.json(
      { error: "invalid_id", message: "Employee id is not in the expected shape." },
      { status: 400 },
    );
  }

  const root = process.cwd();
  const dir = path.join(root, "data", "employees", id);
  const resolved = path.resolve(dir);
  const expectedRoot = path.resolve(path.join(root, "data", "employees")) + path.sep;
  if (!resolved.startsWith(expectedRoot)) {
    return NextResponse.json(
      { error: "path_escape", message: `Refused to ${action} outside data/employees/.` },
      { status: 400 },
    );
  }
  return { dir };
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const located = employeeDir(id, "delete");
  if (located instanceof NextResponse) return located;
  const { dir } = located;

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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const located = employeeDir(id, "update");
  if (located instanceof NextResponse) return located;
  const { dir } = located;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const nameHeRaw = (body as { nameHe?: unknown }).nameHe;
  if (typeof nameHeRaw !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const nameHe = normalizeNameHe(nameHeRaw);
  if (nameHe === null) {
    return NextResponse.json({ error: "not_hebrew" }, { status: 400 });
  }

  const sidecarPath = path.join(dir, "employee.json");
  let raw: string;
  try {
    await fs.access(dir);
    raw = await fs.readFile(sidecarPath, "utf8");
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let sidecar: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "invalid_sidecar" }, { status: 500 });
    }
    sidecar = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_sidecar" }, { status: 500 });
  }

  if (nameHe === "") delete sidecar.nameHe;
  else sidecar.nameHe = nameHe;

  const tmp = path.join(dir, `.employee.json.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, JSON.stringify(sidecar, null, 2) + "\n", "utf8");
    await fs.rename(tmp, sidecarPath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "write_failed", message }, { status: 500 });
  }

  const employeeName = typeof sidecar.name === "string" ? sidecar.name : id;
  appendAuditEntry({
    runId: `update-name-he-${Date.now()}`,
    employeeId: id,
    employeeName,
    toolName: "employee.update_name_he",
    bareName: "employee.update_name_he",
    input: { id, nameHe },
    verdict: "executed",
  });

  return NextResponse.json({ ok: true, nameHe });
}
