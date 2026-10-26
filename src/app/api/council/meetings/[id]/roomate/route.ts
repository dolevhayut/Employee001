import { appendAuditEntry } from "@/lib/audit-log";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { listCustomMcp } from "@/lib/custom-mcp";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { getHiredEmployees } from "@/lib/hired-agents";
import {
  getMeeting,
  markActionSent,
  recordActionTaskId,
  releaseActionSent,
  type ActionSendResult,
} from "@/lib/meeting-store";
import {
  buildFilingPrompt,
  extractTaskId,
  meetingPeople,
  resolveActionOwner,
  roomateAvailable,
  type MeetingPerson,
} from "@/lib/roomate-filing";
import { isRetiredSync } from "@/lib/twin-lifecycle";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type Body = {
  /** start: claim the action and get the twin run to start; done: record
   *  what the run said; failed: the run never started, undo the claim. */
  phase?: unknown;
  index?: unknown;
  /** The action text the caller saw, so a re-summarized meeting can't shift it. */
  action?: unknown;
  /** start: who files it, when the action's owner can't be used. */
  ownerId?: unknown;
  /** start: send again although it was sent before. */
  force?: unknown;
  /** done: the owner twin's reply text. */
  reply?: unknown;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function refused(result: Extract<ActionSendResult, { ok: false }>) {
  if (result.error === "already_sent") {
    return json({ error: "already_sent", message: "This action was already sent to Roomate.", summary: result.summary }, 409);
  }
  if (result.error === "changed") {
    return json({ error: "changed", message: "The meeting summary changed. Reopen the meeting and try again.", summary: result.summary }, 409);
  }
  return json({ error: "not_found", message: "That action isn't in the meeting's summary." }, 404);
}

// POST /api/council/meetings/<id>/roomate
//   { phase: "start", index, action, ownerId?, force? } → { employeeId, prompt, summary }
//   { phase: "done", index, action, reply }               → { taskId, summary }
//   { phase: "failed", index, action }                    → { summary }
//
// "Send to Roomate" never calls Roomate from here: the client starts a normal
// twin run (/api/twin/chat) for the action's owner with the returned prompt,
// so the twin's Roomate skill, tool policy ("ask" for create_tasks), the
// approvals flow, audit and the read scope all apply unchanged. This route
// only resolves the owner, guards against double sends and records the result.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const index = Number(body.index);
  const actionText = typeof body.action === "string" ? body.action : "";
  if (!Number.isInteger(index) || index < 0 || !actionText) return json({ error: "invalid_body" }, 400);

  const meeting = getMeeting(id);
  if (!meeting) return json({ error: "meeting not found" }, 404);

  if (body.phase === "done") {
    const reply = typeof body.reply === "string" ? body.reply.slice(0, 50_000) : "";
    const taskId = extractTaskId(reply);
    if (!taskId) {
      const current = meeting.summary?.actions[index];
      if (!current || current.action !== actionText) return json({ error: "not_found" }, 404);
      return json({ taskId: null, summary: meeting.summary });
    }
    const result = recordActionTaskId(meeting.id, index, actionText, taskId);
    return result.ok ? json({ taskId, summary: result.summary }) : refused(result);
  }

  if (body.phase === "failed") {
    const result = releaseActionSent(meeting.id, index, actionText);
    return result.ok ? json({ summary: result.summary }) : refused(result);
  }

  if (body.phase !== "start") return json({ error: "invalid_body" }, 400);

  if (!roomateAvailable(await listCustomMcp())) {
    return json({ error: "unavailable", message: "Roomate isn't connected. Add an enabled custom MCP server named Roomate in Connections." }, 409);
  }

  const action = meeting.summary?.actions[index];
  if (!action) return json({ error: "not_found", message: "That action isn't in the meeting's summary." }, 404);
  if (action.action !== actionText) {
    return json({ error: "changed", message: "The meeting summary changed. Reopen the meeting and try again.", summary: meeting.summary }, 409);
  }

  const fromDisk = await loadEmployeesFromDisk();
  const roster = [...fromDisk, ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id))];
  const byId = new Map(roster.map((e) => [e.id, e]));
  const retired = (eid: string) => byId.get(eid)?.lifecycle === "retired" || isRetiredSync(eid);
  const people: MeetingPerson[] = meetingPeople(
    meeting.participantIds.map((pid) => ({ id: pid, name: byId.get(pid)?.firstName ?? pid })),
    meeting.transcript,
  )
    .filter((p) => byId.has(p.id))
    .map((p) => ({ id: p.id, name: byId.get(p.id)!.firstName || p.name }));
  // Who can be picked instead: people in this meeting whose twin can run tools.
  const pickable = people.filter((p) => !retired(p.id) && hasEmployeeFiles(p.id));

  const requested = typeof body.ownerId === "string" && body.ownerId ? body.ownerId : null;
  const ownerId = requested
    ? people.some((p) => p.id === requested)
      ? requested
      : null
    : resolveActionOwner(action.employeeId, people);
  if (!ownerId) {
    return json(
      {
        error: "pick_owner",
        message: requested ? "Pick someone who was in this meeting." : "This action has no owner in the meeting. Pick who files it.",
        people: pickable,
      },
      422,
    );
  }
  const owner = byId.get(ownerId)!;
  if (retired(ownerId)) {
    return json(
      {
        error: "retired",
        message: `${owner.firstName} has left. Their twin is read-only and can't file to Roomate. Pick who files it instead.`,
        people: pickable,
      },
      409,
    );
  }
  if (!hasEmployeeFiles(ownerId)) {
    return json({ error: "no_twin", message: `${owner.firstName}'s twin isn't ready yet. Pick who files it instead.`, people: pickable }, 409);
  }

  const claimed = markActionSent(meeting.id, index, actionText, { force: body.force === true });
  if (!claimed.ok) return refused(claimed);

  const me = sessionUserFromHeaders(request.headers);
  appendAuditEntry({
    runId: `meeting-roomate-${Date.now()}`,
    employeeId: ownerId,
    employeeName: owner.name,
    toolName: "sendMeetingActionToRoomate",
    bareName: "sendMeetingActionToRoomate",
    input: { meetingId: meeting.id, actionIndex: index, ...(body.force === true ? { again: true } : {}) },
    verdict: "executed",
    approvedBy: me?.id ?? "local",
    approvalChannel: "ui",
  });

  return json({
    employeeId: ownerId,
    prompt: buildFilingPrompt({ meetingId: meeting.id, title: meeting.title, action: action.action, decision: meeting.summary?.decision }),
    summary: claimed.summary,
  });
}
