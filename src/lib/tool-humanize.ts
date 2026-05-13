/**
 * Tool action humanizer.
 *
 * Composio MCP tools follow a `TOOLKIT_VERB_OBJECT` naming convention
 * (e.g. `GITHUB_LIST_REPOSITORY_ISSUES`, `GMAIL_SEND_EMAIL`). The raw names
 * are accurate but visually noisy for non-technical users. This module
 * converts a tool name + input arguments into a friendly action description.
 */

export type HumanizedToolAction = {
  /** Present-participle verb shown to the user, e.g. "Listing", "Sending". */
  verb: string;
  /** Short noun describing the object, e.g. "issues", "email". */
  noun: string;
  /** Optional context like "in owner/repo" or "to foo@bar". */
  detail?: string;
  /** Lower-case toolkit name when one can be inferred (github, gmail, slack...). */
  toolkit: string;
};

type Args = Record<string, unknown>;

const VERB_MAP: Array<{ pattern: RegExp; verb: string }> = [
  { pattern: /^(LIST|GET_ALL|FETCH_MANY)$/i, verb: "Listing" },
  { pattern: /^(GET|FETCH|READ|RETRIEVE|SHOW|VIEW)$/i, verb: "Fetching" },
  { pattern: /^(SEARCH|FIND|QUERY|LOOKUP)$/i, verb: "Searching" },
  { pattern: /^(SEND|EMAIL|DM|MESSAGE)$/i, verb: "Sending" },
  { pattern: /^(POST|REPLY|COMMENT)$/i, verb: "Posting" },
  { pattern: /^(CREATE|ADD|MAKE|NEW|OPEN)$/i, verb: "Creating" },
  { pattern: /^(UPDATE|EDIT|MODIFY|PATCH|SET)$/i, verb: "Updating" },
  { pattern: /^(DELETE|REMOVE|CLOSE|ARCHIVE)$/i, verb: "Deleting" },
  { pattern: /^(UPLOAD)$/i, verb: "Uploading" },
  { pattern: /^(DOWNLOAD)$/i, verb: "Downloading" },
  { pattern: /^(STAR|LIKE)$/i, verb: "Starring" },
  { pattern: /^(MERGE)$/i, verb: "Merging" },
  { pattern: /^(APPROVE)$/i, verb: "Approving" },
];

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function pickArg(args: Args, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = asString(args[k]);
    if (v) return v;
  }
  return undefined;
}

function bareName(tool: string): string {
  return tool.replace(/^mcp__[a-z0-9_]+__/i, "");
}

/**
 * Parse a tool name into { toolkit, verbToken, objectTokens }.
 * Examples:
 *   "GITHUB_LIST_REPOSITORY_ISSUES" -> github / LIST / ["REPOSITORY","ISSUES"]
 *   "GMAIL_SEND_EMAIL"              -> gmail  / SEND / ["EMAIL"]
 *   "SOMECUSTOMTOOL"                -> ""     / ""   / ["SOMECUSTOMTOOL"]
 */
