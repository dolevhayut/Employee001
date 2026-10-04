import { afterEach, describe, expect, it } from "vitest";
import {
  currentProvider,
  directAnthropicAllowed,
  modelForProvider,
  providerEnvForAgentSdk,
} from "./model-provider";
import { buildBaseOptions, TWIN_MODEL_PRIMARY } from "./sdk-defaults";

const providerKeys = [
  "EMPLOYEE001_MODEL_PROVIDER", "EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC",
  "AWS_REGION", "CLOUD_ML_REGION", "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_FOUNDRY_RESOURCE", "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
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
    expect(currentProvider({ EMPLOYEE001_MODEL_PROVIDER: "unknown" })).toBe("anthropic");
  });

  it("passes the selected customer-cloud Agent SDK environment", () => {
    expect(providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "bedrock", AWS_REGION: "eu-west-1" })).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "eu-west-1" });
    expect(providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "vertex", CLOUD_ML_REGION: "europe-west1", ANTHROPIC_VERTEX_PROJECT_ID: "acme" })).toMatchObject({ CLAUDE_CODE_USE_VERTEX: "1", CLOUD_ML_REGION: "europe-west1", ANTHROPIC_VERTEX_PROJECT_ID: "acme" });
    expect(providerEnvForAgentSdk({ EMPLOYEE001_MODEL_PROVIDER: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "acme-ai" })).toMatchObject({ CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_RESOURCE: "acme-ai" });
  });

  it("buildBaseOptions forwards the selected provider environment to query", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "bedrock";
    process.env.AWS_REGION = "us-east-1";
    const options = buildBaseOptions({ surface: "chat", runId: "r", employeeId: "e" });
    expect(options.env).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1" });
  });

  it("allows direct Anthropic only for Anthropic or an explicit override", () => {
    expect(directAnthropicAllowed({ EMPLOYEE001_MODEL_PROVIDER: "anthropic" })).toBe(true);
    expect(directAnthropicAllowed({ EMPLOYEE001_MODEL_PROVIDER: "bedrock" })).toBe(false);
    expect(directAnthropicAllowed({ EMPLOYEE001_MODEL_PROVIDER: "vertex", EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC: "1" })).toBe(true);
  });

  it("uses a configured family override only outside Anthropic", () => {
    const cloud = { EMPLOYEE001_MODEL_PROVIDER: "bedrock", ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic.claude-sonnet-provider-id" };
    expect(modelForProvider(TWIN_MODEL_PRIMARY, cloud)).toBe("anthropic.claude-sonnet-provider-id");
    expect(modelForProvider(TWIN_MODEL_PRIMARY, { ...cloud, EMPLOYEE001_MODEL_PROVIDER: "anthropic" })).toBe(TWIN_MODEL_PRIMARY);
    expect(modelForProvider(TWIN_MODEL_PRIMARY, { EMPLOYEE001_MODEL_PROVIDER: "vertex" })).toBe(TWIN_MODEL_PRIMARY);
  });
});
