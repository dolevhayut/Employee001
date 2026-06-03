// Decides whether a tool call is auto-allowed, requires CEO approval,
// or hard-blocked. Used by the canUseTool callback in the agent runner.

export type ToolDecision =
  | { kind: "allow" }
  | { kind: "ask"; reason: string }
  | { kind: "block"; reason: string };

/**
 * Hard-block list — tool name patterns that should NEVER fire even with
 * approval until trust is established. Keep this short and conservative.
 */
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /_DELETE_/i,
  /_DESTROY_/i,
  /_REMOVE_USER_/i,
  /_TRANSFER_FUNDS_/i,
  /_REFUND_/i,
  /_PAYMENT_/i,
  /_CHARGE_/i,
];

/**
 * Read-only patterns — auto-allow because they cannot mutate anything
 * outside the agent's own working directory.
 */
const READ_ONLY_PATTERNS: RegExp[] = [
  /_GET_/i,
  /_LIST_/i,
  /_SEARCH_/i,
  /_FETCH_/i,
  /_RETRIEVE_/i,
  /_READ_/i,
  /_FIND_/i,
];

/** Local sandbox tools the SDK exposes for agent-internal use only. */
const LOCAL_SAFE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "Write",      // path-gated to scratch/<employeeId>/ via PreToolUse hook (sdk-defaults.ts)
  "WebSearch",  // CEO opted into web research; cost absorbed
  "WebFetch",   // same — fetching public URLs is acceptable
  "ToolSearch", // SDK helper for tool discovery — purely internal
  "Task",       // subagent dispatcher — auto-allow; the subagent's tool calls are gated separately
  "create_artifact", // local artifact renderer — UI-only, no external side effects
  // Meeting scratch — writes and reads stay inside the per-meeting disk
  // dir, never leave the host. UI-internal, no external side effects.
  "share_with_meeting",
  "read_meeting_file",
  "view_meeting_image",
  "analyze_csv",
  "query_csv",
  // Twin-to-twin consultation — purely internal orchestration (a nested twin
  // run on the same host). Loop-guarded by depth cap + visited set in
  // twin-consult.ts; request_approval additionally logs to /inbox for the
  // human to override. No external side effects of their own.
  "consult_twin",
  "request_approval",
]);

/**
 * Strip the `mcp__<server>__` prefix that the Agent SDK adds to MCP tool
 * names so the classifier sees the bare Composio action name.
 *
 *   mcp__composio__GITHUB_CREATE_AN_ISSUE → GITHUB_CREATE_AN_ISSUE
 */
function bareName(toolName: string): string {
  return (toolName || "").replace(/^mcp__[a-z0-9_]+__/i, "");
}

/**
 * Classify a tool call. The agent loop should pause for "ask" decisions
 * and surface them to the CEO via the approval card; "allow" passes
 * through; "block" returns deny with a message.
 */
export function classifyTool(
  toolName: string,
  input: Record<string, unknown> | undefined
): ToolDecision {
  const original = toolName || "";
  const name = bareName(original); // strip mcp__server__ prefix

  // Local sandbox + SDK built-in tools never need approval.
  if (LOCAL_SAFE_TOOLS.has(original) || LOCAL_SAFE_TOOLS.has(name)) {
    return { kind: "allow" };
  }

  // Hard-block on destructive patterns regardless of approval.
  for (const re of HARD_BLOCK_PATTERNS) {
    if (re.test(name)) {
      return {
        kind: "block",
        reason: `${name} is on the hard-block list (deletes, payments, account changes).`,
      };
    }
  }

  // Auto-allow read-only patterns.
  for (const re of READ_ONLY_PATTERNS) {
    if (re.test(name)) {
      return { kind: "allow" };
    }
  }

  // Slack — sends to channels or DMs.
  if (/SLACK_(SEND|POST|REPLY|UPDATE_MESSAGE|SCHEDULE)/i.test(name)) {
    const channel =
      typeof input?.channel === "string"
        ? (input.channel as string)
        : typeof input?.channel_name === "string"
        ? (input.channel_name as string)
        : "";
    return {
      kind: "ask",
      reason: channel
        ? `About to send a Slack message to ${channel}. Public message — review before sending.`
        : "About to send a Slack message. Review the recipient and content before sending.",
    };
  }

  // Email senders.
  if (/(GMAIL|OUTLOOK|EMAIL).*(SEND|REPLY)|SEND_EMAIL/i.test(name)) {
    const to =
      typeof input?.to === "string"
        ? (input.to as string)
        : Array.isArray(input?.to)
        ? (input.to as string[]).join(", ")
        : "";
    return {
      kind: "ask",
      reason: to
        ? `About to send an email to ${to}. External communication — review before sending.`
        : "About to send an email. Review recipient and content before sending.",
    };
  }

  // Anything that creates a tracked record — note: matches CREATE_ISSUE,
  // CREATE_AN_ISSUE, CREATE_NEW_ISSUE, CREATE_PULL_REQUEST, etc.
  if (/CREATE/i.test(name)) {
    return {
      kind: "ask",
      reason: `About to create a record via ${name}. Review the title and body before creating.`,
    };
  }

  if (/(UPDATE|EDIT|MODIFY|PATCH|MERGE|CLOSE|REOPEN|ASSIGN|TRANSFER)/i.test(name)) {
    return {
      kind: "ask",
      reason: `About to mutate existing data via ${name}. Review the change before applying.`,
    };
  }

  // Anything else that looks like a Composio action (TOOLKIT_VERB_OBJECT).
  if (/^[A-Z][A-Z0-9_]+$/.test(name) && name.includes("_")) {
    return {
      kind: "ask",
      reason: `${name} is an external action. Confirm before running.`,
    };
  }

  // Truly unrecognized — default safe: ask rather than allow.
  return {
    kind: "ask",
    reason: `${original} is an unrecognized tool. Confirm before running.`,
  };
}

/** Short human-readable description for the approval card heading. */
export function describeTool(toolName: string): string {
  // Strip mcp__composio__ prefix if present
  const stripped = toolName.replace(/^mcp__[a-z_]+__/, "");
  // SLACK_SEND_MESSAGE → "Slack: Send message"
  const parts = stripped.split("_");
  if (parts.length >= 2) {
    const toolkit = parts[0];
    const action = parts.slice(1).join(" ").toLowerCase();
    return `${toolkit.charAt(0)}${toolkit.slice(1).toLowerCase()}: ${action}`;
  }
  return stripped;
}
