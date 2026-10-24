import { NextRequest, NextResponse } from "next/server";
import { voiceAllowed, voiceEnabled } from "@/lib/data-residency";
import { liveVoiceEnabled } from "@/lib/voice-live";
import fs from "fs";
import { envFilePath } from "@/lib/app-home";
import { canRunModel, currentProvider, providerLabel, type ModelProvider } from "@/lib/model-provider";
import { KEYCHAIN_PLACEHOLDER, readKeychainSecret, storeKeychainSecret, type SecretName } from "@/lib/keychain";

// Returns *presence* of each required API key, never the value itself.
// Used by the UI to gate the Invite-employee flow on a fully configured
// install — otherwise the CEO promises a twin to an employee, the
// employee fills out a profile, and the twin can never actually answer
// or take action because no keys are wired up.

export const runtime = "nodejs";

export type SystemConfigStatus = {
  anthropic: boolean;
  composio: boolean;
  elevenLabs: boolean;
  /** Server voice (ElevenLabs TTS/STT) is on and configured. */
  voice: boolean;
  /** Any voice, the browser's speech-recognition fallback included. */
  voiceAllowed: boolean;
  /** Live voice on Ask (Scribe v2 Realtime in, Eleven v4 Turbo out). */
  voiceLive: boolean;
  /** The configured model provider and whether it can run a model. Twin
   *  building runs on it, so non-Anthropic installs need no Anthropic key. */
  modelProvider: ModelProvider;
  modelProviderLabel: string;
  modelReady: boolean;
  modelProblem?: string;
  /** True iff every *required* key is set. The UI uses this to flip the
   *  Invite button between active and disabled. */
  ready: boolean;
};

const ALLOWED_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "COMPOSIO_API_KEY",
  "ELEVENLABS_API_KEY",
]);

export async function GET() {
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const composio = Boolean(process.env.COMPOSIO_API_KEY);
  const elevenLabs = Boolean(process.env.ELEVENLABS_API_KEY);
  const model = canRunModel();
  const modelProvider = currentProvider();
  const ready = model.ok && composio;
  const body: SystemConfigStatus = {
    anthropic,
    composio,
    elevenLabs,
    voice: voiceEnabled(),
    voiceAllowed: voiceAllowed(),
    voiceLive: liveVoiceEnabled(),
    modelProvider,
    modelProviderLabel: providerLabel(modelProvider),
    modelReady: model.ok,
    ...(model.ok ? {} : { modelProblem: model.reason }),
    ready,
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * PATCH /api/system/config
 * Body: { key: "ANTHROPIC_API_KEY" | "COMPOSIO_API_KEY" | "ELEVENLABS_API_KEY", value: string }
 *
 * Writes the key to the configured app home and updates process.env in-memory.
 * The server must be restarted to propagate env changes to all modules that
 * read them at import time (e.g. the Anthropic SDK client).
 */
export async function PATCH(req: NextRequest) {
  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { key, value } = body;
  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: "unknown_key" }, { status: 400 });
  }
  if (typeof value !== "string") {
    return NextResponse.json({ error: "value_required" }, { status: 400 });
  }

  const envPath = envFilePath();

  // Read existing .env or start fresh
  let existing = "";
  try {
    existing = fs.readFileSync(envPath, "utf8");
  } catch {
    // .env doesn't exist yet — that's fine
  }

  const existingMatch = existing.match(new RegExp(`^${key}\\s*=\\s*(.*?)\\s*$`, "m"));
  const existingValue = existingMatch?.[1]?.replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
  if (existingValue === KEYCHAIN_PLACEHOLDER) {
    const secretName = key as SecretName;
    if (!storeKeychainSecret(secretName, value) || readKeychainSecret(secretName) !== value) {
      return NextResponse.json({ error: "keychain_unavailable" }, { status: 503 });
    }
    process.env[key] = value;
    return NextResponse.json({ ok: true, restart_required: true });
  }

  // Replace the key line if it exists, otherwise append
  const escaped = value.replace(/\n/g, "\\n");
  const line = `${key}="${escaped}"`;
  const keyRegex = new RegExp(`^${key}=.*$`, "m");
  const updated = keyRegex.test(existing)
    ? existing.replace(keyRegex, line)
    : existing + (existing.endsWith("\n") || existing === "" ? "" : "\n") + line + "\n";

  fs.writeFileSync(envPath, updated, "utf8");

  // Also update in-memory so the running server benefits immediately
  // (only affects process.env reads — SDK clients re-read at next request)
  process.env[key] = value;

  return NextResponse.json({ ok: true, restart_required: true });
}
