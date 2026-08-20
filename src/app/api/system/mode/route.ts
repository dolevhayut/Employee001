import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceModeRecord,
  setWorkspaceMode,
  type WorkspaceMode,
} from "@/lib/workspace-mode";
import { appendAuditEntry } from "@/lib/audit-log";
import { listRoutines, updateRoutine, computeNextRun } from "@/lib/routines";

export const runtime = "nodejs";

// GET /api/system/mode → { mode, changedAt }
export async function GET() {
  return NextResponse.json(getWorkspaceModeRecord(), {
    headers: { "Cache-Control": "no-store" },
  });
}

// PATCH /api/system/mode  Body: { mode: "base" | "x" }
// Flipping to "base" is the kill switch: the scheduler stops firing
// autonomous work on its next tick (≤30s).
export async function PATCH(req: NextRequest) {
  let body: { mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.mode !== "base" && body.mode !== "x") {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  const record = setWorkspaceMode(body.mode as WorkspaceMode);

  // Re-arming after time off: every routine whose nextRunAt went stale while
  // disarmed would fire AT ONCE on the next tick. Roll stale cursors forward
  // to their next natural slot instead — arming resumes the schedule, it
  // doesn't replay the backlog.
  if (body.mode === "x") {
    const now = Date.now();
    for (const r of listRoutines()) {
      if (!r.enabled || !r.nextRunAt) continue;
      if (new Date(r.nextRunAt).getTime() >= now) continue;
      updateRoutine(r.id, { nextRunAt: computeNextRun(r.schedule).toISOString() });
    }
  }
  // Same synthetic-runId pattern as deleteEmployee: workspace-level admin
  // actions land in the same trail as tool calls so /audit shows arm/disarm
  // events inline with the work they gated.
  appendAuditEntry({
    runId: `mode-${Date.now()}`,
    employeeId: "workspace",
    employeeName: "Workspace",
    toolName: "setWorkspaceMode",
    bareName: "setWorkspaceMode",
    input: { mode: body.mode },
    verdict: "executed",
  });
  return NextResponse.json(record);
}
