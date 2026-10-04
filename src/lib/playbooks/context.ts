import { goalChain } from "@/lib/goals";
import { listPendingApprovals } from "@/lib/approval-bus";
import { readAuditLog } from "@/lib/audit-log";
import type { Playbook } from "./types";

export type PlaybookInputs = Record<string, string>;
export function buildPlaybookContext(playbook: Playbook, inputs: PlaybookInputs): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const context of playbook.context) {
    if (context === "goal_chain") {
      const goalId = Object.entries(inputs).find(([key]) => playbook.inputs.find((input) => input.key === key)?.kind === "goal")?.[1];
      result.goal_chain = goalId ? goalChain(goalId) : [];
    } else if (context === "pending_approvals") result.pending_approvals = listPendingApprovals();
    else if (context === "recent_decisions") result.recent_decisions = readAuditLog({ pageSize: 20 }).entries;
    else if (context === "week_digest") result.week_digest = { note: "Week digest is supplied by E-126.", week: Object.values(inputs).find(Boolean) ?? null };
  }
  return result;
}
export function renderPlaybookPrompt(playbook: Playbook, inputs: PlaybookInputs, context: Record<string, unknown>): string {
  const rendered = playbook.prompt.replace(/{{inputs\.([a-zA-Z0-9_]+)}}/g, (_m, key: string) => inputs[key] ?? "").replace(/{{context\.([a-zA-Z0-9_]+)}}/g, (_m, key: string) => JSON.stringify(context[key] ?? null));
  return `${rendered}\n\nReturn ONLY valid JSON matching the ${playbook.outputSchema} output schema.`;
}
