import { afterEach, describe, expect, it, vi } from "vitest";

const councilMocks = vi.hoisted(() => ({
  runCouncil: vi.fn(),
}));

vi.mock("@/lib/council-runner", () => ({
  runCouncil: councilMocks.runCouncil,
}));
vi.mock("@/lib/employees-disk", () => ({
  loadEmployeesFromDisk: vi.fn(async () => [{ id: "local-twin", twinStatus: "ready" }]),
}));
vi.mock("@/lib/hired-agents", () => ({ getHiredEmployees: vi.fn(() => []) }));
vi.mock("@/lib/employees-files", () => ({ hasEmployeeFiles: vi.fn(() => true) }));

import { NextRequest } from "next/server";
import { POST as councilChat } from "@/app/api/council/chat/route";
import {
  canRunModel,
  currentProvider,
  directAnthropicAllowed,
  modelForProvider,
  localProviderConfigurationError,
  providerEnvForAgentSdk,
} from "./model-provider";
import { buildBaseOptions, TWIN_MODEL_PRIMARY } from "./sdk-defaults";

const providerKeys = [
  "EMPLOYEE001_MODEL_PROVIDER", "EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC",
  "AWS_REGION", "CLOUD_ML_REGION", "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_FOUNDRY_RESOURCE", "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_API_KEY", "EMPLOYEE001_DEMO", "EMPLOYEE001_DEMO_LIVE",
] as const;
const original = new Map(providerKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("model provider", () => {
  it("resolves only known providers and defaults to Anthropic", () => {
    expect(currentProvider({})).toBe("anthropic");
    expect(currentProvider({ EMPLOYEE001_MODEL_PROVIDER: "vertex" })).toBe("vertex");
    expect(currentProvider({ EMPLOYEE001_MODEL_PROVIDER: "local" })).toBe("local");
    expect(currentProvider({ EMPLOYEE001_MODEL_PROVIDER: "unknown" })).toBe("anthropic");
  });

  it("accepts each configured provider and reports its missing configuration", () => {
    const local = {
      ANTHROPIC_BASE_URL: "http://localhost:11434",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "local-opus",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "local-sonnet",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "local-haiku",
    };

    expect(canRunModel({ ANTHROPIC_API_KEY: "key" })).toEqual({ ok: true });
    expect(canRunModel({})).toEqual({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "bedrock", AWS_REGION: "us-east-1" })).toEqual({ ok: true });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "bedrock" })).toEqual({ ok: false, reason: "AWS_REGION is not configured" });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "vertex", CLOUD_ML_REGION: "us-east5", ANTHROPIC_VERTEX_PROJECT_ID: "project" })).toEqual({ ok: true });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "vertex", CLOUD_ML_REGION: "us-east5" })).toEqual({ ok: false, reason: "ANTHROPIC_VERTEX_PROJECT_ID is not configured" });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "resource" })).toEqual({ ok: true });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "foundry" })).toEqual({ ok: false, reason: "ANTHROPIC_FOUNDRY_RESOURCE is not configured" });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "local", ...local })).toEqual({ ok: true });
    expect(canRunModel({ EMPLOYEE001_MODEL_PROVIDER: "local" })).toEqual({ ok: false, reason: "ANTHROPIC_BASE_URL must be an http(s) URL" });
  });

  it("passes the selected customer-cloud Agent SDK environment", () => {
    expect(providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "bedrock", AWS_REGION: "eu-west-1" })).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "eu-west-1" });
    expect(providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "vertex", CLOUD_ML_REGION: "europe-west1", ANTHROPIC_VERTEX_PROJECT_ID: "acme" })).toMatchObject({ CLAUDE_CODE_USE_VERTEX: "1", CLOUD_ML_REGION: "europe-west1", ANTHROPIC_VERTEX_PROJECT_ID: "acme" });
    expect(providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "acme-ai" })).toMatchObject({ CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_RESOURCE: "acme-ai" });
    const pins = { ANTHROPIC_DEFAULT_OPUS_MODEL: "o", ANTHROPIC_DEFAULT_SONNET_MODEL: "s", ANTHROPIC_DEFAULT_HAIKU_MODEL: "h" };
    expect(providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "local", ANTHROPIC_BASE_URL: "http://127.0.0.1:11434", ANTHROPIC_AUTH_TOKEN: "local-token", ANTHROPIC_API_KEY: "sk-real", ...pins })).toMatchObject({ ANTHROPIC_BASE_URL: "http://127.0.0.1:11434", ANTHROPIC_AUTH_TOKEN: "local-token", ANTHROPIC_API_KEY: "" });
  });

  it("buildBaseOptions forwards the selected provider environment to query", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "bedrock";
    process.env.AWS_REGION = "us-east-1";
    const options = buildBaseOptions({ surface: "chat", runId: "r", employeeId: "e" });
    expect(options.env).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1" });
  });

  it("buildBaseOptions forwards the local endpoint and optional auth token to query", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "local";
    process.env.ANTHROPIC_BASE_URL = "http://localhost:11434";
    process.env.ANTHROPIC_AUTH_TOKEN = "local-token";
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = "o";
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = "s";
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = "h";
    const options = buildBaseOptions({ surface: "chat", runId: "r", employeeId: "e" });
    expect(options.env).toMatchObject({ ANTHROPIC_BASE_URL: "http://localhost:11434", ANTHROPIC_AUTH_TOKEN: "local-token" });
  });

  it("allows direct Anthropic only for Anthropic or an explicit override", () => {
    expect(directAnthropicAllowed({ EMPLOYEE001_MODEL_PROVIDER: "anthropic" })).toBe(true);
    expect(directAnthropicAllowed({ EMPLOYEE001_MODEL_PROVIDER: "bedrock" })).toBe(false);
    expect(directAnthropicAllowed({ EMPLOYEE001_MODEL_PROVIDER: "local" })).toBe(false);
    expect(directAnthropicAllowed({ EMPLOYEE001_MODEL_PROVIDER: "vertex", EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC: "1" })).toBe(true);
  });

  it("uses a configured family override only outside Anthropic", () => {
    const cloud = { EMPLOYEE001_MODEL_PROVIDER: "bedrock", ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic.claude-sonnet-provider-id" };
    expect(modelForProvider(TWIN_MODEL_PRIMARY, cloud)).toBe("anthropic.claude-sonnet-provider-id");
    expect(modelForProvider(TWIN_MODEL_PRIMARY, { ...cloud, EMPLOYEE001_MODEL_PROVIDER: "anthropic" })).toBe(TWIN_MODEL_PRIMARY);
    expect(modelForProvider(TWIN_MODEL_PRIMARY, { EMPLOYEE001_MODEL_PROVIDER: "vertex" })).toBe(TWIN_MODEL_PRIMARY);
  });

  it("fails closed when the local provider is misconfigured", () => {
    expect(() => providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "local", ANTHROPIC_API_KEY: "sk-real" })).toThrow(/misconfigured/);
  });

  it("requires an http(s) endpoint and explicit local model pins", () => {
    expect(localProviderConfigurationError({ ANTHROPIC_BASE_URL: "localhost:11434" })).toBe("ANTHROPIC_BASE_URL must be an http(s) URL");
    expect(localProviderConfigurationError({ ANTHROPIC_BASE_URL: "http://localhost:11434" })).toContain("ANTHROPIC_DEFAULT_SONNET_MODEL");
    expect(localProviderConfigurationError({
      ANTHROPIC_BASE_URL: "http://localhost:11434",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "local-opus",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "local-sonnet",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "local-haiku",
    })).toBeNull();
  });

  it("runs council chat with a configured local provider and no Anthropic key", async () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "local";
    process.env.ANTHROPIC_BASE_URL = "http://localhost:11434";
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = "local-opus";
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = "local-sonnet";
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = "local-haiku";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.EMPLOYEE001_DEMO;
    delete process.env.EMPLOYEE001_DEMO_LIVE;
    councilMocks.runCouncil.mockResolvedValueOnce({ meetingId: "local-meeting" });

    const response = await councilChat(new NextRequest("http://localhost/api/council/chat", {
      method: "POST",
      body: JSON.stringify({ question: "Can the local model respond?", employeeIds: ["local-twin"] }),
    }));

    expect(response.status).toBe(200);
    expect(councilMocks.runCouncil).toHaveBeenCalledOnce();
    expect(await response.text()).toContain('"meetingId":"local-meeting"');
  });
});
