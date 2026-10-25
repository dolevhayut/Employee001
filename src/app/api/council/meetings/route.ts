import { meetingHistory } from "@/lib/meeting-history";

export const runtime = "nodejs";

// GET /api/council/meetings → past Team Meetings, newest activity first:
// id, title, dates, participants, turn count and the stored decision line.
export async function GET() {
  return Response.json({ meetings: await meetingHistory() }, { headers: { "Cache-Control": "no-store" } });
}
