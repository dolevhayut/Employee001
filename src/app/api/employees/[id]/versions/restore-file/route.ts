import { NextRequest } from "next/server";
import { restoreFile } from "@/lib/twin-versions";
import { TWIN_FILE_NAMES, type TwinFileName } from "@/lib/twin-builder-types";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    filename?: string;
    ts?: string;
  };

  if (
    typeof body.filename !== "string" ||
    !(TWIN_FILE_NAMES as readonly string[]).includes(body.filename)
  ) {
    return Response.json(
      { error: "filename must be one of the 9 twin profile files" },
      { status: 400 }
    );
  }
  if (typeof body.ts !== "string" || body.ts.length === 0) {
    return Response.json({ error: "ts is required" }, { status: 400 });
  }

  const result = restoreFile(id, body.filename as TwinFileName, body.ts);
  if (!result.ok) {
    return Response.json({ error: result.error ?? "restore failed" }, { status: 400 });
  }
  return Response.json({ ok: true, restored: body.filename, ts: body.ts });
}
