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
    schedule?: Schedule;
    enabled?: boolean;
  };

  if (!body.employeeId || !body.task?.trim() || !body.name?.trim() || !body.schedule) {
    return NextResponse.json(
      { error: "employeeId, name, task and schedule are required" },
      { status: 400 }
    );
  }

  const r = createRoutine({
    employeeId: body.employeeId,
    name: body.name.trim(),
    task: body.task.trim(),
    schedule: body.schedule,
    enabled: body.enabled ?? true,
  });

  return NextResponse.json(r);
}
