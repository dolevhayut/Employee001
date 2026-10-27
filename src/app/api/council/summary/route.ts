import { NextRequest } from "next/server";
import { getMeeting, setMeetingSummary } from "@/lib/meeting-store";
import { lastDiscussion, lastDiscussionStart, summarizeMeeting } from "@/lib/meeting-summary";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";

// POST /api/council/summary { meetingId } → { decision, actions[], open[], generatedAt, throughTurn }
// for the discussion since the CEO's last question. The result is stored on
// the meeting, so meeting history shows it.
export async function POST(req: NextRequest) {
  let meetingId = "";
  try {
    meetingId = String(((await req.json()) as { meetingId?: unknown }).meetingId ?? "");
  } catch {
    // fall through to the 404
  }
  const meeting = meetingId ? getMeeting(meetingId) : undefined;
  if (!meeting) return Response.json({ error: "meeting not found" }, { status: 404 });

  const fromDisk = await loadEmployeesFromDisk();
  const roster = [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))];
  const turns = lastDiscussion(meeting.transcript);
  const spoke = new Set(turns.flatMap((t) => (t.kind === "twin" ? [t.employeeId] : [])));
  const people = roster.filter((e) => spoke.has(e.id)).map((e) => ({ id: e.id, name: e.firstName, role: e.role }));

  const summary = await summarizeMeeting(turns, people, lastDiscussionStart(meeting.transcript));
  if (!summary) return Response.json({ error: "could not summarize" }, { status: 500 });
  const stored = setMeetingSummary(meeting.id, summary);
  return Response.json(stored ?? summary, { headers: { "Cache-Control": "no-store" } });
}
