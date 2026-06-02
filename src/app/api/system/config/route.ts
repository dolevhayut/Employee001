import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Returns *presence* of each required API key, never the value itself.
// Used by the UI to gate the Invite-employee flow on a fully configured
// install — otherwise the CEO promises a twin to an employee, the
// employee fills out a profile, and the twin can never actually answer
// or take action because no keys are wired up.

export const runtime = "nodejs";

// The historic field names (`anthropic` / `composio` / `elevenLabs`) are kept
// for UI back-compat — they now report the *Microsoft* equivalents:
//
//   anthropic  → Azure OpenAI Foundry reachable (AZURE_OPENAI_ENDPOINT)
//   composio   → Microsoft Graph configured (AZURE_TENANT_ID + AZURE_CLIENT_ID)
//   elevenLabs → Azure Speech configured (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION)
//
// `azure` and `fabric` flags are added for new UIs.
export type SystemConfigStatus = {
  anthropic: boolean;
  composio: boolean;
  elevenLabs: boolean;
  azureOpenAI: boolean;
  microsoftGraph: boolean;
  azureSpeech: boolean;
  fabric: boolean;
  storageBackend: "local" | "fabric";
  /** True iff every *required* key is set. The UI uses this to flip the
   *  Invite button between active and disabled. */
  ready: boolean;
};

const ALLOWED_KEYS = new Set([
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "FABRIC_WORKSPACE_ID",
  "FABRIC_LAKEHOUSE_ID",
  "FABRIC_ONELAKE_PATH",
  "STORAGE_BACKEND",
  // legacy compat — accepted but the runtime no longer reads them
  "ANTHROPIC_API_KEY",
  "COMPOSIO_API_KEY",
  "ELEVENLABS_API_KEY",
]);

export async function GET() {
  const azureOpenAI = Boolean(process.env.AZURE_OPENAI_ENDPOINT);
  const microsoftGraph = Boolean(
    process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID
  );
  const azureSpeech = Boolean(
    process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION
  );
  const fabric = Boolean(
    process.env.FABRIC_WORKSPACE_ID && process.env.FABRIC_ONELAKE_PATH
  );
  const storageBackend: "local" | "fabric" =
    process.env.STORAGE_BACKEND === "fabric" ? "fabric" : "local";
  const ready = azureOpenAI && microsoftGraph;
  const body: SystemConfigStatus = {
    // legacy field aliases
    anthropic: azureOpenAI,
    composio: microsoftGraph,
    elevenLabs: azureSpeech,
    azureOpenAI,
    microsoftGraph,
    azureSpeech,
    fabric,
    storageBackend,
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
 * Writes the key to .env in the process cwd and updates process.env in-memory.
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

  const envPath = path.join(process.cwd(), ".env");

  // Read existing .env or start fresh
  let existing = "";
  try {
    existing = fs.readFileSync(envPath, "utf8");
  } catch {
    // .env doesn't exist yet — that's fine
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
