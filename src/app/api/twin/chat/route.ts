import { NextRequest } from "next/server";
import type { TwinTraceEvent } from "@/lib/ex-graph-types";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { getHiredEmployees } from "@/lib/hired-agents";
import { hasEmployeeFiles } from "@/lib/employees-files";
import { runSingleTwin } from "@/lib/council-runner";
import type { CouncilEvent, ConversationTurn } from "@/lib/council-runner";
import { bumpActivityOnDisk } from "@/lib/employees-disk";
import { generateFollowups } from "@/lib/followup-suggestions";

const PROFILE_FILE_NAMES = [
  "EXPERTISE.md", "DECISIONS.md", "CONTEXT.md", "PEOPLE.md",
  "PROJECTS.md", "PREFERENCES.md", "TONE.md", "BOUNDARIES.md", "EMPLOYMENT.md",
] as const;

// Keyword → file heuristic for detecting which files the answer drew from
const FILE_KEYWORDS: [string[], string][] = [
  [["expertise", "technical", "engineer", "architect", "stack", "infra", "backend", "frontend", "skill"], "EXPERTISE.md"],
  [["decided", "decision", "chose", "tradeoff", "trade-off", "rationale"], "DECISIONS.md"],
  [["employee001", "company", "startup", "product", "ai", "twin", "context", "customers"], "CONTEXT.md"],
  [["noa", "shira", "maya", "ido", "dana", "dolev", "defer", "teammate", "people", "team"], "PEOPLE.md"],
  [["project", "initiative", "roadmap", "shipping", "build", "quarter"], "PROJECTS.md"],
  [["prefer", "preference", "i like", "way i work", "tend to"], "PREFERENCES.md"],
  [["voice", "tone", "style", "how i communicate", "i speak"], "TONE.md"],
  [["boundary", "won't", "hard no", "escalate", "legal", "compliance", "compensation", "equity", "salary"], "BOUNDARIES.md"],
  [["hired", "employ", "role", "title", "joined", "comp", "tenure"], "EMPLOYMENT.md"],
];

