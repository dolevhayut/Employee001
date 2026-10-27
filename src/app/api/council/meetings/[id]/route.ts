import { appendAuditEntry } from "@/lib/audit-log";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { meetingDetail } from "@/lib/meeting-history";
import { deleteMeeting, getMeeting, setMeetingForget } from "@/lib/meeting-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "meeting not found" }, { status: 404 });

// GET /api/council/meetings/<id> → the full meeting: transcript, shared
// files, participants and the stored summary (or null).
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) return notFound();
  return Response.json(await meetingDetail(meeting), { headers: { "Cache-Control": "no-store" } });
}

// DELETE /api/council/meetings/<id> (admin) → removes the record and its
// shared files from disk.
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  if (!deleteMeeting(id)) return notFound();
  const me = sessionUserFromHeaders(request.headers);
  appendAuditEntry({
    runId: `meeting-delete-${Date.now()}`,
    employeeId: "system",
    employeeName: "system",
    toolName: "deleteMeeting",
    bareName: "deleteMeeting",
    input: { meetingId: id },
    verdict: "executed",
    approvedBy: me?.id ?? "local",
    approvalChannel: "ui",
  });
  return Response.json({ ok: true });
}

// PATCH /api/council/meetings/<id> { forget: boolean } → "Don't remember":
// the meeting gets no digest and stays out of every later brief.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  let forget: unknown;
  try {
    forget = ((await request.json()) as { forget?: unknown }).forget;
  } catch {
    // handled below
  }
  if (typeof forget !== "boolean") return Response.json({ error: "forget must be true or false" }, { status: 400 });
  // Anyone who can open a meeting can keep it out of memory; only an admin can
  // bring a meeting someone else kept out back in. Without accounts there is
  // no session and the local owner decides.
  const me = sessionUserFromHeaders(request.headers);
  if (!forget && me && me.role !== "owner" && me.role !== "admin") {
    return Response.json({ error: "Only an admin can turn memory back on for a meeting." }, { status: 403 });
  }
  const meeting = setMeetingForget(id, forget);
  if (!meeting) return notFound();
  appendAuditEntry({
    runId: `meeting-forget-${Date.now()}`,
    employeeId: "system",
    employeeName: "system",
    toolName: "meeting.forget",
    bareName: "meeting.forget",
    input: { meetingId: id, forget },
    verdict: "executed",
    approvedBy: me?.id ?? "local",
    approvalChannel: "ui",
  });
  return Response.json(await meetingDetail(meeting), { headers: { "Cache-Control": "no-store" } });
}
