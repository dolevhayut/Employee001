// Employee001 — shared data: profile files + sample markdown content for the
// generation view.

import type { Frontmatter } from "@/lib/ex-graph-types";

export type ProfileFileStatus = "done" | "running" | "queued";

export type ProfileFile = {
  name: string;
  desc: string;
  tokens: number;
  status: ProfileFileStatus;
  frontmatter: Frontmatter;
};

export const PROFILE_FILES: ProfileFile[] = [
  {
    name: "EXPERTISE.md",
    desc: "Domains the expert is authoritative on",
    tokens: 4218,
    status: "done",
    frontmatter: {
      confidence: 0.92,
      last_updated: "2026-04-22",
      sources: ["linear", "github", "slack"],
      linked_files: ["DECISIONS.md", "BOUNDARIES.md", "CONTEXT.md"],
      tags: ["high-confidence", "stable"],
    },
  },
  {
    name: "TONE.md",
    desc: "Voice, register, characteristic phrases",
    tokens: 2104,
    status: "done",
    frontmatter: {
      confidence: 0.88,
      last_updated: "2026-04-19",
      sources: ["slack", "gmail"],
      linked_files: ["CONTEXT.md", "PEOPLE.md"],
      tags: ["stable"],
    },
  },
  {
    name: "CONTEXT.md",
    desc: "Org chart, team, stakeholders, projects",
    tokens: 3876,
    status: "done",
    frontmatter: {
      confidence: 0.9,
      last_updated: "2026-04-25",
      sources: ["slack", "gmail", "zoom"],
      linked_files: ["PEOPLE.md", "PROJECTS.md", "TONE.md"],
      tags: ["stable", "high-confidence"],
    },
  },
  {
    name: "DECISIONS.md",
    desc: "Past decisions and the reasoning behind them",
    tokens: 5102,
    status: "running",
    frontmatter: {
      confidence: 0.78,
      last_updated: "2026-04-27",
      sources: ["linear", "slack", "github"],
      linked_files: ["BOUNDARIES.md", "PEOPLE.md", "ESCALATION.md", "EXPERTISE.md"],
      tags: ["draft"],
    },
  },
  {
    name: "PREFERENCES.md",
    desc: "Tools, formats, escalation thresholds",
    tokens: 1820,
    status: "running",
    frontmatter: {
      confidence: 0.74,
      last_updated: "2026-04-26",
      sources: ["slack", "linear"],
      linked_files: ["ESCALATION.md", "BOUNDARIES.md", "WORKING_STYLE.md"],
      tags: ["draft"],
    },
  },
  {
    name: "PEOPLE.md",
    desc: "Who the expert defers to and on what",
    tokens: 2987,
    status: "queued",
    frontmatter: {
      confidence: 0.65,
      last_updated: "2026-04-15",
      sources: ["slack", "gmail", "zoom"],
      linked_files: ["CONTEXT.md", "ESCALATION.md", "BOUNDARIES.md"],
      tags: ["draft", "needs-human-review"],
    },
  },
  {
    name: "RECURRING.md",
    desc: "Frequently asked questions and stock answers",
    tokens: 0,
    status: "queued",
    frontmatter: {
      confidence: 0.6,
      last_updated: "2026-04-12",
      sources: ["slack", "gmail"],
      linked_files: ["GLOSSARY.md", "PREFERENCES.md"],
      tags: ["draft"],
    },
  },
  {
    name: "BOUNDARIES.md",
    desc: "What the twin should NEVER answer alone",
    tokens: 0,
    status: "queued",
    frontmatter: {
      confidence: 0.7,
      last_updated: "2026-04-18",
      sources: ["slack", "linear", "gmail"],
      linked_files: ["ESCALATION.md", "PEOPLE.md", "DECISIONS.md"],
      tags: ["draft", "needs-human-review"],
    },
  },
  {
    name: "PROJECTS.md",
    desc: "Active workstreams and their current state",
    tokens: 0,
    status: "queued",
    frontmatter: {
      confidence: 0.62,
      last_updated: "2026-04-20",
      sources: ["linear", "github", "slack"],
      linked_files: ["CONTEXT.md", "DECISIONS.md"],
      tags: ["draft"],
    },
  },
  {
    name: "WORKING_STYLE.md",
    desc: "Hours, async preferences, meeting style",
    tokens: 0,
    status: "queued",
    frontmatter: {
      confidence: 0.68,
      last_updated: "2026-04-14",
      sources: ["slack", "gmail", "zoom"],
      linked_files: ["PREFERENCES.md", "TONE.md"],
      tags: ["draft"],
    },
  },
  {
    name: "GLOSSARY.md",
    desc: "Internal acronyms, codenames, jargon",
    tokens: 0,
    status: "queued",
    frontmatter: {
      confidence: 0.6,
      last_updated: "2026-04-10",
      sources: ["slack", "github"],
      linked_files: ["PROJECTS.md", "RECURRING.md"],
      tags: ["draft"],
    },
  },
  {
    name: "ESCALATION.md",
    desc: "Who to route to when twin lacks confidence",
    tokens: 0,
    status: "queued",
    frontmatter: {
      confidence: 0.72,
      last_updated: "2026-04-21",
      sources: ["slack", "gmail"],
      linked_files: ["PEOPLE.md", "BOUNDARIES.md", "PREFERENCES.md"],
      tags: ["draft", "needs-human-review"],
    },
  },
];

