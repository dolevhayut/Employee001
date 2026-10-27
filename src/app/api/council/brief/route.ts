import { buildMeetingBrief } from "@/lib/meeting-memory";

export const runtime = "nodejs";

// POST /api/council/brief { employeeIds } → { brief } | { brief: null }: the
// "Since the last meeting" brief a new meeting with these twins would start
// from. A preview only; the meeting freezes its own copy on the first message.
export async function POST(request: Request) {
  let ids: unknown;
  try {
    ids = ((await request.json()) as { employeeIds?: unknown }).employeeIds;
  } catch {
    // handled below
  }
  const participantIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
  const brief = await buildMeetingBrief({ participantIds });
  return Response.json({ brief: brief ? { text: brief.text, meetings: brief.sources.meetings.length, routines: brief.sources.routines.length } : null }, { headers: { "Cache-Control": "no-store" } });
}
