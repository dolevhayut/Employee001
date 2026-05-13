// Task templates — pre-built tasks the CEO can fire at twins via slash command.
//
// Templates are CLIENT-SAFE (used in `src/app/(workspace)/tasks/page.tsx`).
// Keep this module free of Node-only imports (fs, path, etc).

export type TaskTemplate = {
  /** Stable id, also used as the slash trigger keyword. */
  id: string;
  /** Display name in the dropdown. */
  name: string;
  /** One-line description shown beneath the name. */
  description: string;
  /** The task text that fills the textarea when the template is chosen. */
  task: string;
  /**
   * Which employees this template applies to.
   * - "all"    — every employee
   * - string[] — explicit employee IDs
   */
  appliesTo: "all" | string[];
  /**
   * Toolkits this template needs the employee to have connected. If any are
   * missing, the template is hidden in the slash menu for that employee.
   * Empty / undefined = no toolkit requirement (works without integrations).
   */
  requiresToolkits?: string[];
  /** Optional grouping label in the dropdown. */
  category?: string;
};

// ─── Built-in templates ──────────────────────────────────────────────────────

export const TASK_TEMPLATES: TaskTemplate[] = [
  // ─── Universal templates (work for any employee, no integrations needed) ──
  {
    id: "eod-update",
    name: "End-of-day update",
    description: "Brief recap of what you worked on today",
    task: "Give me a brief end-of-day update — what did you work on today, what's blocked, and what's next on your plate?",
    appliesTo: "all",
    category: "Daily",
  },
  {
    id: "weekly-priorities",
    name: "Weekly priorities",
    description: "Top 3 priorities for the upcoming week",
    task: "What are your top 3 priorities for this week, ranked by impact? Briefly explain why each one matters.",
    appliesTo: "all",
    category: "Daily",
  },
  {
    id: "blockers",
    name: "Current blockers",
    description: "Anything blocking your work right now",
    task: "List anything currently blocking you or your team — be specific about what you need from me to unblock.",
    appliesTo: "all",
    category: "Daily",
  },

  // ─── Engineering / GitHub ────────────────────────────────────────────────
  {
    id: "open-prs",
    name: "Open PRs needing attention",
    description: "Prioritized list of open PRs in our GitHub repos",
    task: "List the open pull requests across our GitHub repos. For each one, note the author, age, and whether it needs my attention or is blocked on someone else.",
    appliesTo: "all",
    requiresToolkits: ["github"],
    category: "Engineering",
  },
  {
    id: "pr-digest",
    name: "Daily PR digest",
    description: "Summary of all PR activity in the last 24h",
    task: "Pull all PR activity from the last 24 hours across our main repos — opened, merged, reviewed. Give me a one-paragraph summary highlighting anything I should know about.",
    appliesTo: "all",
    requiresToolkits: ["github"],
    category: "Engineering",
  },
  {
    id: "issue-triage",
    name: "Triage open issues",
    description: "Categorize and prioritize open issues",
    task: "Pull the open issues from our GitHub repos. Group them by severity/area and tell me which ones need a decision from me this week.",
    appliesTo: "all",
    requiresToolkits: ["github"],
    category: "Engineering",
  },

  // ─── Product / Linear ────────────────────────────────────────────────────
  {
    id: "sprint-status",
    name: "Sprint status",
    description: "What's in flight, what's blocked, what's at risk",
    task: "Pull the current sprint from Linear. Tell me what's in flight, what's blocked, and which items are at risk of slipping. Be specific about owners.",
    appliesTo: "all",
    requiresToolkits: ["linear"],
    category: "Product",
  },
  {
    id: "weekly-product-update",
    name: "Weekly product update",
    description: "Draft a product update for the team",
    task: "Draft a weekly product update for the team. Pull from Linear: what shipped, what's in flight, what's coming next. Tone: clear, no jargon, ~150 words.",
    appliesTo: "all",
    requiresToolkits: ["linear"],
    category: "Product",
  },

  // ─── Communication / Slack + Email ───────────────────────────────────────
  {
    id: "unread-emails",
    name: "Triage unread emails",
    description: "Summarize and prioritize unread Gmail",
    task: "Look at my unread Gmail from the last 24 hours. Group by importance — what needs a reply today, what can wait, what's just noise. Don't reply to anything; just summarize.",
    appliesTo: "all",
    requiresToolkits: ["gmail"],
    category: "Communication",
  },
  {
    id: "slack-mentions",
    name: "Slack mentions digest",
    description: "What did people @-mention me about?",
    task: "Pull my Slack mentions from the last 24 hours. For each one, tell me what was asked and whether it needs a response from me.",
    appliesTo: "all",
    requiresToolkits: ["slack"],
    category: "Communication",
  },

  // ─── Calendar ────────────────────────────────────────────────────────────
  {
    id: "calendar-prep",
    name: "Today's calendar prep",
    description: "Brief on each meeting today",
    task: "Walk me through today's calendar. For each meeting, tell me who's attending, what it's about, and what I should prepare or decide.",
    appliesTo: "all",
    requiresToolkits: ["googlecalendar"],
    category: "Calendar",
  },

  // ─── Growth / HubSpot / LinkedIn (Dana-flavored) ─────────────────────────
  {
    id: "top-leads",
    name: "Top leads this week",
    description: "Top inbound leads ranked by fit",
    task: "Pull the top inbound leads from HubSpot this week. Rank them by fit (company size, industry, intent signals) and tell me which 3 deserve outreach this week.",
    appliesTo: "all",
    requiresToolkits: ["hubspot"],
    category: "Growth",
  },
  {
    id: "linkedin-engagement",
    name: "LinkedIn engagement summary",
    description: "Recent engagement on my LinkedIn posts",
    task: "Pull engagement on my recent LinkedIn posts. Tell me which posts performed best, who notable engaged, and what I should follow up on.",
    appliesTo: "all",
    requiresToolkits: ["linkedin"],
    category: "Growth",
  },
];

