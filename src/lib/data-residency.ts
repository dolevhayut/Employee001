// Data residency and the subprocessors data reaches (SECURITY.md lists them).
//
// EMPLOYEE001_REGION=eu keeps processing in the EU end to end, or turns the
// feature off:
//   - Claude: only Bedrock in an eu-* region, Vertex in a europe-* region, or
//     a local model. The direct Anthropic API (US) is refused, including the
//     direct calls for meeting summaries and combined answers.
//   - Embeddings: only an EMBEDDINGS_BASE_URL you point at an EU or local
//     OpenAI-compatible endpoint; otherwise memory recall is keyword-only and
//     nothing goes to api.openai.com.
//   - Voice (ElevenLabs, including microphone audio): off unless
//     ELEVENLABS_BASE_URL points at an EU-resident endpoint. The browser's
//     speech-recognition fallback (which sends audio to the browser vendor)
//     is off too.
//   - Composio has no region switch: residency warnings name it.
// EMPLOYEE001_VOICE=off turns voice off in any region.

type Env = Record<string, string | undefined>;

export function euRegion(env: Env = process.env): boolean {
  return env.EMPLOYEE001_REGION?.trim().toLowerCase() === "eu";
}

/** Where model calls go, or why the configured provider breaks EU residency. */
export function modelResidencyProblem(env: Env = process.env): string | null {
  if (!euRegion(env)) return null;
  const provider = (env.EMPLOYEE001_MODEL_PROVIDER ?? "anthropic").trim().toLowerCase();
  if (provider === "bedrock") {
    return /^eu-/.test(env.AWS_REGION ?? "") ? null : `EMPLOYEE001_REGION=eu needs an EU AWS_REGION for Bedrock (eu-central-1, eu-west-1…), not "${env.AWS_REGION ?? ""}".`;
  }
  if (provider === "vertex") {
    return /^europe-/.test(env.CLOUD_ML_REGION ?? "") ? null : `EMPLOYEE001_REGION=eu needs a europe-* CLOUD_ML_REGION for Vertex, not "${env.CLOUD_ML_REGION ?? ""}".`;
  }
  if (provider === "local") return null;
  if (provider === "foundry") return null; // the Azure resource's region is the customer's choice
  if (provider === "claude-code") return "EMPLOYEE001_REGION=eu: a Claude subscription processes in the US. Use Bedrock (eu-*), Vertex (europe-*) or a local model.";
  return "EMPLOYEE001_REGION=eu: the direct Anthropic API processes in the US. Use Bedrock (eu-*), Vertex (europe-*) or a local model.";
}

/** The embeddings endpoint, or null when embeddings must stay off. */
export function embeddingsEndpoint(env: Env = process.env): { url: string; key?: string } | null {
  const base = env.EMBEDDINGS_BASE_URL?.trim().replace(/\/$/, "");
  if (base) return { url: `${base}/embeddings`, key: env.EMBEDDINGS_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined };
  if (euRegion(env)) return null;
  return env.OPENAI_API_KEY ? { url: "https://api.openai.com/v1/embeddings", key: env.OPENAI_API_KEY } : null;
}

export function elevenLabsBase(env: Env = process.env): string {
  return env.ELEVENLABS_BASE_URL?.trim().replace(/\/$/, "") || "https://api.elevenlabs.io";
}

/** Server voice (ElevenLabs TTS + STT) is allowed and configured. */
export function voiceEnabled(env: Env = process.env): boolean {
  if (env.EMPLOYEE001_VOICE?.trim().toLowerCase() === "off") return false;
  if (euRegion(env) && !env.ELEVENLABS_BASE_URL?.trim()) return false;
  return Boolean(env.ELEVENLABS_API_KEY);
}

/** Any voice at all, including the browser's speech recognition. */
export function voiceAllowed(env: Env = process.env): boolean {
  if (env.EMPLOYEE001_VOICE?.trim().toLowerCase() === "off") return false;
  return !euRegion(env) || Boolean(env.ELEVENLABS_BASE_URL?.trim());
}

/** Startup warnings: residency gaps and Composio retention. */
export function residencyWarnings(env: Env = process.env): string[] {
  const out: string[] = [];
  const model = modelResidencyProblem(env);
  if (model) out.push(model);
  if (env.COMPOSIO_API_KEY && env.COMPOSIO_ZERO_DATA_RETENTION !== "1") {
    out.push("Composio may retain tool-call inputs and outputs. Enable zero data retention for your Composio project (see SECURITY.md → Composio) and set COMPOSIO_ZERO_DATA_RETENTION=1 to confirm.");
  }
  if (euRegion(env) && env.COMPOSIO_API_KEY) {
    out.push("EMPLOYEE001_REGION=eu: Composio has no EU region option; tool calls through it leave the EU.");
  }
  if (euRegion(env) && env.OPENAI_API_KEY && !env.EMBEDDINGS_BASE_URL) {
    out.push("EMPLOYEE001_REGION=eu: embeddings are off (OPENAI_API_KEY is ignored). Set EMBEDDINGS_BASE_URL to an EU or local endpoint to use them.");
  }
  return out;
}
