import "server-only";

export const MODEL_PROVIDERS = ["anthropic", "bedrock", "vertex", "foundry", "local"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
type Env = Record<string, string | undefined>;

function providerFrom(value: string | undefined): ModelProvider {
  return MODEL_PROVIDERS.includes(value as ModelProvider) ? (value as ModelProvider) : "anthropic";
}

/** The provider chosen by `employee001 setup`; missing/invalid is Anthropic. */
export function currentProvider(env: Env = process.env): ModelProvider {
  return providerFrom(env.EMPLOYEE001_MODEL_PROVIDER);
}

/** Direct SDK calls target api.anthropic.com, so boundary mode requires an explicit opt-in. */
export function directAnthropicAllowed(env: Env = process.env): boolean {
  return currentProvider(env) === "anthropic" || env.EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC === "1";
}

/** Provider flags/settings passed to every Agent SDK child process. Credentials
 * remain inherited. Never add CLAUDE_CODE_USE_ANTHROPIC_AWS: it is not customer Bedrock. */
export function providerEnvForAgentSdk(env: Env = process.env): Env {
  const clear: Env = { CLAUDE_CODE_USE_BEDROCK: undefined, CLAUDE_CODE_USE_VERTEX: undefined, CLAUDE_CODE_USE_FOUNDRY: undefined };
  switch (currentProvider(env)) {
    case "bedrock": return { ...clear, CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: env.AWS_REGION };
    case "vertex": return { ...clear, CLAUDE_CODE_USE_VERTEX: "1", CLOUD_ML_REGION: env.CLOUD_ML_REGION, ANTHROPIC_VERTEX_PROJECT_ID: env.ANTHROPIC_VERTEX_PROJECT_ID };
    case "foundry": return { ...clear, CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_RESOURCE: env.ANTHROPIC_FOUNDRY_RESOURCE };
    case "local": return { ...clear, ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN };
    default: return clear;
  }
}

const LOCAL_MODEL_PINS = ["OPUS", "SONNET", "HAIKU"] as const;

/** Local endpoints have provider-specific model IDs. Refuse configuration rather than guessing them. */
export function localProviderConfigurationError(env: Env): string | null {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
  try {
    const url = new URL(baseUrl ?? "");
    if (!baseUrl || !["http:", "https:"].includes(url.protocol) || !url.hostname) {
      return "ANTHROPIC_BASE_URL must be an http(s) URL";
    }
  } catch {
    return "ANTHROPIC_BASE_URL must be an http(s) URL";
  }
  const missing = LOCAL_MODEL_PINS.filter((family) => !env[`ANTHROPIC_DEFAULT_${family}_MODEL`]?.trim());
  return missing.length ? `Local model pins required: ${missing.map((family) => `ANTHROPIC_DEFAULT_${family}_MODEL`).join(", ")}` : null;
}

function modelFamily(model: string): "OPUS" | "SONNET" | "HAIKU" | null {
  if (model.includes("opus")) return "OPUS";
  if (model.includes("sonnet")) return "SONNET";
  if (model.includes("haiku")) return "HAIKU";
  return null;
}

/** Provider IDs differ. Substitute only an operator-supplied Agent SDK override; never guess one. */
export function modelForProvider(model: string, env: Env = process.env): string {
  if (currentProvider(env) === "anthropic") return model;
  const family = modelFamily(model);
  const override = family ? env[`ANTHROPIC_DEFAULT_${family}_MODEL`] : undefined;
  return override?.trim() || model;
}

export function providerLabel(provider: ModelProvider): string {
  return { anthropic: "Anthropic API", bedrock: "AWS Bedrock", vertex: "Google Vertex AI", foundry: "Azure AI Foundry", local: "Local model (offline)" }[provider];
}
