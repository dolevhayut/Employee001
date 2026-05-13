import { NextRequest, NextResponse } from "next/server";
import { getActiveRun } from "@/lib/active-runs";
import { readLogTail } from "@/lib/run-logs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const url = new URL(req.url);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
  const limitBytes = Math.min(
    1_048_576,
    Math.max(1024, parseInt(url.searchParams.get("limitBytes") || "65536", 10) || 65536)
  );

  const run = getActiveRun(id);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const result = readLogTail(run.surface, id, offset, limitBytes);

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === result.etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: result.etag },
    });
  }

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      ETag: result.etag,
      "X-Log-Size": String(result.size),
    },
  });
}
