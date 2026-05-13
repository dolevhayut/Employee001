import { EMPLOYEES, type Employee } from "./demo";
import type { AgentPlacement } from "./agent-placement";

export type { Employee } from "./demo";
export { EMPLOYEES } from "./demo";

export type TwinStatus = "ready" | "building" | "pending";

export type ClaudeModel =
  | "claude-opus-4-7"
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
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
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

const dolevHayut = EMPLOYEES.find((e) => e.id === "dolev-hayut")!;
const noaLevi = EMPLOYEES.find((e) => e.id === "noa-levi")!;
const danaShapira = EMPLOYEES.find((e) => e.id === "dana-shapira")!;
const liorBenDavid = EMPLOYEES.find((e) => e.id === "lior-ben-david")!;
const tamarDvir = EMPLOYEES.find((e) => e.id === "tamar-dvir")!;

// The full demo set — Dolev, Noa, Dana, Lior, Tamar, Amir, plus a marketplace
// hire. These are real fictional personas used for the marketing demo and dev.
// In a real install they should NOT appear: a fresh CEO opens the app and
// adds their own employees. The `EMPLOYEE001_DEMO` env var controls this:
//   unset/false  → empty workspace (production default)
//   true         → load the demo personas (used for dev, marketing, screencasts)
const DEMO_TWINS: EmployeeWithTwin[] = [
  {
    ...dolevHayut,
    twinStatus: "ready",
    twinConfidence: 0.93,
    profileFilesComplete: 9,
    lastActiveAt: "2026-04-28T09:15:00.000Z",
    questionsThisWeek: 31,
    seedModel: "claude-opus-4-7",
    refreshModel: "claude-opus-4-7",
    ttsVoiceId: "onwK4e9ZLuTAKqWW03F9", // Daniel — male, authoritative
    skills: [
      { id: "distributed-systems", label: "Distributed Systems" },
      { id: "infrastructure", label: "Infrastructure" },
      { id: "team-scaling", label: "Team Scaling" },
      { id: "security", label: "Security" },
    ],
    orgSkillIds: ["hiring", "roadmap", "policy"],
    consent: {
      grantedAt: "2026-03-12T14:22:00.000Z",
      version: "1.0",
      scopes: ["data-collection", "integrations", "third-party-actions", "transcripts"],
    },
    lineage: {
      totalTokens: 1_842_000,
      lastSyncAt: "2026-04-29T03:14:00.000Z",
      sources: [
        {
          toolkit: "slack",
          itemType: "messages",
          count: 4231,
          tokens: 612_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-28T23:00:00.000Z",
          lastSyncAt: "2026-04-29T03:14:00.000Z",
        },
        {
          toolkit: "github",
          itemType: "PR reviews",
          count: 89,
          tokens: 384_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-25T17:30:00.000Z",
          lastSyncAt: "2026-04-29T03:11:00.000Z",
        },
        {
          toolkit: "linear",
          itemType: "issue comments",
          count: 312,
          tokens: 198_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-27T11:00:00.000Z",
          lastSyncAt: "2026-04-29T03:08:00.000Z",
        },
        {
          toolkit: "googlemeet",
          itemType: "meeting transcripts",
          count: 47,
          tokens: 521_000,
          fromDate: "2025-08-12T00:00:00.000Z",
          toDate: "2026-04-26T16:00:00.000Z",
          lastSyncAt: "2026-04-29T03:05:00.000Z",
        },
        {
          toolkit: "gmail",
          itemType: "sent emails",
          count: 218,
          tokens: 127_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-28T19:00:00.000Z",
          lastSyncAt: "2026-04-29T03:02:00.000Z",
        },
      ],
    },
  },
  {
    ...noaLevi,
    twinStatus: "ready",
    twinConfidence: 0.92,
    profileFilesComplete: 9,
    lastActiveAt: "2026-04-28T11:40:00.000Z",
    questionsThisWeek: 28,
    seedModel: "claude-opus-4-7",
    refreshModel: "claude-sonnet-4-6",
    ttsVoiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah — female, soft
    skills: [
      { id: "product-strategy", label: "Product Strategy" },
      { id: "user-research", label: "User Research" },
      { id: "activation", label: "Activation & Retention" },
      { id: "enterprise-product", label: "Enterprise Product" },
    ],
    orgSkillIds: ["roadmap", "brand"],
    consent: {
      grantedAt: "2026-03-15T09:48:00.000Z",
      version: "1.0",
      scopes: ["data-collection", "integrations", "third-party-actions"],
    },
    lineage: {
      totalTokens: 1_104_000,
      lastSyncAt: "2026-04-29T03:18:00.000Z",
      sources: [
        {
          toolkit: "slack",
          itemType: "messages",
          count: 3892,
          tokens: 488_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-28T22:00:00.000Z",
          lastSyncAt: "2026-04-29T03:18:00.000Z",
        },
        {
          toolkit: "linear",
          itemType: "specs and issues",
          count: 156,
          tokens: 312_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-26T14:00:00.000Z",
          lastSyncAt: "2026-04-29T03:15:00.000Z",
        },
        {
          toolkit: "gmail",
          itemType: "sent emails",
          count: 341,
          tokens: 204_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-28T20:00:00.000Z",
          lastSyncAt: "2026-04-29T03:12:00.000Z",
        },
        {
          toolkit: "notion",
          itemType: "PRDs and notes",
          count: 62,
          tokens: 100_000,
          fromDate: "2025-05-01T00:00:00.000Z",
          toDate: "2026-04-22T10:00:00.000Z",
          lastSyncAt: "2026-04-29T03:09:00.000Z",
        },
      ],
    },
  },
  {
    ...danaShapira,
    twinStatus: "ready",
    twinConfidence: 0.91,
    profileFilesComplete: 9,
    lastActiveAt: "2026-04-28T10:55:00.000Z",
    questionsThisWeek: 19,
    seedModel: "claude-opus-4-7",
    refreshModel: "claude-haiku-4-5",
    ttsVoiceId: "XB0fDUnXU5powFXDhCwa", // Charlotte — female, conversational
    skills: [
      { id: "plg", label: "PLG Strategy" },
      { id: "growth-analytics", label: "Growth Analytics" },
      { id: "experimentation", label: "Experimentation" },
      { id: "content-seo", label: "Content & SEO" },
    ],
    orgSkillIds: ["brand", "roadmap"],
    consent: {
      grantedAt: "2026-03-22T16:05:00.000Z",
      version: "1.0",
      scopes: ["data-collection", "integrations", "transcripts"],
    },
    lineage: {
      totalTokens: 798_000,
      lastSyncAt: "2026-04-29T03:22:00.000Z",
      sources: [
        {
          toolkit: "slack",
          itemType: "messages",
          count: 2614,
          tokens: 322_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-28T21:00:00.000Z",
          lastSyncAt: "2026-04-29T03:22:00.000Z",
        },
        {
          toolkit: "googlemeet",
          itemType: "meeting transcripts",
          count: 31,
          tokens: 281_000,
          fromDate: "2025-09-04T00:00:00.000Z",
          toDate: "2026-04-25T15:00:00.000Z",
          lastSyncAt: "2026-04-29T03:19:00.000Z",
        },
        {
          toolkit: "hubspot",
          itemType: "campaign briefs",
          count: 41,
          tokens: 119_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-20T10:00:00.000Z",
          lastSyncAt: "2026-04-29T03:16:00.000Z",
        },
        {
          toolkit: "gmail",
          itemType: "sent emails",
          count: 174,
          tokens: 76_000,
          fromDate: "2025-04-01T00:00:00.000Z",
          toDate: "2026-04-28T18:00:00.000Z",
          lastSyncAt: "2026-04-29T03:13:00.000Z",
        },
      ],
    },
  },
  {
    ...liorBenDavid,
    twinStatus: "ready",
    twinConfidence: 0.88,
    profileFilesComplete: 9,
    lastActiveAt: "2026-05-05T10:30:00.000Z",
    questionsThisWeek: 14,
    seedModel: "claude-sonnet-4-6",
    refreshModel: "claude-sonnet-4-6",
    ttsVoiceId: "JBFqnCBsd6RMkjVDRZzb", // George — male, warm
    skills: [
      { id: "node-typescript", label: "Node.js / TypeScript" },
      { id: "sqlite-db", label: "SQLite & Database Design" },
      { id: "api-design", label: "REST API Design" },
      { id: "agent-infra", label: "Agent Infrastructure" },
    ],
    orgSkillIds: ["policy"],
    consent: {
      grantedAt: "2026-01-10T11:00:00.000Z",
      version: "1.0",
      scopes: ["data-collection", "integrations", "third-party-actions"],
    },
    lineage: {
      totalTokens: 620_000,
      lastSyncAt: "2026-05-05T03:00:00.000Z",
      sources: [
        {
          toolkit: "github",
          itemType: "commits & PR reviews",
          count: 218,
          tokens: 340_000,
          fromDate: "2025-12-01T00:00:00.000Z",
          toDate: "2026-05-04T23:00:00.000Z",
          lastSyncAt: "2026-05-05T03:00:00.000Z",
        },
        {
          toolkit: "slack",
          itemType: "messages",
          count: 1840,
          tokens: 210_000,
          fromDate: "2025-12-01T00:00:00.000Z",
          toDate: "2026-05-04T22:00:00.000Z",
          lastSyncAt: "2026-05-05T02:58:00.000Z",
        },
        {
          toolkit: "linear",
          itemType: "issue comments",
          count: 124,
          tokens: 70_000,
          fromDate: "2025-12-01T00:00:00.000Z",
          toDate: "2026-05-03T14:00:00.000Z",
          lastSyncAt: "2026-05-05T02:55:00.000Z",
        },
      ],
    },
  },
  {
    ...tamarDvir,
    twinStatus: "ready",
    twinConfidence: 0.87,
    profileFilesComplete: 9,
    lastActiveAt: "2026-05-05T09:45:00.000Z",
    questionsThisWeek: 11,
    seedModel: "claude-sonnet-4-6",
    refreshModel: "claude-sonnet-4-6",
    ttsVoiceId: "XB0fDUnXU5powFXDhCwa", // Charlotte — female, conversational
    skills: [
      { id: "react-nextjs", label: "React / Next.js" },
      { id: "css-design-systems", label: "CSS & Design Systems" },
      { id: "ai-ui-patterns", label: "AI Product UI" },
      { id: "typescript-fe", label: "TypeScript (Frontend)" },
    ],
    orgSkillIds: ["brand"],
    consent: {
      grantedAt: "2026-01-15T09:30:00.000Z",
      version: "1.0",
      scopes: ["data-collection", "integrations", "transcripts"],
    },
    lineage: {
      totalTokens: 540_000,
      lastSyncAt: "2026-05-05T03:05:00.000Z",
      sources: [
        {
          toolkit: "github",
          itemType: "commits & PR reviews",
          count: 192,
          tokens: 290_000,
          fromDate: "2025-12-15T00:00:00.000Z",
          toDate: "2026-05-04T22:00:00.000Z",
          lastSyncAt: "2026-05-05T03:05:00.000Z",
        },
        {
          toolkit: "slack",
          itemType: "messages",
          count: 1620,
          tokens: 180_000,
          fromDate: "2025-12-15T00:00:00.000Z",
          toDate: "2026-05-04T21:00:00.000Z",
          lastSyncAt: "2026-05-05T03:02:00.000Z",
        },
        {
          toolkit: "linear",
          itemType: "issue comments",
          count: 98,
          tokens: 70_000,
          fromDate: "2025-12-15T00:00:00.000Z",
          toDate: "2026-05-03T12:00:00.000Z",
          lastSyncAt: "2026-05-05T02:59:00.000Z",
        },
      ],
    },
  },
];

export const EMPLOYEES_WITH_TWIN: EmployeeWithTwin[] =
  process.env.EMPLOYEE001_DEMO === "true" ? DEMO_TWINS : [];

export function getEmployee(id: string): EmployeeWithTwin | undefined {
  return EMPLOYEES_WITH_TWIN.find((e) => e.id === id);
}
