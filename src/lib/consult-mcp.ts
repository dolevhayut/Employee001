// In-process MCP server exposing twin-to-twin consultation tools to a running
// twin. Pattern mirrors buildOrgBrainMcpServer in org-brain-mcp.ts: pure
// in-process, no external connection. The actual orchestration (depth caps,
// visited-set loop guard, nested runSingleTwin) lives in twin-consult.ts.
//
// Two tools:
//   - consult_twin     → ask another twin for advice; returns their answer.
//   - request_approval → ask another twin to approve/reject an action.
//
// Both are classified `allow` by tool-policy (added to LOCAL_SAFE_TOOLS) so
// they pass the shift-mode canUseTool gate without an approval prompt.

import "server-only";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  consultTwin,
  requestApproval,
  availableTargets,
  type ConsultContext,
} from "@/lib/twin-consult";

function rosterLines(ctx: ConsultContext): string {
  const targets = availableTargets(ctx);
  if (targets.length === 0) return "(no other twins are available to consult right now)";
  return targets.map((e) => `- \`${e.id}\` — ${e.name}, ${e.role}`).join("\n");
}

export function buildConsultMcpServer(ctx: ConsultContext) {
  const roster = rosterLines(ctx);
  const atDepthCap = ctx.depth >= ctx.maxDepth;

  return createSdkMcpServer({
    name: "twin_consult",
    version: "1.0.0",
    tools: [
      tool(
        "consult_twin",
        [
          "Ask ANOTHER digital twin for advice or input, synchronously, mid-task.",
          "Use this when answering well needs a colleague's expertise or perspective — e.g. a designer checking creative direction with the CEO, or anyone validating a call that crosses into another person's domain.",
          "The consulted twin answers in their own voice; their full reply is returned to you as the tool result, then you continue your own work using it.",
          "Don't over-use it: only consult when a colleague's input genuinely changes what you'd do. One focused question per call.",
          atDepthCap
            ? "NOTE: consultation depth limit reached — this call will be refused. Decide with what you have."
            : `Twins you can consult (use the exact id):\n${roster}`,
        ].join("\n"),
        {
          targetEmployeeId: z
            .string()
            .min(1)
            .describe("The exact employee id of the twin to consult (from the list in this tool's description)."),
          question: z
            .string()
            .min(8)
            .max(800)
            .describe("A single, focused question for that twin. Give enough context that they can answer without seeing your task."),
        },
        async ({ targetEmployeeId, question }) => {
          const text = await consultTwin(targetEmployeeId, question, ctx);
          return { content: [{ type: "text" as const, text }] };
        }
      ),
      tool(
        "request_approval",
        [
          "Ask another twin to APPROVE or REJECT an action before you take it.",
          "Use this (instead of consult_twin) when you need a decision/sign-off, not just advice — e.g. publishing content, committing spend, or anything that should clear a manager or the CEO first.",
          "Returns the approver's verdict (approve/reject) plus their reasoning. The decision is also logged to the CEO's inbox so a human can override it later.",
          "If you are NOT approved, do not take the action — note it for the CEO in your ShiftReport instead.",
          atDepthCap
            ? "NOTE: consultation depth limit reached — this call will be refused (treated as not approved)."
            : `Twins you can ask for approval (use the exact id):\n${roster}`,
        ].join("\n"),
        {
          approverEmployeeId: z
            .string()
            .min(1)
            .describe("The exact employee id of the twin whose approval you need (from the list in this tool's description)."),
          what: z
            .string()
            .min(8)
            .max(400)
            .describe("A one-line description of the action you want to take and have approved."),
          context: z
            .string()
            .max(1200)
            .optional()
            .describe("Optional supporting context the approver needs to make the call (the draft, the numbers, the rationale)."),
        },
        async ({ approverEmployeeId, what, context }) => {
          const verdict = await requestApproval(approverEmployeeId, what, context ?? "", ctx);
          const text = `${verdict.approverName}'s decision: ${verdict.decision.toUpperCase()}\n\nReasoning: ${verdict.reason}`;
          return { content: [{ type: "text" as const, text }] };
        }
      ),
    ],
  });
}
