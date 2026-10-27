import { NextRequest } from "next/server";
import { sessionUserFromHeaders } from "@/lib/auth/request-user";
import { runCouncil } from "@/lib/council-runner";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { createDemoReplayResponse } from "@/lib/demo-replay";
import { canRunModel, modelErrorMessage } from "@/lib/model-provider";
import { pickTwins } from "@/lib/org-ask";

export async function POST(request: NextRequest) {
  // Demo replay is explicit, never inferred from missing credentials. This keeps
  // the default demo free while `employee001 demo --live` stays genuinely live.
  if (process.env.EMPLOYEE001_DEMO === "1" && process.env.EMPLOYEE001_DEMO_LIVE !== "1") {
    return createDemoReplayResponse(request.signal);
  }

  const body = await request.json() as {
    question?: string;
    employeeIds?: string[];
    /** Stable across CEO messages in the same meeting. Server treats unknown
     *  ids as "start a new meeting" and returns the new id in a `meeting`
     *  SSE event for the client to persist. */
    meetingId?: string;
    /** Let the relevant twins answer: the org router picks 1–3 of employeeIds. */
    auto?: boolean;
    /** New meeting only: skip the "Since the last meeting" brief. */
    fresh?: boolean;
    /** New meeting only: keep this meeting out of later briefs. */
    forget?: boolean;
  };

  const question = body.question?.trim();
  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const requestedIds = body.employeeIds ?? [];
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  let employees = roster.filter(
    (e) =>
      e.twinStatus === "ready" &&
      requestedIds.includes(e.id) &&
      hasEmployeeFiles(e.id)
  );

  if (employees.length === 0) {
    return new Response(JSON.stringify({ error: "no ready employees found" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // All ready employees available for delegation (even if not in the active session)
  const allParticipants = roster.filter(
    (e) => e.twinStatus === "ready" && hasEmployeeFiles(e.id)
  );

  const modelRun = canRunModel();
  if (!modelRun.ok) {
    return new Response(
      JSON.stringify({ error: modelRun.reason }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller may be closed
        }
      };

      try {
        // "Relevant" mode: only the twins who know answer; the rest can be @tagged in.
        if (body.auto && employees.length > 1) {
          const { picks } = await pickTwins(question, employees);
          const chosen = picks.map((p) => employees.find((e) => e.id === p.id)).filter((e): e is (typeof employees)[number] => Boolean(e));
          if (chosen.length) {
            employees = chosen;
            send({ type: "routed", picks: picks.map((p) => ({ id: p.id, matched: p.matched })) });
          }
        }
        const result = await runCouncil({
          responders: employees,
          question,
          meetingId: body.meetingId,
          allParticipants,
          onEvent: (event) => send(event.type === "employee_error" ? { ...event, message: modelErrorMessage(event.message) } : event),
          requesterId: sessionUserFromHeaders(request.headers)?.id,
          fresh: body.fresh === true,
          forget: body.forget === true,
        });
        // Echo the resolved meeting id so the client can persist it across
        // CEO messages — same id on a new meeting, unchanged on followups.
        send({ type: "meeting", meetingId: result.meetingId });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
