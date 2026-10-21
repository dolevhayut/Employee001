import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverOAuth, isClientMetadataUrlConfigured, planClientRegistration } from "./mcp-oauth";
import { findPreset, isPresetAvailable, MCP_PRESETS } from "./mcp-presets";

describe("planClientRegistration", () => {
  it("prefers Dynamic Client Registration when the server offers it", () => {
    expect(
      planClientRegistration(
        { registrationEndpoint: "https://auth.example.com/register", clientIdMetadataDocumentSupported: true },
        "https://example.com/oauth/client.json",
      ),
    ).toEqual({ kind: "dcr", registrationEndpoint: "https://auth.example.com/register" });
  });

  it("uses the configured metadata document URL as client_id when DCR is absent", () => {
    expect(
      planClientRegistration(
        { clientIdMetadataDocumentSupported: true },
        "  https://example.com/oauth/client.json ",
      ),
    ).toEqual({ kind: "metadata-document", clientId: "https://example.com/oauth/client.json" });
  });

  it("explains how to configure a metadata document when none is set", () => {
    const plan = planClientRegistration({ clientIdMetadataDocumentSupported: true }, undefined);
    expect(plan.kind).toBe("unsupported");
    if (plan.kind === "unsupported") expect(plan.error).toContain("EMPLOYEE001_OAUTH_CLIENT_METADATA_URL");
  });

  it.each([
    ["http://example.com/client.json"],
    ["https://example.com/"],
    ["https://example.com/client.json#x"],
    ["not a url"],
  ])("rejects an unusable metadata URL: %s", (url) => {
    expect(planClientRegistration({ clientIdMetadataDocumentSupported: true }, url).kind).toBe("unsupported");
  });

  it("refuses when the server supports neither method", () => {
    expect(
      planClientRegistration({ clientIdMetadataDocumentSupported: false }, "https://example.com/client.json").kind,
    ).toBe("unsupported");
  });
});

describe("discoverOAuth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports client metadata document support from the auth server metadata", async () => {
    const docs: Record<string, unknown> = {
      "https://api.elevenlabs.io/.well-known/oauth-protected-resource": {
        authorization_servers: ["https://api.us.elevenlabs.io"],
        scopes_supported: ["text_to_speech"],
      },
      "https://api.us.elevenlabs.io/.well-known/oauth-authorization-server": {
        authorization_endpoint: "https://elevenlabs.io/app/oauth/authorize",
        token_endpoint: "https://api.us.elevenlabs.io/v1/oauth/token",
        code_challenge_methods_supported: ["S256"],
        client_id_metadata_document_supported: true,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url in docs ? Response.json(docs[url]) : new Response("not found", { status: 404 }),
      ),
    );

    const meta = await discoverOAuth("https://api.elevenlabs.io/v1/mcp");
    expect(meta.registrationEndpoint).toBeUndefined();
    expect(meta.clientIdMetadataDocumentSupported).toBe(true);
    expect(meta.scopesSupported).toEqual(["text_to_speech"]);
  });
});

describe("isClientMetadataUrlConfigured", () => {
  it("is true only for a usable https URL with a path", () => {
    expect(isClientMetadataUrlConfigured("https://employee001.dev/oauth/client.json")).toBe(true);
    expect(isClientMetadataUrlConfigured(undefined)).toBe(false);
    expect(isClientMetadataUrlConfigured("  ")).toBe(false);
    expect(isClientMetadataUrlConfigured("http://example.com/client.json")).toBe(false);
    expect(isClientMetadataUrlConfigured("https://example.com/")).toBe(false);
  });
});

describe("MCP presets", () => {
  it("hides ElevenLabs until a client metadata document is configured", () => {
    const p = findPreset("elevenlabs")!;
    expect(p.requires).toBe("client-metadata-document");
    expect(isPresetAvailable(p, { oauthClientMetadataConfigured: false })).toBe(false);
    expect(isPresetAvailable(p, { oauthClientMetadataConfigured: true })).toBe(true);
    expect(p.description).not.toMatch(/no API key|sign in with/i);
  });

  it("keeps presets without requirements available", () => {
    const open = MCP_PRESETS.filter((p) => !p.requires);
    expect(open.length).toBeGreaterThan(0);
    for (const p of open) expect(isPresetAvailable(p, { oauthClientMetadataConfigured: false })).toBe(true);
  });

  it("ships ElevenLabs as an OAuth preset on the hosted endpoint", () => {
    const p = findPreset("elevenlabs");
    expect(p).toMatchObject({ transport: "http", url: "https://api.elevenlabs.io/v1/mcp", auth: "oauth" });
    expect(p?.headerKey).toBeUndefined();
  });

  it("has unique ids and https URLs", () => {
    const ids = MCP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MCP_PRESETS) expect(new URL(p.url).protocol).toBe("https:");
  });
});
