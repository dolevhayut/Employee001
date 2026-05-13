export type AgentEmploymentKind = "team_member" | "external_consultant";

export type AgentPlacement = {
  employmentKind: AgentEmploymentKind;
  responsibleEmployeeId: string;
  responsibleEmployeeName: string;
  teamName: string;
  teammateIds: string[];
  teammateNames: string[];
  engagementNote?: string;
};

export const DEFAULT_AGENT_PLACEMENT: AgentPlacement = {
  employmentKind: "external_consultant",
  responsibleEmployeeId: "dolev-hayut",
  responsibleEmployeeName: "Dolev Hayut",
  teamName: "General",
  teammateIds: [],
  teammateNames: [],
};

