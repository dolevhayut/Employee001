import { goalChain } from "@/lib/goals";
import { listPendingApprovals } from "@/lib/approval-bus";
import { readEmployeeFile } from "@/lib/employees-files";
import type { Playbook } from "./types";

export type PlaybookInputs = Record<string, string>;
export type PlaybookParticipant = { id: string; name: string };

const DECISION_CONTEXT_LIMIT = 4 * 1024;
const DECISION_SECTION_LIMIT = 10;

function recentDecisionSections(employeeId: string): string[] {
  const decisions = readEmployeeFile(employeeId, "DECISIONS.md");
  const sections = decisions
    .split(/(?=^#{1,6}\s)/m)
    .map((section) => section.trim())
    .filter(Boolean)
    .slice(-DECISION_SECTION_LIMIT);
  const text = sections.join("\n\n");

  if (text.length <= DECISION_CONTEXT_LIMIT) return sections;

  return [text.slice(-DECISION_CONTEXT_LIMIT)];
}

export function buildPlaybookContext(
  playbook: Playbook,
  inputs: PlaybookInputs,
  participants: PlaybookParticipant[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const context of playbook.context) {
    if (context === "goal_chain") {
      const goalId = Object.entries(inputs).find(
        ([key]) =>
          playbook.inputs.find((input) => input.key === key)?.kind === "goal",
      )?.[1];
      result.goal_chain = goalId ? goalChain(goalId) : [];
    } else if (context === "pending_approvals") {
      result.pending_approvals = listPendingApprovals().map((approval) => ({
        employeeName: approval.employeeName ?? approval.employeeId,
        toolName: approval.toolName,
        reason: approval.reason,
      }));
    } else if (context === "recent_decisions") {
      result.recent_decisions = participants.map((participant) => ({
        employeeName: participant.name,
        decisions: recentDecisionSections(participant.id),
      }));
    } else if (context === "week_digest") {
      result.week_digest = {
        note: "Week digest is supplied by E-126.",
        week: Object.values(inputs).find(Boolean) ?? null,
      };
    }
  }
  return result;
}
export function renderPlaybookPrompt(
  playbook: Playbook,
  inputs: PlaybookInputs,
  context: Record<string, unknown>,
): string {
  const rendered = playbook.prompt
    .replace(
      /{{inputs\.([a-zA-Z0-9_]+)}}/g,
      (_m, key: string) => inputs[key] ?? "",
    )
    .replace(/{{context\.([a-zA-Z0-9_]+)}}/g, (_m, key: string) =>
      JSON.stringify(context[key] ?? null),
    );
  return `${rendered}\n\nReturn ONLY valid JSON matching the ${playbook.outputSchema} output schema.`;
}
