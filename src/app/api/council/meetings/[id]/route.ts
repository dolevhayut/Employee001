import { appendAuditEntry } from "@/lib/audit-log";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { meetingDetail } from "@/lib/meeting-history";
import { deleteMeeting, getMeeting } from "@/lib/meeting-store";

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
