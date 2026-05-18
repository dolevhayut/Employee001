// One-click MCP server presets. Each entry is a partial config — the user
// still needs to paste their own credential, but everything else (URL,
// transport, header skeleton, link to the integrations page) is filled in.
//
// Used by the Custom MCP settings card to render quick-add chips above the
// blank "Add MCP server" form. The catalog is static and ships with the
// repo; secrets never live here.

export type McpPreset = {
  /** Stable id, used as the chip key. */
  id: string;
  /** Display name; also used as the server name when registered. */
  name: string;
  /** One-line description shown next to the chip and in the modal. */
  description: string;
  transport: "http" | "sse";
  url: string;
  /**
   * How the user authenticates. `"bearer"` (default) renders a token-paste
   * field in the modal; `"oauth"` swaps that for a Connect button that
   * opens the upstream service's OAuth flow in a popup. The OAuth path
   * relies on the target server implementing the MCP authorization spec
   * (Dynamic Client Registration + PKCE) — verified at /start time.
   */
  auth?: "bearer" | "oauth";
  /** Optional header skeleton — value is left blank ("Bearer ") so the
   *  user only types/pastes the secret part. Omit for unauthenticated
   *  servers. Only used when auth === "bearer". */
  headerKey?: string;
  headerValuePrefix?: string;
  /** Short hint shown in the modal explaining where to find the secret
   *  (bearer mode) or what the OAuth scope grants (oauth mode). */
  tokenHint?: string;
  /** Optional URL the user can click to grab their token. */
  tokenUrl?: string;
  /** Composio catalog slug used to fetch a brand logo via `ToolkitIcon`.
   *  We only borrow the icon — Composio doesn't proxy the MCP traffic.
   *  Ignored when `iconUrl` is set. */
  iconSlug?: string;
  /** Static asset path or absolute URL to a logo. Used when Composio
   *  doesn't carry the brand (e.g. Higgsfield). Wins over `iconSlug`. */
  iconUrl?: string;
};

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "apify",
    name: "Apify",
    description:
      "Run any of 8000+ Apify Actors — scrapers, crawlers, RAG web browsers, social/maps extractors.",
    transport: "http",
    url: "https://mcp.apify.com/",
    headerKey: "Authorization",
    headerValuePrefix: "Bearer ",
    tokenHint:
      "Paste your Personal API token from the Apify console. It must start with apify_api_…",
    tokenUrl: "https://console.apify.com/account#/integrations",
    iconSlug: "apify",
  },
  {
    id: "stripe",
    name: "Stripe",
    description:
      "Customers, products, payments, subscriptions, invoices. Scope it down with a restricted API key.",
    transport: "http",
    url: "https://mcp.stripe.com/",
    headerKey: "Authorization",
    headerValuePrefix: "Bearer ",
    tokenHint:
      "Paste a Stripe restricted API key (rk_live_… or rk_test_…). Use restricted keys, not full secret keys — limit the agent to only the resources it needs.",
    tokenUrl: "https://dashboard.stripe.com/apikeys/create?name=Employee001+MCP&permissions[customer_read]=read",
    iconSlug: "stripe",
  },
  {
    id: "github",
    name: "GitHub",
    description:
      "Repos, issues, pull requests, code search, commit & PR history. Official GitHub-hosted MCP.",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    headerKey: "Authorization",
    headerValuePrefix: "Bearer ",
    tokenHint:
      "Paste a GitHub Personal Access Token (classic or fine-grained). Scope it to the repos and actions the twin needs — don't grant org-wide write.",
    tokenUrl: "https://github.com/settings/personal-access-tokens/new",
    iconSlug: "github",
  },
  {
    id: "linear",
    name: "Linear",
    description:
      "Issues, projects, cycles, comments. Read your roadmap and create/update tickets from chat.",
    transport: "http",
    url: "https://mcp.linear.app/mcp",
    headerKey: "Authorization",
    headerValuePrefix: "Bearer ",
    tokenHint:
      "Paste a Linear Personal API key. Scope it to read-only first if you only want the twin to summarise — write access lets it create/edit issues.",
    tokenUrl: "https://linear.app/settings/account/security",
    iconSlug: "linear",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description:
      "Scrape, crawl, and extract structured data from any website. LLM-ready markdown out of the box.",
    transport: "http",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    headerKey: "Authorization",
    headerValuePrefix: "Bearer ",
    tokenHint:
      "Paste your Firecrawl API key (fc_…). The free tier covers a few hundred pages a month — paid plans scale up.",
    tokenUrl: "https://www.firecrawl.dev/app/api-keys",
    iconSlug: "firecrawl",
  },
  {
    id: "vapi",
    name: "Vapi",
    description:
      "Voice agents: place calls, manage assistants, read call transcripts and recordings.",
    transport: "http",
    url: "https://mcp.vapi.ai/mcp",
    headerKey: "Authorization",
    headerValuePrefix: "Bearer ",
    tokenHint:
      "Paste a Vapi private API key from the dashboard. Use a server-side key, not the public one.",
    tokenUrl: "https://dashboard.vapi.ai/account",
    iconSlug: "vapi",
  },
  {
    id: "higgsfield",
    name: "Higgsfield",
    description:
      "Cinematic AI image and video generation. Sign in with your Higgsfield account — no API key to copy.",
    transport: "http",
    url: "https://mcp.higgsfield.ai/mcp",
    auth: "oauth",
    tokenHint:
      "You'll be sent to Higgsfield in a popup to sign in. Tokens stay on this machine — they're never sent anywhere else.",
    iconUrl: "/mcp-icons/higgsfield.png",
  },
];

export function findPreset(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}
