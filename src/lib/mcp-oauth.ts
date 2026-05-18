// Server-only. Implements just enough of the MCP Authorization spec for the
// "Connect" button in /settings to work against any standards-compliant MCP
// server (Higgsfield, Notion, Atlassian, Linear-OAuth, …):
//
//   1. discoverOAuth(mcpUrl)
//        → GET /.well-known/oauth-protected-resource → resolves the auth
//          server, then GET /.well-known/oauth-authorization-server on it.
//          Returns endpoints + scope hints.
//   2. registerClient(metadata, redirectUri)
//        → POST /oauth2/register (RFC 7591 Dynamic Client Registration).
//          Returns client_id (and client_secret if confidential).
//   3. pkcePair() / buildAuthUrl()
//        → Generate code_verifier + S256 challenge, assemble the authorize
//          URL the user opens in a popup.
//   4. exchangeCode() / refreshAccessToken()
//        → Standard OAuth 2.1 grants. Return { accessToken, refreshToken,
//          expiresAt, scope } in our local shape.
//
// We deliberately keep `none` token_endpoint_auth_method when no client
// secret was issued (public client + PKCE), and fall back to
// `client_secret_basic` when a secret is present. That covers the two
// shapes MCP servers actually emit in the wild.

import "server-only";
import { randomBytes, createHash } from "crypto";

export type DiscoveredOAuthMetadata = {
  /** The authorization-server origin (issuer). */
  authorizationServer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Present when the server supports Dynamic Client Registration. */
  registrationEndpoint?: string;
  /** Scopes the resource declared it accepts. We pass these through to
   *  the authorize call so the user grants the minimum needed. */
  scopesSupported?: string[];
  /** Whether the server advertises S256 PKCE. We require S256. */
  pkceS256Supported: boolean;
};

/** Browse the well-knowns and return the auth endpoints we need. */
export async function discoverOAuth(
  mcpUrl: string,
): Promise<DiscoveredOAuthMetadata> {
  const resourceMeta = await fetchJson<{
    authorization_servers?: string[];
    scopes_supported?: string[];
  }>(joinWellKnown(mcpUrl, "oauth-protected-resource"));

  const authServer = resourceMeta.authorization_servers?.[0];
  if (!authServer) {
    throw new Error(
      "MCP server does not advertise an authorization_servers entry — cannot start OAuth.",
    );
  }

  const asMeta = await fetchJson<{
    authorization_endpoint?: string;
    token_endpoint?: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
    code_challenge_methods_supported?: string[];
  }>(joinWellKnown(authServer, "oauth-authorization-server"));

  if (!asMeta.authorization_endpoint || !asMeta.token_endpoint) {
    throw new Error("Authorization server metadata is missing required endpoints.");
  }

  const pkceS256 =
    Array.isArray(asMeta.code_challenge_methods_supported) &&
    asMeta.code_challenge_methods_supported.includes("S256");
  if (!pkceS256) {
    throw new Error("Authorization server does not advertise S256 PKCE — refusing.");
  }

  return {
    authorizationServer: authServer,
    authorizationEndpoint: asMeta.authorization_endpoint,
    tokenEndpoint: asMeta.token_endpoint,
    registrationEndpoint: asMeta.registration_endpoint,
    scopesSupported: asMeta.scopes_supported ?? resourceMeta.scopes_supported,
    pkceS256Supported: true,
  };
}

export type RegisteredClient = {
  clientId: string;
  clientSecret?: string;
};

/**
 * Dynamic Client Registration. We register one client per MCP server per
 * workspace and reuse it across refreshes — the credentials are persisted
 * inside CustomMcpServer.oauth so future refresh calls authenticate
 * correctly.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName: string,
): Promise<RegisteredClient> {
  const body = {
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
  };

  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Dynamic Client Registration failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    client_id?: string;
    client_secret?: string;
  };
  if (!data.client_id) {
    throw new Error("Registration endpoint did not return a client_id.");
  }
  return {
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export function pkcePair(): PkcePair {
  // RFC 7636 §4.1: 43–128 unreserved chars. 32 random bytes → 43-char base64url.
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64Url(randomBytes(24));
}

export function buildAuthUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(args.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (args.scope) u.searchParams.set("scope", args.scope);
  return u.toString();
}

export type TokenResponse = {
  accessToken: string;
  refreshToken?: string;
  /** ISO timestamp this access token stops being valid. */
  expiresAt: string;
  scope?: string;
};

export async function exchangeCode(args: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    code_verifier: args.codeVerifier,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
  });
  return postTokenForm(args.tokenEndpoint, form, args.clientSecret, args.clientId);
}

export async function refreshAccessToken(args: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  return postTokenForm(args.tokenEndpoint, form, args.clientSecret, args.clientId);
}

// ─── internals ───────────────────────────────────────────────────────────────

async function postTokenForm(
  endpoint: string,
  form: URLSearchParams,
  clientSecret: string | undefined,
  clientId: string,
): Promise<TokenResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (clientSecret) {
    headers.Authorization =
      "Basic " +
      Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  }
  const res = await fetch(endpoint, { method: "POST", headers, body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token endpoint returned ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  if (!data.access_token) {
    throw new Error("Token response missing access_token.");
  }
  // Default to 1h when expires_in is omitted; refresh-with-skew kicks in
  // before then anyway.
  const lifetimeSec = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + lifetimeSec * 1000).toISOString(),
    scope: data.scope,
  };
}

function joinWellKnown(origin: string, suffix: string): string {
  const u = new URL(origin);
  // Per RFC 8414, well-known paths sit on the issuer root, not under any
  // existing path component. Higgsfield does the standard thing.
  return `${u.origin}/.well-known/${suffix}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status}`);
  }
  return (await res.json()) as T;
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
