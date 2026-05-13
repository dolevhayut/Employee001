import { NextRequest } from "next/server";
import { getActiveBuild } from "@/lib/twin-versions";

export const runtime = "nodejs";

/** Cheap status probe — used by `/twin-build` on mount and by polling banners. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ employeeId: string }> }
) {
  const { employeeId } = await context.params;
  const active = getActiveBuild(employeeId);
  return Response.json(
    { active },
    { headers: { "Cache-Control": "no-store" } }
  );
}
