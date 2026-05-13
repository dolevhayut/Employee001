import { NextRequest } from "next/server";
import { readSharedFileBytes } from "@/lib/meeting-store";

/**
 * Fetch a file shared into a Team Meeting.
 *
 *   GET /api/council/file?meetingId=mtg_...&filename=q1.csv          → JSON metadata + text content
 *   GET /api/council/file?meetingId=mtg_...&filename=mock.png        → raw image bytes (for <img src>)
 *   GET /api/council/file?meetingId=mtg_...&filename=*&download=1    → raw bytes with Content-Disposition: attachment
 *
 * For text files, the default JSON response includes the parsed content
 * as a string field — the drawer renders it in a <pre>. For images, the
 * default response is raw bytes so an <img> tag can hit this URL directly.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const meetingId = url.searchParams.get("meetingId");
  const filename = url.searchParams.get("filename");
  const download = url.searchParams.get("download") === "1";

  if (!meetingId || !filename) {
    return new Response(
      JSON.stringify({ error: "meetingId and filename are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = readSharedFileBytes(meetingId, filename);
  if (!result.found) {
    return new Response(JSON.stringify({ error: "file not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { bytes, entry } = result;
  const isImage = entry.kind === "image";

  // Raw-bytes response: any download=1 request, or any image request
  // (since <img src> can't consume JSON).
  if (download || isImage) {
    const headers: Record<string, string> = {
      "Content-Type": entry.contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    };
    if (download) {
      headers["Content-Disposition"] = `attachment; filename="${entry.filename}"`;
    }
    return new Response(new Uint8Array(bytes), { headers });
  }

  // Text mode default — JSON envelope with the decoded content.
  return new Response(
    JSON.stringify({
      filename: entry.filename,
      summary: entry.summary,
      sharedByName: entry.sharedByName,
      sharedAt: entry.sharedAt,
      sizeBytes: entry.sizeBytes,
      contentType: entry.contentType,
      kind: entry.kind,
      content: bytes.toString("utf8"),
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
