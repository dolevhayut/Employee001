import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import type { TwinTraceEvent } from "@/lib/ex-graph-types";
import { getMarketplaceAgent } from "@/lib/marketplace";
import { runSingleTwin } from "@/lib/council-runner";
import type { CouncilEvent, ConversationTurn } from "@/lib/council-runner";
import type { EmployeeWithTwin } from "@/lib/employees";

/**
 * Trial chat for marketplace agents — lets a CEO talk to an agent before
 * committing to hire. Materializes the agent's profile files under a hidden
 * `.trial-<id>` employee directory (skipped by loadEmployeesFromDisk because
 * it starts with `.`) and reuses runSingleTwin for streaming.
 */
function trialEmployeeId(agentId: string): string {
  return `.trial-${agentId}`;
}

function ensureTrialProfile(agentId: string): string {
  const agent = getMarketplaceAgent(agentId);
  if (!agent) throw new Error(`Unknown marketplace agent: ${agentId}`);

  const trialId = trialEmployeeId(agentId);
  const dir = path.join(process.cwd(), "data", "employees", trialId);
  fs.mkdirSync(dir, { recursive: true });

  for (const [filename, content] of Object.entries(agent.profileFiles)) {
    const target = path.join(dir, filename);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, content, "utf-8");
    }
  }

  return trialId;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    agentId?: string;
    question?: string;
    history?: ConversationTurn[];
    sessionId?: string;
  };

  const agentId = body.agentId;
  const question = body.question?.trim() ?? "";

  if (!agentId) {
    return new Response(JSON.stringify({ error: "agentId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const agent = getMarketplaceAgent(agentId);
  if (!agent) {
    return new Response(JSON.stringify({ error: "marketplace agent not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!process.env.AZURE_OPENAI_ENDPOINT) {
    return new Response(
      JSON.stringify({ error: "AZURE_OPENAI_ENDPOINT is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const trialId = ensureTrialProfile(agentId);

  const employee: EmployeeWithTwin = {
    id: trialId,
    name: agent.name,
    firstName: agent.firstName,
    role: agent.role,
    department: agent.department,
    initials: agent.initials,
    avatarColor: agent.avatarColor,
    integrations: agent.suggestedToolkits,
    twinStatus: "ready",
    twinConfidence: 0.85,
    profileFilesComplete: Object.keys(agent.profileFiles).length,
    questionsThisWeek: 0,
    seedModel: "claude-sonnet-4-6",
    refreshModel: "claude-sonnet-4-6",
    ttsVoiceId: "EXAVITQu4vr4xnSDxMaL",
    skills: agent.skills.map((s) => ({
      id: s.toLowerCase().replace(/\s+/g, "-"),
      label: s,
    })),
    orgSkillIds: [],
    consent: {
      grantedAt: new Date().toISOString(),
      version: "1.0",
      scopes: [],
    },
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const start = Date.now();
      const send = (event: TwinTraceEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* closed */
        }
      };

      const onEvent = (evt: CouncilEvent) => {
        const ts = Date.now() - start;
        switch (evt.type) {
          case "text_delta":
            send({ type: "text_delta", delta: evt.delta, ts });
            break;
          case "session_started":
            send({ type: "session", sessionId: evt.sessionId, ts });
            break;
          case "employee_done":
            send({ type: "done", confidence: evt.confidence, cited_files: [], ts });
            break;
          case "employee_error":
            send({ type: "done", confidence: 0, cited_files: [], ts });
            break;
          default:
            break;
        }
      };

      try {
        const useResume =
          typeof body.sessionId === "string" && body.sessionId.length > 0;
        await runSingleTwin(
          employee,
          question,
          onEvent,
          useResume ? [] : body.history ?? [],
          { resumeSessionId: useResume ? body.sessionId : undefined }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        send({
          type: "tool_result",
          name: "error",
          summary: msg,
          files: [],
          ts: Date.now() - start,
        });
        send({ type: "done", confidence: 0, cited_files: [], ts: Date.now() - start });
      } finally {
        try {
          controller.close();
        } catch {
          /* closed */
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
