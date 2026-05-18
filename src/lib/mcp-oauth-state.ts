// Server-only. Short-lived in-memory store for the parameters we need to
// remember between /api/org/mcp/oauth/start and /api/org/mcp/oauth/callback:
// the PKCE verifier, the client we just registered, and where to land the
// resulting CustomMcpServer.
//
// Keys are the OAuth `state` value. Entries auto-expire after 10 minutes —
// well above the usual user-consent latency, well below "leak forever."

import "server-only";

export type PendingOAuthFlow = {
  /** When this entry was created. Used to evict stale ones. */
  createdAt: number;
  /** Display name + description to use when we materialise the CustomMcpServer. */
  serverName: string;
  serverDescription?: string;
  mcpUrl: string;
  transport: "http" | "sse";
  iconSlug?: string;
  /** OAuth bits — captured at /start, replayed at /callback. */
  authorizationServer: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
  redirectUri: string;
  scope?: string;
};

const TTL_MS = 10 * 60 * 1000;

// Use a module-level Map. Next.js dev mode reuses the module across HMR, so
// in-flight flows survive code edits — important during this build.
const store = new Map<string, PendingOAuthFlow>();

function evictExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) {
    if (v.createdAt < cutoff) store.delete(k);
  }
}

export function putPendingOAuth(state: string, flow: PendingOAuthFlow): void {
  evictExpired();
  store.set(state, flow);
}

export function takePendingOAuth(state: string): PendingOAuthFlow | undefined {
  evictExpired();
  const flow = store.get(state);
  if (flow) store.delete(state);
  return flow;
}
