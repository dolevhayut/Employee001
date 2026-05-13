import { NextRequest, NextResponse } from "next/server";
import {
  listAllPendingTasks,
  getTasksFor,
  type TwinTaskStatus,
} from "@/lib/twin-tasks";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const employeeId = url.searchParams.get("employeeId");
  const statusParam = url.searchParams.get("status");

  const status = (statusParam ?? undefined) as TwinTaskStatus | undefined;

  if (employeeId) {
    return NextResponse.json(getTasksFor(employeeId, status));
  }

  if (!status || status === "pending") {
    return NextResponse.json(listAllPendingTasks());
  }

  const all: ReturnType<typeof getTasksFor> = [];
  const fs = await import("fs");
  const path = await import("path");
  const root = path.join(process.cwd(), "data", "employees");
  try {
    const dirs = fs.readdirSync(root, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      all.push(...getTasksFor(d.name, status));
    }
  } catch {
    // no employees dir yet — return empty
  }
  return NextResponse.json(all);
}
