// Integration metadata. Originally part of a richer demo dataset; the demo
// employees and animated onboarding have been removed. Only this map remains
// because the workspace pages (join, employees) reference it for icons,
// labels, and colors per provider.

export type Integration = {
  id: string;
  name: string;
  description: string;
  color: string;
  bgColor: string;
  unit: string;
  /** Approximate item count, used only by legacy display code. */
  totalItems: number;
  icon: string;
  /** Slug for https://cdn.simpleicons.org/{slug}/0A0A0A */
  simpleIconSlug: string;
};

export const INTEGRATIONS: Record<string, Integration> = {
  gmail: {
    id: "gmail",
    name: "Gmail",
    description: "Emails, threads & communication style",
    color: "#EA4335",
    bgColor: "#FEF2F0",
    unit: "emails",
    totalItems: 2847,
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
    icon: "mail",
    simpleIconSlug: "microsoftoutlook",
  },
};
