import { NextRequest } from "next/server";
import { getMarketplaceAgent } from "@/lib/marketplace";
import { hireAgent, getHiredAgentIds } from "@/lib/hired-agents";
import type { AgentPlacement } from "@/lib/agent-placement";

type HireRequestBody = {
  agentId?: string;
  placement?: Partial<AgentPlacement>;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validatePlacement(
  placement: Partial<AgentPlacement> | undefined
): AgentPlacement | { error: string } {
  if (!placement) {
    return { error: "placement required" };
  }

  if (
    placement.employmentKind !== "team_member" &&
    placement.employmentKind !== "external_consultant"
  ) {
    return { error: "employmentKind must be team_member or external_consultant" };
  }

  if (!placement.responsibleEmployeeId?.trim()) {
    return { error: "responsibleEmployeeId required" };
  }

  if (!placement.responsibleEmployeeName?.trim()) {
    return { error: "responsibleEmployeeName required" };
  }

  if (!placement.teamName?.trim()) {
    return { error: "teamName required" };
  }

  return {
    employmentKind: placement.employmentKind,
    responsibleEmployeeId: placement.responsibleEmployeeId.trim(),
    responsibleEmployeeName: placement.responsibleEmployeeName.trim(),
    teamName: placement.teamName.trim(),
    teammateIds: asStringArray(placement.teammateIds),
    teammateNames: asStringArray(placement.teammateNames),
    engagementNote: placement.engagementNote?.trim() || undefined,
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HireRequestBody;
  if (!body.agentId) {
    return Response.json({ error: "agentId required" }, { status: 400 });
  }

  const agent = getMarketplaceAgent(body.agentId);
  if (!agent) {
    return Response.json({ error: "agent not found" }, { status: 404 });
  }

  if (getHiredAgentIds().includes(agent.id)) {
    return Response.json({ error: "agent already hired" }, { status: 409 });
  }

  const placement = validatePlacement(body.placement);
  if ("error" in placement) {
    return Response.json({ error: placement.error }, { status: 400 });
  }

  const record = hireAgent(agent, placement);
  return Response.json({ success: true, record }, { status: 201 });
}
