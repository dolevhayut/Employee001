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
  /** Optional header skeleton — value is left blank ("Bearer ") so the
   *  user only types/pastes the secret part. Omit for unauthenticated
   *  servers. */
  headerKey?: string;
  headerValuePrefix?: string;
  /** Short hint shown in the modal explaining where to find the secret. */
  tokenHint?: string;
  /** Optional URL the user can click to grab their token. */
  tokenUrl?: string;
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
  },
];

export function findPreset(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}
