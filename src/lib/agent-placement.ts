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

// The responsible-employee fields are intentionally empty here. Callers that
// render a placement form should populate them from the current workspace's
// employee list, and gate any "confirm" CTA on responsibleEmployeeId being set.
export const DEFAULT_AGENT_PLACEMENT: AgentPlacement = {
  employmentKind: "external_consultant",
  responsibleEmployeeId: "",
  responsibleEmployeeName: "",
  teamName: "General",
  teammateIds: [],
  teammateNames: [],
};

