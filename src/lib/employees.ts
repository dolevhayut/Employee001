import type { AgentPlacement } from "./agent-placement";

export type Employee = {
  id: string;
  name: string;
  /** Optional Hebrew spelling of the name (employee.json `nameHe`), used so
   *  Hebrew twin replies spell colleagues' names correctly. */
  nameHe?: string;
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
  | "claude-sonnet-5-5"
  | "claude-haiku-4-5"
  | "claude-opus-5-5"
  | "claude-fable-5-1"
  // Legacy ids — kept valid so employee JSON created before the Claude 5.5
  // upgrade continues to type-check and load.
  | "claude-opus-5"
  | "claude-sonnet-5"
  | "claude-opus-4-8"
  | "claude-sonnet-4-6"
  | "claude-sonnet-4-5";

// Cost multipliers are relative to Claude Opus 5 ($5/MTok input) = 1.0.
export const CLAUDE_MODELS: {
  id: ClaudeModel;
  label: string;
  sub: string;
  seedCostMultiplier: number;
  refreshCostMultiplier: number;
}[] = [
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    sub: "Balanced — recommended for most employees",
    seedCostMultiplier: 0.25,
    refreshCostMultiplier: 0.25,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    sub: "Fastest & cheapest — good for high-volume or junior roles",
    seedCostMultiplier: 0.12,
    refreshCostMultiplier: 0.12,
  },
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    sub: "Highest quality — best for complex reasoning & nuanced profiles",
    seedCostMultiplier: 0.8,
    refreshCostMultiplier: 0.8,
  },
  {
    id: "claude-fable-5-1",
    label: "Fable 5.1",
    sub: "Most capable, priced above Opus. For the hardest profiles",
    seedCostMultiplier: 2.0,
    refreshCostMultiplier: 2.0,
  },
  // Legacy ids remain selectable so existing employee settings still render.
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    sub: "Highest quality — best for complex reasoning & nuanced profiles",
    seedCostMultiplier: 1.0,
    refreshCostMultiplier: 1.0,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    sub: "Balanced — recommended for most employees",
    // Sonnet 5 is cheaper than Sonnet 4.6 ($2/$10 vs $3/$15 per MTok), so the
    // estimate drops accordingly (was 0.38 for 4.6).
    seedCostMultiplier: 0.25,
    refreshCostMultiplier: 0.25,
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    sub: "Legacy — retained for existing employee profiles",
    seedCostMultiplier: 1.0,
    refreshCostMultiplier: 1.0,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    sub: "Legacy — retained for existing employee profiles",
    seedCostMultiplier: 0.38,
    refreshCostMultiplier: 0.38,
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    sub: "Legacy — retained for existing employee profiles",
    seedCostMultiplier: 0.38,
    refreshCostMultiplier: 0.38,
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

/** A stock catalogue voice belongs to no one. Any other voice id (a clone, or a
 *  custom voice from the ElevenLabs library) may be a real person's voice. */
export const isStockVoice = (voiceId: string) => ELEVENLABS_VOICES.some((v) => v.id === voiceId);

/** Employee ids come from requests; keep them to a safe directory name. */
export const EMPLOYEE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Consent to use one person's voice for their twin. Bound to the voice id it
 *  was given for; withdrawing it deletes the record (and with it the voice id). */
export type VoiceConsent = {
  voiceId: string;
  grantedAt: string;
  /** sha256 of the consent text shown, so the wording can be proven later. */
  textDigest: string;
  locale: "en";
  /** Recorded by an admin for the person, not by them signed in themself. */
  onBehalf?: boolean;
  ip: string;
  userAgent: string;
};

/** The wording shown before a voice consent is recorded. Its SHA-256 goes into
 *  the record and the audit log; changing a word changes the digest. */
export const VOICE_CONSENT_TEXT = [
  "Use my voice for my twin.",
  "I agree that a cloned or custom voice that sounds like me may be used to read my twin's answers aloud on this workspace.",
  "My voice sample and voice id are processed by ElevenLabs, our text-to-speech provider.",
  "I can withdraw this at any time; withdrawing removes my voice id from this workspace and my twin goes back to the default voice.",
].join("\n");

// ─── Employee twin type ───────────────────────────────────────────────────────

/**
 * Where a twin is in the employee's life at the company (Relay).
 * - active: the person works here; the twin works for them.
 * - handover: the person is leaving; the handover interview is open.
 * - retired: the person has left. The twin stays so colleagues can keep
 *   asking it, but it only answers from what it knows: no tools, no actions,
 *   no new memory.
 */
export type TwinLifecycle = "active" | "handover" | "retired";

/** The departing employee's consent to keep their twin after they leave. */
export type RetentionConsent = {
  grantedAt: string;
  /** sha256 of the consent text shown, so the wording can be proven later. */
  textDigest: string;
  locale: "en" | "he";
  /** Recorded by an admin for the employee (e.g. no accounts, or no account
   *  for them), not by the employee signed in themself. */
  onBehalf?: boolean;
};

/** The role as people should see it: "Former <role>" once the person left. */
export function displayRole(e: { role: string; lifecycle?: TwinLifecycle }): string {
  return e.lifecycle === "retired" ? `Former ${e.role}` : e.role;
}

export type EmployeeWithTwin = Employee & {
  /** Missing means "active" (records written before Relay). */
  lifecycle?: TwinLifecycle;
  /** ISO timestamp the twin was retired. */
  retiredAt?: string;
  retention?: RetentionConsent;
  /** Recorded consent to use a cloned or custom voice for this person. */
  voiceConsent?: VoiceConsent;
  /** Per-twin unattended Slack policy. Off unless the CEO explicitly enables it. */
  answerSlackWithoutAsking?: boolean;
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
  /** Synthetic demo-fixture twin (not a person): consent doesn't apply. */
  synthetic?: boolean;
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
