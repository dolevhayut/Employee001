import { NextRequest } from "next/server";
import { listFileVersions } from "@/lib/twin-versions";
import { TWIN_FILE_NAMES, type TwinFileName } from "@/lib/twin-builder-types";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await context.params;
  if (!(TWIN_FILE_NAMES as readonly string[]).includes(name)) {
    return Response.json({ error: "invalid filename" }, { status: 400 });
  }
  const versions = listFileVersions(id, name as TwinFileName);
  return Response.json(
    { versions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
