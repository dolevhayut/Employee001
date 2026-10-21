// OpenID Connect sign-in (authorization code + PKCE S256), with node:crypto
// only: discovery, the token exchange, and ID-token verification against the
// provider's JWKS (RS256/RS384/RS512, PS256, ES256/ES384). Works with Google
// Workspace, Microsoft Entra ID, Okta, Auth0, Keycloak and other OIDC IdPs.
//
// Config (env):
//   EMPLOYEE001_OIDC_ISSUER         e.g. https://login.microsoftonline.com/<tenant>/v2.0
//   EMPLOYEE001_OIDC_CLIENT_ID
//   EMPLOYEE001_OIDC_CLIENT_SECRET  (omit for a public client)
//   EMPLOYEE001_OIDC_REDIRECT_URI   default <APP_URL>/api/auth/oidc/callback
//   EMPLOYEE001_OIDC_ALLOWED_DOMAINS  comma list; an unknown user with a
//                                     verified email here is created as member
//
// SAML is not supported yet (see docs/fixes/2026-10-compliance-plan.md).

import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  allowedDomains: string[];
};

export function oidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const issuer = env.EMPLOYEE001_OIDC_ISSUER?.trim().replace(/\/$/, "");
  const clientId = env.EMPLOYEE001_OIDC_CLIENT_ID?.trim();
  const appUrl = env.APP_URL?.trim().replace(/\/$/, "");
  const redirectUri = env.EMPLOYEE001_OIDC_REDIRECT_URI?.trim() || (appUrl ? `${appUrl}/api/auth/oidc/callback` : "");
  if (!issuer || !clientId || !redirectUri) return null;
  return {
    issuer,
    clientId,
    clientSecret: env.EMPLOYEE001_OIDC_CLIENT_SECRET?.trim() || undefined,
    redirectUri,
    allowedDomains: (env.EMPLOYEE001_OIDC_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
  };
}

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, { at: number; keys: JsonWebKey[] }>();
const CACHE_MS = 60 * 60 * 1000;

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OIDC: ${url} returned ${res.status}`);
  return (await res.json()) as T;
}

export async function discover(issuer: string, fetcher: typeof fetch = fetch): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.doc;
  const doc = await getJson<Discovery>(`${issuer}/.well-known/openid-configuration`, fetcher);
  if (doc.issuer.replace(/\/$/, "") !== issuer) throw new Error("OIDC: discovery issuer mismatch");
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** State, nonce and PKCE verifier for one sign-in attempt. */
export function newAuthRequest(): { state: string; nonce: string; verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return {
    state: b64url(randomBytes(16)),
    nonce: b64url(randomBytes(16)),
    verifier,
    challenge: b64url(createHash("sha256").update(verifier).digest()),
  };
}

export async function authorizationUrl(cfg: OidcConfig, req: { state: string; nonce: string; challenge: string }, fetcher: typeof fetch = fetch): Promise<string> {
  const doc = await discover(cfg.issuer, fetcher);
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", req.state);
  url.searchParams.set("nonce", req.nonce);
  url.searchParams.set("code_challenge", req.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type IdClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  azp?: string;
};

const ALGS: Record<string, { hash: string; padding?: "pss"; dsa?: boolean }> = {
  RS256: { hash: "sha256" },
  RS384: { hash: "sha384" },
  RS512: { hash: "sha512" },
  PS256: { hash: "sha256", padding: "pss" },
  ES256: { hash: "sha256", dsa: true },
  ES384: { hash: "sha384", dsa: true },
};

async function signingKey(jwksUri: string, kid: string | undefined, fetcher: typeof fetch): Promise<KeyObject> {
  const pick = (keys: JsonWebKey[]) => keys.find((k) => (kid ? k.kid === kid : true) && (k.use === undefined || k.use === "sig"));
  let cached = jwksCache.get(jwksUri);
  let jwk = cached && Date.now() - cached.at < CACHE_MS ? pick(cached.keys) : undefined;
  if (!jwk) {
    // Unknown kid: the provider may have rotated keys. Refetch once.
    const { keys } = await getJson<{ keys: JsonWebKey[] }>(jwksUri, fetcher);
    cached = { at: Date.now(), keys };
    jwksCache.set(jwksUri, cached);
    jwk = pick(keys);
  }
  if (!jwk) throw new Error("OIDC: no signing key for this token");
  return createPublicKey({ key: jwk, format: "jwk" });
}

/** Verify signature and claims of an ID token. Throws on any problem. */
export async function verifyIdToken(
  idToken: string,
  cfg: OidcConfig,
  expectedNonce: string,
  fetcher: typeof fetch = fetch,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<IdClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("OIDC: malformed ID token");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; kid?: string };
  const alg = header.alg ? ALGS[header.alg] : undefined;
  if (!alg) throw new Error(`OIDC: unsupported alg ${header.alg}`); // never "none" or HS*
  const doc = await discover(cfg.issuer, fetcher);
  const key = await signingKey(doc.jwks_uri, header.kid, fetcher);
  const ok = verifySignature(
    alg.hash,
    Buffer.from(`${parts[0]}.${parts[1]}`),
    alg.dsa ? { key, dsaEncoding: "ieee-p1363" } : alg.padding === "pss" ? { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 } : key,
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new Error("OIDC: bad ID token signature");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as IdClaims;
  if (claims.iss.replace(/\/$/, "") !== cfg.issuer) throw new Error("OIDC: issuer mismatch");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) throw new Error("OIDC: audience mismatch");
  if (aud.length > 1 && claims.azp !== cfg.clientId) throw new Error("OIDC: azp mismatch");
  if (typeof claims.exp !== "number" || claims.exp < nowSec - 60) throw new Error("OIDC: token expired");
  if (typeof claims.iat !== "number" || claims.iat > nowSec + 300) throw new Error("OIDC: token issued in the future");
  if (!claims.nonce || claims.nonce !== expectedNonce) throw new Error("OIDC: nonce mismatch");
  return claims;
}

/** Exchange the authorization code; returns the verified ID-token claims. */
export async function exchangeCode(
  cfg: OidcConfig,
  code: string,
  verifier: string,
  nonce: string,
  fetcher: typeof fetch = fetch,
): Promise<IdClaims> {
  const doc = await discover(cfg.issuer, fetcher);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
    ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
  });
  const res = await fetcher(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !json.id_token) throw new Error(`OIDC: token exchange failed (${json.error ?? res.status})`);
  return verifyIdToken(json.id_token, cfg, nonce, fetcher);
}

export function emailVerified(claims: IdClaims): boolean {
  return claims.email_verified === true || claims.email_verified === "true";
}
