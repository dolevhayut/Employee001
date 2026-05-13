import { NextRequest } from "next/server";
import { runCouncil } from "@/lib/council-runner";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
import { hasEmployeeFiles } from "@/lib/employees-files";

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    question?: string;
    employeeIds?: string[];
    /** Stable across CEO messages in the same meeting. Server treats unknown
     *  ids as "start a new meeting" and returns the new id in a `meeting`
     *  SSE event for the client to persist. */
    meetingId?: string;
  };

  const question = body.question?.trim();
  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const requestedIds = body.employeeIds ?? [];
  const employees = EMPLOYEES_WITH_TWIN.filter(
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
  const allParticipants = EMPLOYEES_WITH_TWIN.filter(
    (e) => e.twinStatus === "ready" && hasEmployeeFiles(e.id)
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
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
        const result = await runCouncil({
          responders: employees,
          question,
          meetingId: body.meetingId,
          allParticipants,
          onEvent: send,
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
