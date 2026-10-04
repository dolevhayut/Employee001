import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { getHiredAgentIds, dismissAgent } from "@/lib/hired-agents";
import { appendAuditEntry } from "@/lib/audit-log";
import { purgeEmployee, runningWorkFor } from "@/lib/employee-purge";
import { withSidecarLock } from "@/lib/sidecar-lock";
import { dataDir } from "@/lib/app-home";

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

  const dir = dataDir("employees", id);
  const resolved = path.resolve(dir);
  const expectedRoot = path.resolve(dataDir("employees")) + path.sep;
  if (!resolved.startsWith(expectedRoot)) {
    return NextResponse.json(
      { error: "path_escape", message: `Refused to ${action} outside data/employees/.` },
      { status: 400 },
    );
  }
  return { dir };
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const located = employeeDir(id, "delete");
  if (located instanceof NextResponse) return located;

  // A run still in progress would write files back after the purge.
  const running = runningWorkFor(id);
  if (running.length) {
    return NextResponse.json(
      {
        error: "twin_busy",
        message: `This twin is still working (${running.map((r) => r.label).join(", ")}). Stop it or wait for it to finish, then delete again.`,
        running,
      },
      { status: 409 },
    );
  }

  // Marketplace hires also have a hired-agents.json row to drop.
  const marketplace = getHiredAgentIds().includes(id);
  if (marketplace && !dismissAgent(id)) {
    return NextResponse.json(
      { error: "dismiss_failed", message: "Could not dismiss marketplace hire." },
      { status: 500 },
    );
  }

  // Full deletion: profile, memory, chats, runs, relay, feed, routines,
  // invites, audit inputs and Composio connections (see employee-purge.ts).
  // Idempotent, so a retry after a partial failure finishes the job.
  // ?reason=consent_revoked records a consent withdrawal in the tombstone.
  const reason = new URL(req.url).searchParams.get("reason") === "consent_revoked" ? "consent_revoked" : "deleted";
  const report = await purgeEmployee(id, reason);
  if (!report.complete) {
    const failed = report.steps.filter((s) => s.status === "error").map((s) => s.target);
    return NextResponse.json(
      {
        error: "purge_incomplete",
        message: `Some data could not be deleted (${failed.join(", ")}). Try again.`,
        report,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, kind: marketplace ? "marketplace" : "disk", report });
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
  const input = body as { nameHe?: unknown; answerSlackWithoutAsking?: unknown };
  const nameHeRaw = input.nameHe;
  const slackSetting = input.answerSlackWithoutAsking;
  if (nameHeRaw !== undefined && typeof nameHeRaw !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (slackSetting !== undefined && typeof slackSetting !== "boolean") return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const nameHe = nameHeRaw === undefined ? undefined : normalizeNameHe(nameHeRaw);
  if (nameHe === null) {
    return NextResponse.json({ error: "not_hebrew" }, { status: 400 });
  }

  // Serialized with other writers of this sidecar (activity counter) so
  // neither drops the other's fields.
  const outcome = await withSidecarLock(id, async (): Promise<NextResponse | Record<string, unknown>> => {
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

    if (nameHe !== undefined) {
      if (nameHe === "") delete sidecar.nameHe;
      else sidecar.nameHe = nameHe;
    }
    if (slackSetting !== undefined) sidecar.answerSlackWithoutAsking = slackSetting;

    const tmp = path.join(dir, `.employee.json.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp, JSON.stringify(sidecar, null, 2) + "\n", "utf8");
      await fs.rename(tmp, sidecarPath);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: "write_failed", message }, { status: 500 });
    }
    return sidecar;
  });
  if (outcome instanceof NextResponse) return outcome;
  const sidecar = outcome;

  const employeeName = typeof sidecar.name === "string" ? sidecar.name : id;
  appendAuditEntry({
    runId: `update-name-he-${Date.now()}`,
    employeeId: id,
    employeeName,
    toolName: "employee.update_name_he",
    bareName: "employee.update_name_he",
    input: { id, ...(nameHe !== undefined ? { nameHe } : {}), ...(slackSetting !== undefined ? { answerSlackWithoutAsking: slackSetting } : {}) },
    verdict: "executed",
  });

  return NextResponse.json({ ok: true, ...(nameHe !== undefined ? { nameHe } : {}), ...(slackSetting !== undefined ? { answerSlackWithoutAsking: slackSetting } : {}) });
}
