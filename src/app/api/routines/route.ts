import { NextRequest, NextResponse } from "next/server";
import { listRoutines, createRoutine, type Schedule } from "@/lib/routines";
import { ensureSchedulerStarted } from "@/lib/routine-scheduler";

export async function GET() {
  ensureSchedulerStarted();
  const routines = listRoutines().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return NextResponse.json(routines, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  ensureSchedulerStarted();
  const body = (await req.json()) as {
    employeeId?: string;
    name?: string;
    task?: string;
    kind?: "task" | "shift";
    schedule?: Schedule;
    enabled?: boolean;
  };

  // Shift routines are autonomous — the twin reads its shift state and
  // picks its own action, so a task prompt isn't required (and the modal
  // doesn't surface a Task field when Shift is selected). Only enforce
  // task presence for kind === "task".
  const kind = body.kind === "shift" ? "shift" : "task";
  if (
    !body.employeeId ||
    !body.name?.trim() ||
    !body.schedule ||
    (kind === "task" && !body.task?.trim())
  ) {
    return NextResponse.json(
      {
        error:
          kind === "shift"
            ? "employeeId, name and schedule are required"
            : "employeeId, name, task and schedule are required",
      },
      { status: 400 }
    );
  }

  const r = createRoutine({
    employeeId: body.employeeId,
    name: body.name.trim(),
    // Stored as empty string for shift — Routine.task is non-optional in
    // the type. The scheduler branches on `kind` before using `task`.
    task: kind === "task" ? body.task!.trim() : "",
    kind,
    schedule: body.schedule,
    enabled: body.enabled ?? true,
  });

  return NextResponse.json(r);
}