// ─── Filtering helpers ───────────────────────────────────────────────────────

/** Template is available for this employee given their connected toolkits. */
export function templateAvailableFor(
  template: TaskTemplate,
  employeeId: string,
  connectedToolkits: string[]
): boolean {
  // Employee scope
  if (template.appliesTo !== "all" && !template.appliesTo.includes(employeeId)) {
    return false;
  }
  // Toolkit requirements
  if (template.requiresToolkits && template.requiresToolkits.length > 0) {
    const have = new Set(connectedToolkits.map((t) => t.toLowerCase()));
    const allConnected = template.requiresToolkits.every((t) =>
      have.has(t.toLowerCase())
    );
    if (!allConnected) return false;
  }
  return true;
}

/**
 * Filter + rank templates against the employee + the user's typed query.
 *
 * Pass `templates` to include custom templates fetched from /api/templates;
 * defaults to the built-in list for callers that only need the static set.
 */
export function filterTemplates(
  query: string,
  employeeId: string,
  connectedToolkits: string[],
  templates: TaskTemplate[] = TASK_TEMPLATES
): TaskTemplate[] {
  const available = templates.filter((t) =>
    templateAvailableFor(t, employeeId, connectedToolkits)
  );
  const q = query.trim().toLowerCase();
  if (!q) return available;
  // Match against name, id, description, category. Prefix matches rank higher.
  const scored = available
    .map((t) => {
      const hay = `${t.name} ${t.id} ${t.description} ${t.category ?? ""}`.toLowerCase();
      const idx = hay.indexOf(q);
      if (idx === -1) return { t, score: -1 };
      // Earlier index = higher score; perfect prefix on the name boosts further.
      const namePrefix = t.name.toLowerCase().startsWith(q) || t.id.startsWith(q) ? 100 : 0;
      return { t, score: namePrefix + (1000 - idx) };
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.t);
  return scored;
}
