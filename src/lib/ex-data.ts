// Employee001 — shared data exports

export type IntegrationStatus =
  | "connected"
  | "syncing"
  | "needs-auth"
  | "disconnected";

export type Integration = {
  id: string;
  name: string;
  category: string;
  desc: string;
  scopes: string[];
  status: IntegrationStatus;
  lastSync: string;
  events: number;
  owner: string;
  pinned?: boolean;
  composioSlug?: string; // Composio catalog slug when it differs from id
};

export const INTEGRATIONS: Integration[] = [
  {
    id: "outlook",
    name: "Outlook",
    category: "Email",
    desc: "Inbox patterns, threads, response cadence",
    scopes: ["Mail.Read", "Mail.ReadBasic"],
    status: "connected",
    lastSync: "12 min ago",
    events: 3421,
    owner: "Microsoft",
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "Email",
    desc: "Inbox patterns, threads, response cadence",
    scopes: ["gmail.readonly"],
    status: "connected",
    lastSync: "8 min ago",
    events: 2890,
    owner: "Google",
  },
  {
    id: "teams",
    name: "MS Teams",
    category: "Meetings",
    desc: "Meeting transcripts, channel activity",
    scopes: ["ChannelMessage.Read"],
    status: "connected",
    lastSync: "2 hr ago",
    events: 412,
    owner: "Microsoft",
    composioSlug: "microsoft_teams",
  },
  {
    id: "meet",
    name: "Meet",
    category: "Meetings",
    desc: "Calendar events and meeting transcripts",
    scopes: ["calendar.readonly"],
    status: "connected",
    lastSync: "31 min ago",
    events: 187,
    owner: "Google",
    composioSlug: "googlemeet",
  },
  {
    id: "zoom",
    name: "Zoom",
    category: "Meetings",
    desc: "Meeting transcripts and recordings",
    scopes: ["meeting:read", "recording:read"],
    status: "needs-auth",
    lastSync: "—",
    events: 0,
    owner: "Zoom",
  },
  {
    id: "slack",
    name: "Slack",
    category: "Chat",
    desc: "Channels, DMs, threads — twin output channel",
    scopes: ["channels:history", "chat:write"],
    status: "connected",
    lastSync: "live",
    events: 8417,
    owner: "Slack",
    pinned: true,
  },
  {
    id: "github",
    name: "GitHub",
    category: "Engineering",
    desc: "PRs, reviews, issues, discussions",
    scopes: ["repo", "read:org"],
    status: "connected",
    lastSync: "4 min ago",
    events: 1204,
    owner: "GitHub",
  },
  {
    id: "linear",
    name: "Linear",
    category: "Engineering",
    desc: "Issues, projects, comments",
    scopes: ["read"],
    status: "syncing",
    lastSync: "Initial sync…",
    events: 89,
    owner: "Linear",
  },
  {
    id: "jira",
    name: "Jira",
    category: "Engineering",
    desc: "Issues, sprints, comments",
    scopes: ["read:jira-work"],
    status: "disconnected",
    lastSync: "—",
    events: 0,
    owner: "Atlassian",
  },
  {
    id: "sharepoint",
    name: "SharePoint",
    category: "Microsoft 365",
    desc: "Docs, wikis, shared knowledge base",
    scopes: ["Sites.Read.All"],
    status: "disconnected",
    lastSync: "—",
    events: 0,
    owner: "Microsoft",
    composioSlug: "share_point",
  },
  {
    id: "onedrive",
    name: "OneDrive",
    category: "Microsoft 365",
    desc: "Files, documents, version history",
    scopes: ["Files.Read.All"],
    status: "disconnected",
    lastSync: "—",
    events: 0,
    owner: "Microsoft",
    composioSlug: "one_drive",
  },
  {
    id: "loop",
    name: "Microsoft Loop",
    category: "Microsoft 365",
    desc: "Collaborative workspaces and components",
    scopes: ["Loop.Read.All"],
    status: "disconnected",
    lastSync: "—",
    events: 0,
    owner: "Microsoft",
  },
  {
    id: "planner",
    name: "Planner",
    category: "Microsoft 365",
    desc: "Tasks, assignments, project buckets",
    scopes: ["Tasks.Read"],
    status: "disconnected",
    lastSync: "—",
    events: 0,
    owner: "Microsoft",
  },
];

export type ProfileFileStatus = "done" | "running" | "queued";

export type ProfileFile = {
  name: string;
  desc: string;
  tokens: number;
  status: ProfileFileStatus;
};

export const PROFILE_FILES: ProfileFile[] = [
  { name: "EXPERTISE.md", desc: "Domains the expert is authoritative on", tokens: 4218, status: "done" },
  { name: "TONE.md", desc: "Voice, register, characteristic phrases", tokens: 2104, status: "done" },
  { name: "CONTEXT.md", desc: "Org chart, team, stakeholders, projects", tokens: 3876, status: "done" },
  { name: "DECISIONS.md", desc: "Past decisions and the reasoning behind them", tokens: 5102, status: "running" },
  { name: "PREFERENCES.md", desc: "Tools, formats, escalation thresholds", tokens: 1820, status: "running" },
  { name: "PEOPLE.md", desc: "Who the expert defers to and on what", tokens: 2987, status: "queued" },
  { name: "RECURRING.md", desc: "Frequently asked questions and stock answers", tokens: 0, status: "queued" },
  { name: "BOUNDARIES.md", desc: "What the twin should NEVER answer alone", tokens: 0, status: "queued" },
  { name: "PROJECTS.md", desc: "Active workstreams and their current state", tokens: 0, status: "queued" },
  { name: "WORKING_STYLE.md", desc: "Hours, async preferences, meeting style", tokens: 0, status: "queued" },
  { name: "GLOSSARY.md", desc: "Internal acronyms, codenames, jargon", tokens: 0, status: "queued" },
  { name: "ESCALATION.md", desc: "Who to route to when twin lacks confidence", tokens: 0, status: "queued" },
  { name: "HISTORY.md", desc: "Role timeline, promotions, recognition, training", tokens: 1840, status: "done" },
];
