import { NextRequest } from "next/server";
import { getMeeting } from "@/lib/meeting-store";

/**
 * Export a council meeting transcript as a Markdown file.
 *
 * GET /api/council/export?meetingId=mtg_...&download=1
 *   - Returns the rendered transcript as `text/markdown`.
 *   - When `download=1` is set, sends a `Content-Disposition: attachment`
 *     header so the browser triggers a file download (council-<id>.md).
 *   - Returns 404 if the meeting id is unknown (in-memory store; meetings
 *     do not persist across server restarts).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const meetingId = url.searchParams.get("meetingId");
  const download = url.searchParams.get("download") === "1";

  if (!meetingId) {
    return new Response(
      JSON.stringify({ error: "meetingId is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const meeting = getMeeting(meetingId);
  if (!meeting) {
    return new Response(
      JSON.stringify({ error: "meeting not found (in-memory store; restarts wipe state)" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const created = new Date(meeting.createdAt).toISOString();
  const participants = meeting.participantIds.join(", ");

  const lines: string[] = [];
  lines.push(`# Council meeting — \`${meeting.id}\``);
  lines.push("");
  lines.push(`- Created: ${created}`);
  lines.push(`- Participants: ${participants || "(none)"}`);
  lines.push(`- Turns: ${meeting.transcript.length}`);
  if (meeting.sharedFiles.length > 0) {
    lines.push(`- Shared files: ${meeting.sharedFiles.length}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const turn of meeting.transcript) {
    const ts = new Date(turn.ts).toISOString();
    if (turn.kind === "ceo") {
      lines.push(`## CEO — ${ts}`);
      lines.push("");
      lines.push(turn.text);
    } else {
      const tag = turn.delegatedFromName
        ? ` _(called in by ${turn.delegatedFromName})_`
        : "";
      lines.push(`## ${turn.employeeName}${tag} — ${ts}`);
      lines.push("");
      lines.push(turn.text);
    }
    lines.push("");
  }

  if (meeting.sharedFiles.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Shared files");
    lines.push("");
    for (const file of meeting.sharedFiles) {
      lines.push(
        `- \`${file.filename}\` (${file.contentType}, ${file.sizeBytes} bytes) — shared by ${file.sharedByName}: ${file.summary}`
      );
    }
    lines.push("");
  }

  const body = lines.join("\n");
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="council-${meeting.id}.md"`;
  }
  return new Response(body, { status: 200, headers });
}
