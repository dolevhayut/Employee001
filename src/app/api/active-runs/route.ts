import { NextRequest, NextResponse } from "next/server";
import { listActiveRuns, type RunSurface } from "@/lib/active-runs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const employeeId = url.searchParams.get("employeeId") || undefined;
  const surface = (url.searchParams.get("surface") as RunSurface | null) || undefined;
  const includeRecent = url.searchParams.get("includeRecent") === "1";
  const items = listActiveRuns({ employeeId, surface, includeRecent });
  return NextResponse.json(items);
}
