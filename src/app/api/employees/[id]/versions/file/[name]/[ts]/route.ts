import { NextRequest } from "next/server";
import { readFileVersion } from "@/lib/twin-versions";
import { TWIN_FILE_NAMES, type TwinFileName } from "@/lib/twin-builder-types";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; name: string; ts: string }> }
) {
  const { id, name, ts } = await context.params;
  if (!(TWIN_FILE_NAMES as readonly string[]).includes(name)) {
    return Response.json({ error: "invalid filename" }, { status: 400 });
  }
  const body = readFileVersion(id, name as TwinFileName, ts);
  if (body === null) {
    return Response.json({ error: "version not found" }, { status: 404 });
  }
  return Response.json(
    { filename: name, ts, body },
    { headers: { "Cache-Control": "no-store" } }
  );
}
