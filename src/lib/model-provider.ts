import "server-only";
import { euRegion, modelResidencyProblem } from "./data-residency";
import { cachedClaudeCliStatus, claudeCodeEnvOverrides, claudeCodeProblem, findClaudeCli, seatProblem } from "./claude-code-cli";

// "claude-code": the user's own signed-in Claude Code (a Claude subscription,
// one person only). See claude-code-cli.ts.
export const MODEL_PROVIDERS = ["anthropic", "claude-code", "bedrock", "vertex", "foundry", "local"] as const;
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
  // EU residency: the direct API processes in the US, so never.
  if (euRegion(env)) return false;
  return currentProvider(env) === "anthropic" || env.EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC === "1";
}

/** Whether the selected model provider has the configuration required to run an Agent SDK call. */
export function canRunModel(env: Env = process.env): { ok: true } | { ok: false; reason: string } {
  const residency = modelResidencyProblem(env);
  if (residency) return { ok: false, reason: residency };
  const required = (keys: string[]) => {
    const missing = keys.filter((key) => !env[key]?.trim());
    return missing.length ? { ok: false as const, reason: `${missing.join(", ")} is not configured` } : { ok: true as const };
  };

  switch (currentProvider(env)) {
    case "anthropic": return required(["ANTHROPIC_API_KEY"]);
    case "claude-code": {
      const reason = claudeCodeProblem(cachedClaudeCliStatus(), env);
      return reason ? { ok: false, reason } : { ok: true };
    }
    case "bedrock": return required(["AWS_REGION"]);
    case "vertex": return required(["CLOUD_ML_REGION", "ANTHROPIC_VERTEX_PROJECT_ID"]);
    case "foundry": return required(["ANTHROPIC_FOUNDRY_RESOURCE"]);
    case "local": {
      const reason = localProviderConfigurationError(env);
      return reason ? { ok: false, reason } : { ok: true };
    }
  }
}

/** Provider flags/settings passed to every Agent SDK child process. Credentials
 * remain inherited. Never add CLAUDE_CODE_USE_ANTHROPIC_AWS: it is not customer Bedrock. */
export function providerEnvForAgentSdk(env: Env = process.env): Env {
  const clear: Env = { CLAUDE_CODE_USE_BEDROCK: undefined, CLAUDE_CODE_USE_VERTEX: undefined, CLAUDE_CODE_USE_FOUNDRY: undefined };
  switch (currentProvider(env)) {
    case "bedrock": return { ...clear, CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: env.AWS_REGION };
    case "vertex": return { ...clear, CLAUDE_CODE_USE_VERTEX: "1", CLOUD_ML_REGION: env.CLOUD_ML_REGION, ANTHROPIC_VERTEX_PROJECT_ID: env.ANTHROPIC_VERTEX_PROJECT_ID };
    case "foundry": return { ...clear, CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_RESOURCE: env.ANTHROPIC_FOUNDRY_RESOURCE };
    case "claude-code": return { ...clear, ...claudeCodeEnvOverrides(env) };
    case "local": {
      // Fail closed: without a valid endpoint the child would fall back to
      // api.anthropic.com. The real Anthropic key is blanked so it is never
      // sent to the local endpoint; Ollama-style servers accept any token.
      const error = localProviderConfigurationError(env);
      if (error) throw new Error(`Local model provider is misconfigured: ${error}. Run \`employee001 setup\`.`);
      return {
        ...clear,
        ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL?.trim(),
        ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN?.trim() || "local",
        ANTHROPIC_API_KEY: "",
      };
    }
    default: return clear;
  }
}

/** The Claude Code executable the Agent SDK should run: the user's own in
 *  claude-code mode, the SDK's bundled one otherwise. */
export function claudeCodeExecutable(env: Env = process.env): string | undefined {
  if (currentProvider(env) !== "claude-code") return undefined;
  // Every model run passes here (providerRuntimeOptions), routines and
  // shifts included: the one-person rule holds even where no route checked.
  const seat = seatProblem(env);
  if (seat) throw new Error(seat);
  const cli = findClaudeCli(env);
  // Never fall back to the bundled runtime here: it would run without the
  // user's sign-in (or with whatever key is around) and bill the wrong way.
  if (!cli) throw new Error("Claude Code isn't installed on this machine. Install it, run `claude` once and sign in, or run `npx employee001 setup`.");
  return cli;
}

/** Why another person can't be added (an account or an employee invite):
 *  a Claude subscription runs on one person's plan, and Anthropic doesn't
 *  allow routing other people's requests through it. Null otherwise. */
export function addPersonProblem(env: Env = process.env): string | null {
  return currentProvider(env) === "claude-code"
    ? "This install runs on your own Claude subscription, which covers you alone. To bring in colleagues, switch to an Anthropic API key or your cloud provider first: run `npx employee001 setup`."
    : null;
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
  const provider = currentProvider(env);
  if (provider === "anthropic" || provider === "claude-code") return model;
  const family = modelFamily(model);
  const override = family ? env[`ANTHROPIC_DEFAULT_${family}_MODEL`] : undefined;
  return override?.trim() || model;
}

/** A failed model run, worded for the person who has to fix it. Auth failures
 *  name the setting to check for the configured provider. */
export function modelErrorMessage(raw: string, env: Env = process.env): string {
  // "· Fix external API key" is Claude Code's own CLI hint; the fix below replaces it.
  const detail = raw.replace(/^anthropic_unavailable:\s*/, "").replace(/\s*·\s*Fix external API key\.?/i, "").trim() || "The model call failed";
  if (!/invalid api key|authenticat|unauthori[sz]ed|\b401\b|credential/i.test(detail)) return detail;
  const provider = currentProvider(env);
  const fix = provider === "anthropic"
    ? "Check ANTHROPIC_API_KEY in .env (or run `npx employee001 setup` again), then restart."
    : provider === "claude-code"
      ? "Run `claude` in a terminal and sign in with your Claude account, then try again."
      : `Check the ${providerLabel(provider)} credentials on this machine, then restart.`;
  return `${detail.replace(/[.\s]+$/, "")}. ${fix}`;
}

export function providerLabel(provider: ModelProvider): string {
  return { anthropic: "Anthropic API", "claude-code": "Claude subscription (Claude Code)", bedrock: "AWS Bedrock", vertex: "Google Vertex AI", foundry: "Azure AI Foundry", local: "Local model (offline)" }[provider];
}