function detectCitedFiles(text: string): string[] {
  const lower = text.toLowerCase();
  return FILE_KEYWORDS
    .filter(([keywords]) => keywords.some((k) => lower.includes(k)))
    .map(([, file]) => file);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    question?: string;
    employeeId?: string;
    history?: ConversationTurn[];
    sessionId?: string;
  };

  const question = body.question?.trim() ?? "";

  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const employeeId = body.employeeId;
  const fromDisk = await loadEmployeesFromDisk();
  const roster = [
    ...fromDisk,
    ...getHiredEmployees().filter((h) => !fromDisk.some((e) => e.id === h.id)),
  ];
  const employee =
    (employeeId
      ? roster.find((e) => e.id === employeeId)
      : undefined) ??
    roster.find(
      (e) => e.twinStatus === "ready" && hasEmployeeFiles(e.id)
    );

  if (!employee || !hasEmployeeFiles(employee.id)) {
    return new Response(
      JSON.stringify({ error: "no twin with profile files available" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const start = Date.now();

      const send = (event: TwinTraceEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // stream already closed
        }
      };

      // Accumulate response text so we can detect citations after the fact
      let responseText = "";

      // Stagger synthetic "Read" events across all pre-loaded profile files.
      // The council runner pre-loads all files into the prompt (no runtime Read calls),
      // so we emit these to drive the memory-graph glow animation while the model thinks.
      let readingIdx = 0;
      const emitNextReading = () => {
        if (readingIdx >= PROFILE_FILE_NAMES.length) return;
        const file = PROFILE_FILE_NAMES[readingIdx++];
        send({ type: "tool_call", name: "Read", args: { file_path: `/profile/${file}` }, ts: Date.now() - start });
        setTimeout(emitNextReading, 220);
      };
      setTimeout(emitNextReading, 0);

      // Map CouncilEvent → TwinTraceEvent SSE
      const onEvent = (evt: CouncilEvent) => {
        const ts = Date.now() - start;

        switch (evt.type) {
          case "org_skill_recall":
            send({
              type: "skill_recall",
              skills: evt.skills,
              ts,
            });
            break;
          case "org_brain_recall":
            send({
              type: "brain_recall",
              nodes: evt.nodes,
              ts,
            });
            break;
          case "tool_use": {
            // If the model actually does call Read (e.g. for external files), pass it through.
            send({ type: "tool_call", name: evt.tool, args: evt.input as Record<string, unknown>, ts });
            break;
          }
          case "subagent_spawn": {
            // Surface as a synthetic tool_call with a special name the UI can
            // recognise ("subagent:web-researcher"). Carries the description
            // so the chat shows what the subagent was asked to research.
            send({
              type: "tool_call",
              name: `subagent:${evt.subagentType}`,
              args: { description: evt.description, label: evt.label },
              ts,
            });
            break;
          }
          case "tool_result":
            send({ type: "tool_result", name: "result", summary: "ok", files: [], ts });
            break;
          case "text_delta":
            responseText += evt.delta;
            send({ type: "text_delta", delta: evt.delta, ts });
            break;
          case "tool_approval_request":
            send({
              type: "tool_approval_request",
              approvalId: evt.approvalId,
              tool: evt.tool,
              label: evt.label,
              input: evt.input,
              reason: evt.reason,
              ts,
            });
            break;
          case "tool_approval_resolved":
            send({
              type: "tool_approval_resolved",
              approvalId: evt.approvalId,
              decision: evt.decision,
              ts,
            });
            break;
          case "clarification_request":
            send({
              type: "clarification_request",
              approvalId: evt.approvalId,
              questions: evt.questions,
              ts,
            });
            break;
          case "clarification_resolved":
            send({
              type: "clarification_resolved",
              approvalId: evt.approvalId,
              ts,
            });
            break;
          case "tool_blocked":
            send({ type: "tool_blocked", tool: evt.tool, reason: evt.reason, ts });
            break;
          case "scratch_write_denied":
            send({ type: "scratch_write_denied", reason: evt.reason, ts });
            break;
          case "artifact":
            send({
              type: "artifact",
              artifactId: evt.artifactId,
              payload: evt.payload,
              ts,
            });
            break;
          case "session_started":
            send({ type: "session", sessionId: evt.sessionId, ts });
            break;
          case "employee_done": {
            // Detect which files the answer drew from by scanning the response text.
            const citedFiles = detectCitedFiles(responseText);
            for (const f of citedFiles) send({ type: "cite", file: f, ts });
            send({
              type: "done",
              confidence: evt.confidence,
              cited_files: citedFiles,
              ts,
            });
            break;
          }
          case "employee_error":
            send({ type: "done", confidence: 0, cited_files: [], ts });
            break;
          default:
            break;
        }
      };

      // Fire-and-forget: increment question counter for this employee.
      bumpActivityOnDisk(employee.id);

      try {
        // When the client has a sessionId from a prior turn, prefer SDK
        // session resumption — drop the manual history forwarding so we don't
        // double-feed the model. First turn (no sessionId) falls back to the
        // legacy history path so single-shot callers still work.
        const useResume = typeof body.sessionId === "string" && body.sessionId.length > 0;
        await runSingleTwin(
          employee,
          question,
          onEvent,
          useResume ? [] : body.history ?? [],
          { resumeSessionId: useResume ? body.sessionId : undefined }
        );

        // After the main answer finished streaming, emit 3 follow-up
        // suggestions for the CEO to click. Skip when:
        //  - The answer was empty (tool-only run) — no anchor to suggest from.
        //  - The twin ended its own reply with a question. In that case the
        //    CEO should answer the question naturally, not click a chip that
        //    silently abandons the conversational beat. Detection: scan the
        //    last ~300 chars of the trimmed body for a "?". Catches "…shall
        //    we do A or B?" patterns even when the model trails off with an
        //    emoji or a soft sign-off after the question mark.
        const trimmed = responseText.trim();
        const tail = trimmed.slice(-300);
        const twinAskedAQuestion = tail.includes("?") || tail.includes("؟");
        if (trimmed.length > 0 && !twinAskedAQuestion) {
          const suggestions = await generateFollowups({
            question,
            answer: responseText,
            employeeName: employee.name,
            employeeRole: employee.role,
          });
          if (suggestions.length > 0) {
            send({
              type: "followup_suggestions",
              suggestions,
              ts: Date.now() - start,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        send({ type: "tool_result", name: "error", summary: msg, files: [], ts: Date.now() - start });
        send({ type: "done", confidence: 0, cited_files: [], ts: Date.now() - start });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
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