function parseTokens(tool: string): {
  toolkit: string;
  verbToken: string;
  objectTokens: string[];
} {
  const bare = bareName(tool);
  const parts = bare.split("_").filter(Boolean);
  if (parts.length === 0) return { toolkit: "", verbToken: "", objectTokens: [] };
  if (parts.length === 1) {
    return { toolkit: "", verbToken: "", objectTokens: parts };
  }
  const [toolkitToken, verbToken, ...rest] = parts;
  return {
    toolkit: toolkitToken.toLowerCase(),
    verbToken: verbToken.toUpperCase(),
    objectTokens: rest,
  };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function nounFromTokens(tokens: string[]): string {
  if (tokens.length === 0) return "action";
  // Last 1-2 tokens usually carry the object; lower-case them.
  const tail = tokens.slice(-2).map((t) => t.toLowerCase()).join(" ");
  // Common shortenings.
  return tail
    .replace(/repository/g, "repo")
    .replace(/repositories/g, "repos")
    .replace(/messages?/g, (m) => m)
    .replace(/issues?/g, (m) => m);
}

function verbFromToken(token: string): string {
  for (const { pattern, verb } of VERB_MAP) {
    if (pattern.test(token)) return verb;
  }
  if (!token) return "Running";
  // Fallback: turn the token itself into a present-participle-ish form.
  return titleCase(token) + "ing";
}

/**
 * Toolkit-specific tweaks. Returns a partial humanization to merge over the
 * generic parse. Keep this small — the goal is good defaults, not exhaustive
 * per-tool overrides.
 */
function toolkitDetail(
  toolkit: string,
  bare: string,
  args: Args
): { noun?: string; detail?: string } {
  switch (toolkit) {
    case "github": {
      const owner = pickArg(args, "owner", "org");
      const repo = pickArg(args, "repo", "repository", "name");
      const query = pickArg(args, "query", "q", "search");
      const issue = pickArg(args, "issue_number", "number");
      const detailParts: string[] = [];
      if (owner && repo) detailParts.push(`in ${owner}/${repo}`);
      else if (repo) detailParts.push(`in ${repo}`);
      if (issue) detailParts.push(`#${issue}`);
      if (query) detailParts.push(`matching "${query}"`);
      let noun: string | undefined;
      if (/ISSUE/i.test(bare)) noun = "issues";
      else if (/PULL_REQUEST|PR(_|$)/i.test(bare)) noun = "pull requests";
      else if (/REPOSITOR(Y|IES)|REPO/i.test(bare)) noun = "repos";
      else if (/COMMIT/i.test(bare)) noun = "commits";
      else if (/BRANCH/i.test(bare)) noun = "branches";
      else if (/COMMENT/i.test(bare)) noun = "comments";
      return { noun, detail: detailParts.join(" ") || undefined };
    }
    case "gmail": {
      const to = pickArg(args, "recipient_email", "to", "recipient");
      const subj = pickArg(args, "subject");
      const q = pickArg(args, "query", "q");
      const detailParts: string[] = [];
      if (to) detailParts.push(`to ${to}`);
      if (subj) detailParts.push(`"${subj}"`);
      if (q && !to) detailParts.push(`matching "${q}"`);
      let noun: string | undefined;
      if (/EMAIL|MESSAGE|DRAFT|THREAD/i.test(bare)) noun = "email";
      return { noun, detail: detailParts.join(" ") || undefined };
    }
    case "slack": {
      const channel = pickArg(args, "channel", "channel_id", "channel_name");
      const user = pickArg(args, "user", "user_id");
      const detailParts: string[] = [];
      if (channel) {
        const c = channel.startsWith("#") || channel.startsWith("C")
          ? channel
          : `#${channel}`;
        detailParts.push(`to ${c}`);
      } else if (user) {
        detailParts.push(`to ${user}`);
      }
      let noun: string | undefined;
      if (/MESSAGE|POST|CHAT/i.test(bare)) noun = "message";
      else if (/CHANNEL/i.test(bare)) noun = "channels";
      else if (/USER/i.test(bare)) noun = "users";
      return { noun, detail: detailParts.join(" ") || undefined };
    }
    case "googlecalendar":
    case "calendar": {
      const summary = pickArg(args, "summary", "title");
      const detail = summary ? `"${summary}"` : undefined;
      const noun = /EVENT/i.test(bare) ? "event" : undefined;
      return { noun, detail };
    }
    case "notion": {
      const title = pickArg(args, "title", "page_title", "name");
      const detail = title ? `"${title}"` : undefined;
      let noun: string | undefined;
      if (/PAGE/i.test(bare)) noun = "page";
      else if (/DATABASE/i.test(bare)) noun = "database";
      return { noun, detail };
    }
    case "linear": {
      const title = pickArg(args, "title", "name");
      const id = pickArg(args, "issue_id", "id");
      const detail = title ? `"${title}"` : id ? id : undefined;
      const noun = /ISSUE/i.test(bare) ? "issue" : undefined;
      return { noun, detail };
    }
    default:
      return {};
  }
}

export function humanizeToolAction(
  toolName: string,
  input: unknown
): HumanizedToolAction {
  const args: Args =
    input && typeof input === "object" ? (input as Args) : {};
  const bare = bareName(toolName);
  const { toolkit, verbToken, objectTokens } = parseTokens(toolName);

  const verb = verbFromToken(verbToken);
  const genericNoun = nounFromTokens(objectTokens);
  const tweak = toolkitDetail(toolkit, bare, args);

  return {
    verb,
    noun: tweak.noun ?? genericNoun,
    detail: tweak.detail,
    toolkit,
  };
}
