import { NextRequest, NextResponse } from "next/server";
import { listShiftArchives } from "@/lib/shift-archive";

export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get("employeeId") ?? undefined;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10) || 50)) : 50;
  const manifests = listShiftArchives({ employeeId, limit });
  return NextResponse.json(manifests);
}
