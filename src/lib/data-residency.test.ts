import { describe, expect, it } from "vitest";
import { embeddingsEndpoint, modelResidencyProblem, residencyWarnings, voiceAllowed, voiceEnabled } from "./data-residency";

describe("data residency", () => {
  it("leaves everything as configured outside EU mode", () => {
    expect(modelResidencyProblem({ EMPLOYEE001_MODEL_PROVIDER: "anthropic" })).toBeNull();
    expect(embeddingsEndpoint({ OPENAI_API_KEY: "k" })).toEqual({ url: "https://api.openai.com/v1/embeddings", key: "k" });
    expect(voiceEnabled({ ELEVENLABS_API_KEY: "k" })).toBe(true);
  });

  it("in EU mode refuses the US API and non-EU cloud regions", () => {
    const eu = { EMPLOYEE001_REGION: "eu" };
    expect(modelResidencyProblem({ ...eu })).toMatch(/US/);
    expect(modelResidencyProblem({ ...eu, EMPLOYEE001_MODEL_PROVIDER: "bedrock", AWS_REGION: "us-east-1" })).toMatch(/eu-central-1/);
    expect(modelResidencyProblem({ ...eu, EMPLOYEE001_MODEL_PROVIDER: "bedrock", AWS_REGION: "eu-central-1" })).toBeNull();
    expect(modelResidencyProblem({ ...eu, EMPLOYEE001_MODEL_PROVIDER: "vertex", CLOUD_ML_REGION: "us-east5" })).toMatch(/europe/);
    expect(modelResidencyProblem({ ...eu, EMPLOYEE001_MODEL_PROVIDER: "vertex", CLOUD_ML_REGION: "europe-west1" })).toBeNull();
    expect(modelResidencyProblem({ ...eu, EMPLOYEE001_MODEL_PROVIDER: "local" })).toBeNull();
  });

  it("in EU mode never sends embeddings to api.openai.com", () => {
    expect(embeddingsEndpoint({ EMPLOYEE001_REGION: "eu", OPENAI_API_KEY: "k" })).toBeNull();
    expect(embeddingsEndpoint({ EMPLOYEE001_REGION: "eu", EMBEDDINGS_BASE_URL: "http://localhost:11434/v1/" })).toEqual({ url: "http://localhost:11434/v1/embeddings" });
  });

  it("turns voice off in EU mode without an EU endpoint, or when asked", () => {
    expect(voiceEnabled({ EMPLOYEE001_REGION: "eu", ELEVENLABS_API_KEY: "k" })).toBe(false);
    expect(voiceAllowed({ EMPLOYEE001_REGION: "eu" })).toBe(false);
    expect(voiceEnabled({ EMPLOYEE001_REGION: "eu", ELEVENLABS_API_KEY: "k", ELEVENLABS_BASE_URL: "https://api.eu.example" })).toBe(true);
    expect(voiceEnabled({ EMPLOYEE001_VOICE: "off", ELEVENLABS_API_KEY: "k" })).toBe(false);
    expect(voiceAllowed({ EMPLOYEE001_VOICE: "OFF" })).toBe(false);
  });

  it("warns when Composio zero data retention isn't confirmed", () => {
    expect(residencyWarnings({ COMPOSIO_API_KEY: "c" }).join(" ")).toMatch(/zero data retention/);
    expect(residencyWarnings({ COMPOSIO_API_KEY: "c", COMPOSIO_ZERO_DATA_RETENTION: "1" })).toEqual([]);
  });
});
