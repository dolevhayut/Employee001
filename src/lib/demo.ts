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

export type Integration = {
  id: string;
  name: string;
  description: string;
  color: string;
  bgColor: string;
  unit: string;
  totalItems: number;
  startDelay: number; // ms before bar begins filling
  duration: number;   // ms to fill completely
  icon: string;
  simpleIconSlug: string; // slug for https://cdn.simpleicons.org/{slug}/0A0A0A
};

export const EMPLOYEES: Employee[] = [
  {
    id: "dolev-hayut",
    name: "Dolev Hayut",
    firstName: "Dolev",
    role: "CTO",
    department: "Engineering",
    initials: "DH",
    avatarColor: "#A8B4C4",
    integrations: ["github", "slack", "linear", "jira", "zoom"],
  },
  {
    id: "noa-levi",
    name: "Noa Levi",
    firstName: "Noa",
    role: "Product Manager",
    department: "Product",
    initials: "NL",
    avatarColor: "#C4A8B8",
    integrations: ["linear", "slack", "gmail", "zoom", "meet"],
  },
  {
    id: "dana-shapira",
    name: "Dana Shapira",
    firstName: "Dana",
    role: "Marketing Manager",
    department: "Marketing",
    initials: "DS",
    avatarColor: "#B8C4A8",
    integrations: ["slack", "gmail", "linear", "zoom", "outlook"],
  },
  {
    id: "lior-ben-david",
    name: "Lior Ben-David",
    firstName: "Lior",
    role: "Backend Developer",
    department: "Engineering",
    initials: "LB",
    avatarColor: "#A8C4B8",
    integrations: ["github", "slack", "linear"],
  },
  {
    id: "tamar-dvir",
    name: "Tamar Dvir",
    firstName: "Tamar",
    role: "Frontend Developer",
    department: "Engineering",
    initials: "TD",
    avatarColor: "#C4B8A8",
    integrations: ["github", "slack", "linear", "figma"],
  },
];

export const INTEGRATIONS: Record<string, Integration> = {
  gmail: {
    id: "gmail",
    name: "Gmail",
    description: "Emails, threads & communication style",
    color: "#EA4335",
    bgColor: "#FEF2F0",
    unit: "emails",
    totalItems: 2847,
    startDelay: 0,
    duration: 9000,
    icon: "mail",
    simpleIconSlug: "gmail",
  },
  slack: {
    id: "slack",
    name: "Slack",
    description: "Messages, channels & team dynamics",
    color: "#4A154B",
    bgColor: "#F9F0FA",
    unit: "messages",
    totalItems: 12391,
    startDelay: 800,
    duration: 13000,
    icon: "message-square",
    simpleIconSlug: "slack",
  },
  github: {
    id: "github",
    name: "GitHub",
    description: "Code, reviews & engineering patterns",
    color: "#24292F",
    bgColor: "#F6F8FA",
    unit: "commits",
    totalItems: 847,
    startDelay: 1800,
    duration: 7000,
    icon: "git-branch",
    simpleIconSlug: "github",
  },
  jira: {
    id: "jira",
    name: "Jira",
    description: "Tickets, priorities & delivery cadence",
    color: "#0052CC",
    bgColor: "#F0F4FF",
    unit: "tickets",
    totalItems: 234,
    startDelay: 2400,
    duration: 8000,
    icon: "layout-grid",
    simpleIconSlug: "jira",
  },
  linear: {
    id: "linear",
    name: "Linear",
    description: "Issues, sprints & project thinking",
    color: "#5E6AD2",
    bgColor: "#F2F3FD",
    unit: "issues",
    totalItems: 312,
    startDelay: 1200,
    duration: 10000,
    icon: "zap",
    simpleIconSlug: "linear",
  },
  zoom: {
    id: "zoom",
    name: "Zoom",
    description: "Meetings, calls & presence patterns",
    color: "#2D8CFF",
    bgColor: "#F0F7FF",
    unit: "meetings",
    totalItems: 89,
    startDelay: 3200,
    duration: 6000,
    icon: "video",
    simpleIconSlug: "zoom",
  },
  meet: {
    id: "meet",
    name: "Google Meet",
    description: "Calls & collaboration moments",
    color: "#00AC47",
    bgColor: "#F0FAF4",
    unit: "meetings",
    totalItems: 67,
    startDelay: 3800,
    duration: 5500,
    icon: "video",
    simpleIconSlug: "googlemeet",
  },
  outlook: {
    id: "outlook",
    name: "Outlook",
    description: "Emails, calendar & work rhythm",
    color: "#0078D4",
    bgColor: "#F0F7FF",
    unit: "emails",
    totalItems: 1893,
    startDelay: 1000,
    duration: 11000,
    icon: "mail",
    simpleIconSlug: "microsoftoutlook",
  },
};

export const PROCESSING_MESSAGES = [
  "Reading communication patterns…",
  "Analyzing decision-making style…",
  "Mapping expertise areas…",
  "Processing meeting transcripts…",
  "Learning response tendencies…",
  "Identifying knowledge graph…",
  "Calibrating voice & tone…",
  "Building context memory…",
  "Synthesizing work patterns…",
  "Finalizing twin model…",
];

export const ONBOARDING_STEPS = [
  { id: "welcome" },
  { id: "gmail" },
  { id: "slack" },
  { id: "github" },
  { id: "zoom" },
  { id: "done" },
];
