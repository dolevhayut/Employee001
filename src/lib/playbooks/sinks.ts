import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/app-home";
import { appendFeedItem } from "@/lib/feed-store";
import { registerApproval } from "@/lib/approval-bus";
import { updateGoal, type UpdateGoalInput } from "@/lib/goals";
import { addProposals, proposalsEnabled } from "@/lib/knowledge-proposals";
import type { Playbook, PlaybookOutput } from "./types";
import type { PlaybookInputs, PlaybookParticipant } from "./context";

export type SinkResult = {
  sink: string;
  approvalId?: string;
  path?: string;
  status?: "applied" | "requested" | "skipped";
  reason?: string;
};

function outputMarkdown(playbook: Playbook, output: PlaybookOutput): string {
  return `## ${playbook.name}\n\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``;
}

function goalIdFor(
  playbook: Playbook,
  inputs: PlaybookInputs,
): string | undefined {
  const goalInput = playbook.inputs.find((input) => input.kind === "goal");
  return goalInput ? inputs[goalInput.key] : undefined;
}

function isGoalPatch(value: unknown): value is UpdateGoalInput {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function applyPlaybookSinks(
  playbook: Playbook,
  output: PlaybookOutput,
  runId: string,
  inputs: PlaybookInputs = {},
  participants: PlaybookParticipant[] = [],
): Promise<SinkResult[]> {
  const detail = JSON.stringify(output);
  const results: SinkResult[] = [];

  for (const sink of playbook.sinks) {
    if (sink === "feed") {
      appendFeedItem({
        source: { kind: "shift", employeeId: "playbook", runId },
        type: "update",
        title: playbook.name,
        detail,
      });
      results.push({ sink, status: "applied" });
      continue;
    }

    if (sink === "scratch_doc") {
      const target = dataDir("scratch", "playbooks", `${runId}.json`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, detail + "\n", "utf8");
      results.push({ sink, path: target, status: "applied" });
      continue;
    }

    if (sink === "knowledge_proposal") {
      if (!proposalsEnabled()) {
        results.push({
          sink,
          status: "skipped",
          reason: "knowledge proposals are disabled",
        });
        continue;
      }

      const proposal = {
        file: "team-meeting-decisions.md",
        markdown: outputMarkdown(playbook, output),
        reason: `Playbook output from ${playbook.name}`,
      };
      await Promise.all(
        participants.map((participant) =>
          addProposals(participant.id, runId, [proposal]),
        ),
      );
      results.push({ sink, status: "applied" });
      continue;
    }

    const goalId =
      sink === "goal_update" ? goalIdFor(playbook, inputs) : undefined;
    const approval = registerApproval({
      runId,
      employeeId: "playbook",
      employeeName: "Playbook engine",
      toolName: `playbook_${sink}`,
      bareName: sink,
      input: {
        playbookId: playbook.id,
        ...(goalId ? { goalId, patch: output } : { output }),
      },
      reason: `${playbook.name} proposes a ${sink.replace(/_/g, " ")}`,
      surface: "background",
    });
    if (sink === "goal_update" && goalId) {
      // Approval resolves later; deliberately do not await this in the request.
      void approval.promise
        .then(async (decision) => {
          if (decision.action !== "allow") return;
          const input = decision.updatedInput ?? {};
          const approvedGoalId =
            typeof input.goalId === "string" ? input.goalId : goalId;
          const patch = isGoalPatch(input.patch) ? input.patch : output;
          await updateGoal(approvedGoalId, patch as UpdateGoalInput);
        })
        .catch(() => {
          // A failed approved write must not create an unhandled rejection.
        });
    }

    // Generic approvals intentionally only record a request; approving one
    // does not execute an action because the sink has no action contract.
    results.push({
      sink,
      approvalId: approval.approvalId,
      status: "requested",
    });
  }

  return results;
}
