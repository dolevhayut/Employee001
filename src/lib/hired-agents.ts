import fs from "fs";
import path from "path";
import type { EmployeeWithTwin } from "./employees";
import {
  DEFAULT_AGENT_PLACEMENT,
  type AgentPlacement,
} from "./agent-placement";
import {
  MARKETPLACE_AGENTS,
  getMarketplaceAgent,
  type MarketplaceAgent,
} from "./marketplace";

const HIRED_AGENTS_PATH = path.join(process.cwd(), "data", "hired-agents.json");
const EMPLOYEES_DATA_DIR = path.join(process.cwd(), "data", "employees");

export type HiredAgentRecord = {
  id: string;
  marketplaceAgentId: string;
  hiredAt: string;
  placement: AgentPlacement;
};

function readHiredRecords(): HiredAgentRecord[] {
  try {
    const raw = fs.readFileSync(HIRED_AGENTS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HiredAgentRecord>[];
    return parsed
      .filter((record): record is Partial<HiredAgentRecord> & { id: string; marketplaceAgentId?: string; hiredAt?: string } =>
        typeof record.id === "string"
      )
      .map((record) => normalizeHiredRecord(record));
  } catch {
    return [];
  }
}

function normalizePlacement(
  placement: Partial<AgentPlacement> | undefined,
  agent?: MarketplaceAgent
): AgentPlacement {
  const defaultPlacement = {
    ...DEFAULT_AGENT_PLACEMENT,
    teamName: agent?.department ?? DEFAULT_AGENT_PLACEMENT.teamName,
  };

  return {
    employmentKind:
      placement?.employmentKind === "team_member" ||
      placement?.employmentKind === "external_consultant"
        ? placement.employmentKind
        : defaultPlacement.employmentKind,
    responsibleEmployeeId:
      placement?.responsibleEmployeeId || defaultPlacement.responsibleEmployeeId,
    responsibleEmployeeName:
      placement?.responsibleEmployeeName || defaultPlacement.responsibleEmployeeName,
    teamName: placement?.teamName || defaultPlacement.teamName,
    teammateIds: Array.isArray(placement?.teammateIds) ? placement.teammateIds : [],
    teammateNames: Array.isArray(placement?.teammateNames) ? placement.teammateNames : [],
    engagementNote: placement?.engagementNote?.trim() || undefined,
  };
}

function normalizeHiredRecord(
  record: Partial<HiredAgentRecord> & { id: string }
): HiredAgentRecord {
  const agent = getMarketplaceAgent(record.marketplaceAgentId ?? record.id);
  return {
    id: record.id,
    marketplaceAgentId: record.marketplaceAgentId ?? record.id,
    hiredAt: record.hiredAt ?? new Date(0).toISOString(),
    placement: normalizePlacement(record.placement, agent),
  };
}

function writeHiredRecords(records: HiredAgentRecord[]): void {
  fs.mkdirSync(path.dirname(HIRED_AGENTS_PATH), { recursive: true });
  fs.writeFileSync(HIRED_AGENTS_PATH, JSON.stringify(records, null, 2), "utf-8");
}

function formatPlacementBlock(placement: AgentPlacement): string {
  const kindLabel =
    placement.employmentKind === "external_consultant"
      ? "External consultant"
      : "Team member";
  const teammates =
    placement.teammateNames.length > 0
      ? placement.teammateNames.join(", ")
      : "No named teammates yet";

  return [
    "## Team placement",
    `- Employment kind: ${kindLabel}`,
    `- Responsible owner: ${placement.responsibleEmployeeName} (${placement.responsibleEmployeeId})`,
    `- Team: ${placement.teamName}`,
    `- Teammates: ${teammates}`,
    placement.engagementNote ? `- Engagement note: ${placement.engagementNote}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function withPlacementContext(
  filename: string,
  content: string,
  placement: AgentPlacement
): string {
  if (filename !== "EMPLOYMENT.md" && filename !== "PEOPLE.md") {
    return content;
  }

  const placementBlock = formatPlacementBlock(placement);
  const normalizedContent = content.replace(/\s+$/, "");
  if (normalizedContent.includes("## Team placement")) {
    return normalizedContent.replace(
      /## Team placement[\s\S]*$/,
      placementBlock
    ) + "\n";
  }

  return `${normalizedContent}\n\n${placementBlock}\n`;
}

/** Persist a newly hired agent and write its profile files to disk. */
export function hireAgent(
  agent: MarketplaceAgent,
  placement: AgentPlacement
): HiredAgentRecord {
  const normalizedPlacement = normalizePlacement(placement, agent);
  const record: HiredAgentRecord = {
    id: agent.id,
    marketplaceAgentId: agent.id,
    hiredAt: new Date().toISOString(),
    placement: normalizedPlacement,
  };

  const dir = path.join(EMPLOYEES_DATA_DIR, agent.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(agent.profileFiles)) {
    fs.writeFileSync(
      path.join(dir, filename),
      withPlacementContext(filename, content, normalizedPlacement),
      "utf-8"
    );
  }

  const records = readHiredRecords().filter((r) => r.id !== agent.id);
  records.push(record);
  writeHiredRecords(records);

  return record;
}

/** Remove a hired agent's record and profile files. */
export function dismissAgent(agentId: string): boolean {
  const records = readHiredRecords();
  const idx = records.findIndex((r) => r.id === agentId);
  if (idx === -1) return false;

  const dir = path.join(EMPLOYEES_DATA_DIR, agentId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }

  records.splice(idx, 1);
  writeHiredRecords(records);
  return true;
}

export function getHiredAgentIds(): string[] {
  return readHiredRecords().map((r) => r.id);
}

function marketplaceAgentToEmployee(
  agent: MarketplaceAgent,
  hiredAt: string,
  placement: AgentPlacement
): EmployeeWithTwin {
  return {
    id: agent.id,
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
    lastActiveAt: hiredAt,
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
      grantedAt: hiredAt,
      version: "1.0",
      scopes: ["data-collection", "integrations"],
    },
    placement,
  };
}

export function getHiredEmployees(): EmployeeWithTwin[] {
  const records = readHiredRecords();
  const out: EmployeeWithTwin[] = [];
  for (const rec of records) {
    const agent = MARKETPLACE_AGENTS.find((a) => a.id === rec.id);
    if (agent) out.push(marketplaceAgentToEmployee(agent, rec.hiredAt, rec.placement));
  }
  return out;
}
