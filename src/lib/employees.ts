import type { AgentPlacement } from "./agent-placement";

export type Employee = {
  id: string;
  name: string;
  firstName: string;
  role: string;
  department: string;
  initials: string;
  avatarColor: string;
  integrations: string[];
};

// Real employees are populated at runtime in data/employees/. This empty
// constant exists so legacy imports keep type-checking; treat it as the
// "no demo content" placeholder.
export const EMPLOYEES: Employee[] = [];

export type TwinStatus = "ready" | "building" | "pending";

export type ClaudeModel =
  | "claude-opus-4-8"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export const CLAUDE_MODELS: {
  id: ClaudeModel;
  label: string;
  sub: string;
  seedCostMultiplier: number;
  refreshCostMultiplier: number;
}[] = [
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    sub: "Highest quality — best for complex reasoning & nuanced profiles",
    seedCostMultiplier: 1.0,
    refreshCostMultiplier: 1.0,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    sub: "Balanced — recommended for most employees",
    seedCostMultiplier: 0.38,
    refreshCostMultiplier: 0.38,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    sub: "Fastest & cheapest — good for high-volume or junior roles",
    seedCostMultiplier: 0.12,
    refreshCostMultiplier: 0.12,
  },
];

export type EmployeeSkill = { id: string; label: string };
export type OrgSkill = { id: string; label: string };

export const ORG_SKILLS: OrgSkill[] = [
  { id: "hiring", label: "Hiring Process" },
  { id: "brand", label: "Brand Voice" },
  { id: "policy", label: "Company Policy" },
  { id: "roadmap", label: "Product Roadmap" },
  { id: "budget", label: "Budget Approval" },
];

export type ConsentScope =
  | "data-collection"
  | "integrations"
  | "third-party-actions"
  | "transcripts";

export type EmployeeConsent = {
  /** ISO timestamp when the employee granted consent */
  grantedAt: string;
  /** Version of the consent terms accepted */
  version: string;
  /** Scopes the employee opted into */
  scopes: ConsentScope[];
};

export const CURRENT_CONSENT_VERSION = "1.0";

export const CONSENT_SCOPES: { id: ConsentScope; label: string; desc: string; required: boolean }[] = [
  {
    id: "data-collection",
    label: "Train a digital twin on my work data",
    desc: "Messages, documents, and work artifacts I produce can be indexed to model my voice and expertise.",
    required: true,
  },
  {
    id: "integrations",
    label: "Read from my connected tools",
    desc: "Slack, Gmail, GitHub, Linear and other tools I explicitly connect become source material.",
    required: true,
  },
  {
    id: "third-party-actions",
    label: "Let the twin act on my behalf",
    desc: "Twin can post messages, comment on issues, or send emails — only inside guardrails I review.",
    required: false,
  },
  {
    id: "transcripts",
    label: "Include meeting transcripts",
    desc: "Zoom, Meet, and Teams call transcripts I attended can be used to refine voice and decisions.",
    required: false,
  },
];

export type LineageSource = {
  /** Composio toolkit slug — used for icon + display name */
  toolkit: string;
  /** What kind of artifact (Slack messages, PRs, etc.) — human-readable */
  itemType: string;
  /** How many items were indexed */
  count: number;
  /** Approximate token contribution to the model */
  tokens: number;
  /** ISO date — earliest item ingested */
  fromDate: string;
  /** ISO date — most recent item ingested */
  toDate: string;
  /** ISO date — last successful sync */
  lastSyncAt: string;
};

export type TwinLineage = {
  /** Sum of tokens across all sources — for headline stat */
  totalTokens: number;
  /** Most-recent sync timestamp across all sources */
  lastSyncAt: string;
  /** Per-source breakdown */
  sources: LineageSource[];
};

// ─── ElevenLabs voice catalogue ──────────────────────────────────────────────

export type VoiceGender = "male" | "female";

export type ElevenLabsVoice = {
  id: string;
  name: string;
  gender: VoiceGender;
  description: string;
};

export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",   gender: "male",   description: "Authoritative, professional" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George",   gender: "male",   description: "Narrative, warm" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",    gender: "female", description: "Soft, clear" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", gender: "female", description: "Conversational, friendly" },
];

export const ELEVENLABS_VOICE_STORAGE_KEY = "twin.ttsVoices";

// ─── Employee twin type ───────────────────────────────────────────────────────

export type EmployeeWithTwin = Employee & {
  twinStatus: TwinStatus;
  /** 0–1 — only meaningful when status==="ready" */
  twinConfidence: number;
  /** count of profile files that exist (0..12) */
  profileFilesComplete: number;
  /** ISO date — last time the twin was queried (omit for pending) */
  lastActiveAt?: string;
  /** Number of questions answered this week */
  questionsThisWeek: number;
  skills: EmployeeSkill[];
  /** IDs from ORG_SKILLS this employee is authoritative on */
  orgSkillIds: string[];
  /** Employee consent record. Required before any data is ingested. */
  consent?: EmployeeConsent;
  /** What data fed the twin — data lineage. */
  lineage?: TwinLineage;
  /** Model used for the one-time 180-day seed */
  seedModel: ClaudeModel;
  /** Model used for ongoing weekly refreshes */
  refreshModel: ClaudeModel;
  /** ElevenLabs voice ID — default based on gender, overridable per-twin */
  ttsVoiceId: string;
  /** Marketplace placement metadata for hired agents. */
  placement?: AgentPlacement;
};

// Real employees are added by the CEO at runtime — see /onboarding.
// No baked-in demo personas; pre-built marketplace agents serve as starter
// content when needed.


// In-memory roster. Always empty in the public build — the source of truth
// is data/employees/ on disk, surfaced via loadEmployeesFromDisk() / GET
// /api/employees. Components that import this constant render an empty
// state on first paint and hydrate from the API.
export const EMPLOYEES_WITH_TWIN: EmployeeWithTwin[] = [];

export function getEmployee(id: string): EmployeeWithTwin | undefined {
  return EMPLOYEES_WITH_TWIN.find((e) => e.id === id);
}

// The server-only disk loader lives in employees-disk.ts so client bundles
// never see `fs`. Import it from there in API route handlers only.