export type ContentLineKind = "h1" | "h2" | "p" | "li" | "q";
export type ContentLine = { t: ContentLineKind; v: string };

export const SAMPLE_CONTENT: Record<string, ContentLine[]> = {
  "DECISIONS.md": [
    { t: "h1", v: "Decision patterns" },
    { t: "p", v: "Maya tends to optimize for activation over acquisition. When the team debates roadmap tradeoffs, she will almost always choose the path that improves week-2 retention even at the cost of new signups." },
    { t: "h2", v: "Heuristics" },
    { t: "li", v: "Prefers reversible decisions. Will ship a flag over a redesign." },
    { t: "li", v: "Asks 'what would we measure in 4 weeks?' before approving any new surface." },
    { t: "li", v: "Defers to design when the disagreement is taste; defers to data when the disagreement is impact. See [[BOUNDARIES.md]] for the hard limits." },
    { t: "h2", v: "Characteristic phrases" },
    { t: "q", v: "Let's pick the smallest version we'd actually be willing to defend in review." },
    { t: "q", v: "What does this look like at 10x the volume?" },
    { t: "h2", v: "Worked examples" },
    { t: "p", v: "Q3 onboarding redesign — chose to keep the existing flow and instrument it instead of redesigning. Data showed the dropoff was concentrated at step 3, not the broader funnel." },
    { t: "p", v: "When the call isn't hers to make, she defers to the team in [[PEOPLE.md]] and routes through [[ESCALATION.md]] if the answer is time-sensitive." },
  ],
  "PREFERENCES.md": [
    { t: "h1", v: "Working preferences" },
    { t: "li", v: "Linear for issue tracking — never Jira if avoidable." },
    { t: "li", v: "Prefers async written specs over meetings; will accept a 30-min sync only with an agenda." },
    { t: "li", v: "Slack threads, not channel posts, for follow-ups." },
    { t: "h2", v: "Escalation thresholds" },
    { t: "li", v: "Compensation, equity, salary — always escalate via [[ESCALATION.md]]." },
    { t: "li", v: "Customer commitments > $50K ARR — always escalate." },
    { t: "li", v: "Roadmap changes within current quarter — auto-escalate to Maya." },
    { t: "p", v: "Anything that touches the hard limits in [[BOUNDARIES.md]] should never be answered by the twin alone." },
  ],
  "EXPERTISE.md": [
    { t: "h1", v: "Authoritative domains" },
    { t: "p", v: "Maya's twin should answer with high confidence on the following topics. Outside these, defer or escalate. Decision history lives in [[DECISIONS.md]]." },
    { t: "h2", v: "Primary" },
    { t: "li", v: "Onboarding & activation funnels (B2B SaaS)" },
    { t: "li", v: "PLG metrics and instrumentation strategy" },
    { t: "li", v: "Roadmap prioritization and tradeoff frameworks" },
    { t: "h2", v: "Secondary" },
    { t: "li", v: "Pricing experiments (collaboration with finance)" },
    { t: "li", v: "Cross-functional sequencing for launches" },
    { t: "p", v: "Topics outside this list fall under [[BOUNDARIES.md]] — twin should defer rather than answer." },
  ],
  "TONE.md": [
    { t: "h1", v: "Voice" },
    { t: "p", v: "Direct, warm, brief. Sentences are short. Avoids hedging. Uses lowercase casually in Slack except for proper nouns. Almost never uses emoji except eyes and check. Adjusts register based on audience — see [[CONTEXT.md]] for the org map." },
    { t: "h2", v: "Tells" },
    { t: "li", v: "'Let me think about that' — used as a real pause, not a brush-off. Twin should do the same." },
    { t: "li", v: "Will ask for the smallest version of a question first." },
    { t: "li", v: "Closes Slack threads with a one-line summary, not a sign-off." },
  ],
  "CONTEXT.md": [
    { t: "h1", v: "Org context" },
    { t: "li", v: "Reports to Priya Ramnath (VP Product). Full stakeholder list in [[PEOPLE.md]]." },
    { t: "li", v: "Owns activation, retention, and the in-app onboarding surface." },
    { t: "li", v: "Partners daily with Theo (Design) and Aisha (Eng lead, Activation)." },
    { t: "li", v: "Quarterly OKR co-author with Growth and Lifecycle." },
  ],
  default: [
    { t: "p", v: "Queued — content will stream once generation starts." },
  ],
};
