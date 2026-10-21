import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizationUrl, exchangeCode, newAuthRequest, oidcConfig, verifyIdToken, type OidcConfig } from "./oidc";

const ISSUER = "https://idp.example.com";
const cfg: OidcConfig = { issuer: ISSUER, clientId: "e001", redirectUri: "https://e001.example.com/api/auth/oidc/callback", allowedDomains: [] };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };

const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/.well-known/openid-configuration")) {
    return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
  }
  if (url === `${ISSUER}/jwks`) return Response.json({ keys: [jwk] });
  if (url === `${ISSUER}/token`) {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("code") !== "good-code" || !body.get("code_verifier")) return Response.json({ error: "invalid_grant" }, { status: 400 });
    return Response.json({ id_token: token({}) });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const now = Math.floor(Date.now() / 1000);
function token(overrides: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }): string {
  const claims = { iss: ISSUER, sub: "user-1", aud: "e001", exp: now + 300, iat: now, nonce: "n1", email: "noa@acme.com", email_verified: true, ...overrides };
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = header.alg === "none" ? "" : sign("sha256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url");
  return `${h}.${p}.${sig}`;
}

describe("OIDC", () => {
  it("reads its config from env, or is off", () => {
    expect(oidcConfig({})).toBeNull();
    expect(oidcConfig({ EMPLOYEE001_OIDC_ISSUER: `${ISSUER}/`, EMPLOYEE001_OIDC_CLIENT_ID: "e001", APP_URL: "https://x.io" })).toMatchObject({ issuer: ISSUER, redirectUri: "https://x.io/api/auth/oidc/callback" });
  });

  it("builds a PKCE authorization URL", async () => {
    const req = newAuthRequest();
    const url = new URL(await authorizationUrl(cfg, req, fetcher));
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(req.challenge);
    expect(url.searchParams.get("state")).toBe(req.state);
  });

  it("accepts a valid ID token", async () => {
    await expect(verifyIdToken(token({}), cfg, "n1", fetcher)).resolves.toMatchObject({ sub: "user-1", email: "noa@acme.com" });
  });

  it.each([
    ["wrong nonce", token({ nonce: "other" })],
    ["wrong audience", token({ aud: "someone-else" })],
    ["wrong issuer", token({ iss: "https://evil.example.com" })],
    ["expired", token({ exp: now - 3600 })],
    ["alg none", token({}, { alg: "none" })],
    ["HS256", token({}, { alg: "HS256", kid: "k1" })],
    ["unknown key", token({}, { alg: "RS256", kid: "k9" })],
  ])("rejects %s", async (_label, t) => {
    await expect(verifyIdToken(t, cfg, "n1", fetcher)).rejects.toThrow(/OIDC/);
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = token({}).split(".");
    const forged = Buffer.from(JSON.stringify({ iss: ISSUER, sub: "admin", aud: "e001", exp: now + 300, iat: now, nonce: "n1" })).toString("base64url");
    await expect(verifyIdToken(`${h}.${forged}.${s}`, cfg, "n1", fetcher)).rejects.toThrow(/signature/);
  });

  it("exchanges a code with the PKCE verifier", async () => {
    await expect(exchangeCode(cfg, "good-code", "verifier", "n1", fetcher)).resolves.toMatchObject({ sub: "user-1" });
    await expect(exchangeCode(cfg, "bad-code", "verifier", "n1", fetcher)).rejects.toThrow(/invalid_grant/);
  });
});
