// Grades a built twin profile against CompanySim ground truth. One model call
// per person, through relayTurn (no tools, the workspace's model provider).

import { relayTurn } from "@/lib/relay/model";
import { TWIN_MODEL_PRIMARY } from "@/lib/sdk-defaults";
import { parseJson } from "../relay/agents";

export type FactVerdict = { id: string; captured: "yes" | "partial" | "no"; contradicted: boolean };

export async function judgeProfile(name: string, profile: string, facts: { id: string; text: string }[]): Promise<{ verdicts: FactVerdict[]; inventions: string[] }> {
  const text = await relayTurn({
    employeeId: "eval-judge",
    model: TWIN_MODEL_PRIMARY,
    system: "You are a strict grader. Output only JSON.",
    prompt: `An AI built a profile of ${name} by reading their email, Slack, Jira and files. The profile:
"""
${profile}
"""

For each true fact below: "yes" = the profile states the key detail; "partial" = the topic is there but a key detail (name, status, role, customer) is missing; "no" = absent. "contradicted" = the profile states something that conflicts with the fact.

Then list up to 5 specific claims in the profile about ${name}'s role, projects, customers or colleagues that none of the facts support and that look invented (not general style or tone notes).

Facts:
${facts.map((f) => `- [${f.id}] ${f.text}`).join("\n")}

JSON: {"verdicts":[{"id":"...","captured":"yes|partial|no","contradicted":false}],"inventions":["..."]}`,
  });
  return parseJson<{ verdicts: FactVerdict[]; inventions: string[] }>(text);
}
