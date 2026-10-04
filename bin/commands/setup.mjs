import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as p from "@clack/prompts";

// Claude Code's brand orange (R204 G120 G92 — close to the official wordmark).
// 24-bit ANSI works on every modern terminal we ship to; FORCE_COLOR=0 or a
// non-TTY stdout downgrades it via process.stdout.isTTY check.
const BRAND = "\x1b[38;2;204;120;92m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Figlet "doh" style — same family Claude Code uses for its boot banner.
// Keep the trailing whitespace in each line: it preserves the silhouette.
const BANNER_001 = String.raw`
     000000000          000000000       1111111
   00:::::::::00      00:::::::::00    1::::::1
 00:::::::::::::00  00:::::::::::::00 1:::::::1
0:::::::000:::::::00:::::::000:::::::0111:::::1
0::::::0   0::::::00::::::0   0::::::0   1::::1
0:::::0     0:::::00:::::0     0:::::0   1::::1
0:::::0     0:::::00:::::0     0:::::0   1::::1
0:::::0 000 0:::::00:::::0 000 0:::::0   1::::l
0:::::0 000 0:::::00:::::0 000 0:::::0   1::::l
0:::::0     0:::::00:::::0     0:::::0   1::::l
0:::::0     0:::::00:::::0     0:::::0   1::::l
0::::::0   0::::::00::::::0   0::::::0   1::::l
0:::::::000:::::::00:::::::000:::::::0111::::::111
 00:::::::::::::00  00:::::::::::::00 1::::::::::1
   00:::::::::00      00:::::::::00   1::::::::::1
     000000000          000000000     111111111111
`;

function printBanner() {
  // Respect non-color environments (CI logs, piped output, NO_COLOR convention).
  const wantColor =
    process.stdout.isTTY &&
    process.env.NO_COLOR !== "1" &&
    process.env.FORCE_COLOR !== "0";

  const orange = (s) => (wantColor ? `${BRAND}${s}${RESET}` : s);
  const dim = (s) => (wantColor ? `${DIM}${s}${RESET}` : s);

  process.stdout.write(orange(BANNER_001));

  // Mission lines pulled from the public welcome page + README so the
  // wizard tells you what this thing actually is before asking for keys.
  const lines = [
    "",
    `  ${orange("Your company's organizational brain.")}`,
    "  Agent twins of every person on your team, running on your own machine.",
    `  ${dim("No cloud. No telemetry. Yours to shape.")}`,
    "",
    `  ${dim("Built by")} ${orange("Dolev Hayut")} ${dim("· github.com/dolevhayut/Employee001 · MIT")}`,
    `  ${dim("Get ready for 2030.")}`,
    "",
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

function generateToken() {
  return randomBytes(24).toString("hex");
}

const ENV_PATH = resolve(process.cwd(), ".env");
const DATA_DIR = resolve(process.cwd(), "data");

function readExistingEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const text = readFileSync(ENV_PATH, "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

async function validateAnthropicKey(key) {
  if (!key || !key.startsWith("sk-ant-")) return false;
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true; // can't reach network; don't block setup
  }
}

export default async function setup() {
  printBanner();
  p.intro("Employee001 — first-run setup");

  const existing = readExistingEnv();
  if (Object.keys(existing).length > 0) {
    const overwrite = await p.confirm({
      message:
        "A .env already exists in this directory. Overwrite values you change here?",
      initialValue: true,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Setup cancelled. Existing .env left untouched.");
      return;
    }
  }

  const provider = await p.select({
    message: "Where should Claude run?",
    initialValue: existing.EMPLOYEE001_MODEL_PROVIDER ?? "anthropic",
    options: [
      { value: "anthropic", label: "Anthropic API", hint: "Default" },
      { value: "bedrock", label: "AWS Bedrock" },
      { value: "vertex", label: "Google Vertex AI" },
      { value: "foundry", label: "Azure AI Foundry" },
      { value: "local", label: "Local model (offline)", hint: "Evaluation and air-gapped pilots" },
    ],
  });
  if (p.isCancel(provider)) {
    p.cancel("Setup cancelled");
    return;
  }

  let anthropicKey = "";
  let awsRegion = "";
  let vertexRegion = "";
  let vertexProject = "";
  let foundryResource = "";
  let localBaseUrl = "";
  let localAuthToken = "";
  let localOpusModel = "";
  let localSonnetModel = "";
  let localHaikuModel = "";
  if (provider === "anthropic") {
    anthropicKey = await p.password({
      message: "Anthropic API key (required) — get one from https://console.anthropic.com",
      mask: "•",
      validate(value) {
        if (!value) return "An Anthropic API key is required";
        if (!value.startsWith("sk-ant-")) return "Key should start with sk-ant-";
      },
    });
    if (p.isCancel(anthropicKey)) { p.cancel("Setup cancelled"); return; }
    const spin = p.spinner();
    spin.start("Validating Anthropic key against api.anthropic.com…");
    const valid = await validateAnthropicKey(anthropicKey);
    spin.stop(valid ? "Key looks good." : "Key did not authenticate (saving anyway — you can fix it later).");
  } else if (provider === "bedrock") {
    awsRegion = await p.text({ message: "AWS region", initialValue: existing.AWS_REGION ?? "", validate: (v) => v.trim() ? undefined : "AWS region is required" });
  } else if (provider === "vertex") {
    vertexRegion = await p.text({ message: "Google Cloud ML region", initialValue: existing.CLOUD_ML_REGION ?? "", validate: (v) => v.trim() ? undefined : "Google Cloud ML region is required" });
    if (!p.isCancel(vertexRegion)) vertexProject = await p.text({ message: "Google Cloud project ID", initialValue: existing.ANTHROPIC_VERTEX_PROJECT_ID ?? "", validate: (v) => v.trim() ? undefined : "Project ID is required" });
  } else if (provider === "foundry") {
    foundryResource = await p.text({ message: "Azure AI Foundry resource name", initialValue: existing.ANTHROPIC_FOUNDRY_RESOURCE ?? "", validate: (v) => v.trim() ? undefined : "Foundry resource is required" });
  } else {
    p.note(
      "Open-weights models are much weaker than Claude. Tool use may fail, and Hebrew quality may be poor. Use this only for evaluation and air-gapped pilots.",
      "Local model (offline)",
    );
    localBaseUrl = await p.text({
      message: "Anthropic-compatible endpoint URL (required)",
      initialValue: existing.ANTHROPIC_BASE_URL ?? "http://localhost:11434",
      validate(v) {
        try {
          const url = new URL(v.trim());
          return ["http:", "https:"].includes(url.protocol) && url.hostname ? undefined : "Enter an http(s) URL";
        } catch { return "Enter an http(s) URL"; }
      },
    });
    if (!p.isCancel(localBaseUrl)) localAuthToken = await p.password({ message: existing.ANTHROPIC_AUTH_TOKEN ? "Endpoint auth token (optional — leave blank to keep the current one)" : "Endpoint auth token (optional — leave blank if not needed)", mask: "•" });
    if (!p.isCancel(localAuthToken)) localOpusModel = await p.text({ message: "Local Opus-equivalent model ID (required)", initialValue: existing.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "", validate: (v) => v.trim() ? undefined : "A local model ID is required; Employee001 never guesses it" });
    if (!p.isCancel(localOpusModel)) localSonnetModel = await p.text({ message: "Local Sonnet-equivalent model ID (required)", initialValue: existing.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "", validate: (v) => v.trim() ? undefined : "A local model ID is required; Employee001 never guesses it" });
    if (!p.isCancel(localSonnetModel)) localHaikuModel = await p.text({ message: "Local Haiku-equivalent model ID (required)", initialValue: existing.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "", validate: (v) => v.trim() ? undefined : "A local model ID is required; Employee001 never guesses it" });
  }
  if (p.isCancel(awsRegion) || p.isCancel(vertexRegion) || p.isCancel(vertexProject) || p.isCancel(foundryResource) || p.isCancel(localBaseUrl) || p.isCancel(localAuthToken) || p.isCancel(localOpusModel) || p.isCancel(localSonnetModel) || p.isCancel(localHaikuModel)) { p.cancel("Setup cancelled"); return; }

  // Composio is optional at setup time. The Anthropic key alone gets you
  // a working install — you can already hire marketplace agents (Alex
  // Morgan etc.) and chat with them. Composio is only needed when you
  // invite a real employee to onboard their twin (the training pipeline
  // backfills from Slack/Gmail/GitHub/Linear/calendar through Composio
  // MCP). The /employees invite panel surfaces a one-click "add Composio
  // key" affordance the moment you actually need one — no .env edits, no
  // server restart.
  p.note(
    [
      "Composio powers the autonomous training pipeline that builds new",
      "employee twins from 30-360 days of their real work signal (Slack,",
      "Gmail, GitHub, Linear, calendar).",
      "",
      "It's NOT required to get started. You can:",
      "  • Hire any of the 9 marketplace agents (Alex Morgan / SDR, etc.)",
      "    and chat with them right away — they have no training pipeline.",
      "  • Skip Composio now and add the key later from /employees, the",
      "    moment you want to invite a real employee.",
      "",
      "If you already have a Composio key handy, pasting it now saves a",
      "round-trip. Otherwise hit Enter to skip.",
    ].join("\n"),
    "Composio — optional, only for inviting real employees",
  );

  const composioKey = await p.password({
    message:
      "Composio API key (optional — leave blank to add later) — https://app.composio.dev",
    mask: "•",
  });
  if (p.isCancel(composioKey)) {
    p.cancel("Setup cancelled");
    return;
  }

  const elevenLabsKey = await p.password({
    message:
      "ElevenLabs API key (optional, for twin voices) — leave blank to skip",
    mask: "•",
  });
  if (p.isCancel(elevenLabsKey)) {
    p.cancel("Setup cancelled");
    return;
  }

  p.note(
    [
      "An OpenAI key optimizes your agents' memory — they recall the most",
      "relevant context more accurately, so their answers stay sharp and",
      "consistent over time.",
      "",
      "Optional. Everything works without it — this just makes memory better.",
    ].join("\n"),
    "Memory boost — optional",
  );

  const openaiKey = await p.password({
    message:
      "OpenAI API key (optional — sharpens your agents' memory) — leave blank to skip",
    mask: "•",
  });
  if (p.isCancel(openaiKey)) {
    p.cancel("Setup cancelled");
    return;
  }

  const port = await p.text({
    message: "Port for the local server",
    placeholder: "3000",
    initialValue: existing.PORT ?? "3000",
    validate(v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1024 || n > 65535)
        return "Port must be an integer between 1024 and 65535";
    },
  });
  if (p.isCancel(port)) {
    p.cancel("Setup cancelled");
    return;
  }

  const telemetryConsent = await p.confirm({
    message: "Share anonymous usage counts? Off by default; sends counts only, never names, text, emails, hosts, or paths.",
    initialValue: false,
  });
  if (p.isCancel(telemetryConsent)) {
    p.cancel("Setup cancelled");
    return;
  }

  // Always generate (or preserve) an access token. It's a no-op when bound
  // to 127.0.0.1; it becomes the LAN gate the moment the user flips bind to
  // 0.0.0.0, with no second setup step required.
  const token = existing.EMPLOYEE001_TOKEN || generateToken();

  // Local endpoint settings are written only for the local provider: an
  // empty or stale ANTHROPIC_BASE_URL must never redirect Anthropic/cloud runs.
  // Cloud users' hand-set model pins survive a re-run (unless they were local pins).
  const keepPins = provider !== "anthropic" && provider !== "local" && existing.EMPLOYEE001_MODEL_PROVIDER !== "local";
  const pins = provider === "local"
    ? { OPUS: localOpusModel, SONNET: localSonnetModel, HAIKU: localHaikuModel }
    : keepPins
      ? { OPUS: existing.ANTHROPIC_DEFAULT_OPUS_MODEL, SONNET: existing.ANTHROPIC_DEFAULT_SONNET_MODEL, HAIKU: existing.ANTHROPIC_DEFAULT_HAIKU_MODEL }
      : {};
  const localLines = [
    ...(provider === "local"
      ? [
          "# Local Anthropic-compatible endpoint. Use only with operator-supplied model IDs.",
          `ANTHROPIC_BASE_URL=${String(localBaseUrl).trim()}`,
          `ANTHROPIC_AUTH_TOKEN=${localAuthToken || existing.ANTHROPIC_AUTH_TOKEN || ""}`,
        ]
      : []),
    ...Object.entries(pins)
      .filter(([, v]) => v && String(v).trim())
      .map(([family, v]) => `ANTHROPIC_DEFAULT_${family}_MODEL=${String(v).trim()}`),
  ];

  const lines = [
    "# Employee001 — local configuration",
    "# This file is read at startup. Edits take effect on the next `employee001 start`.",
    "",
    "# Claude provider. Use your own cloud account for boundary mode.",
    `EMPLOYEE001_MODEL_PROVIDER=${provider}`,
    "",
    "# Required only for the Anthropic API provider. Get one from https://console.anthropic.com",
    `ANTHROPIC_API_KEY=${anthropicKey}`,
    "# AWS Bedrock: configure standard AWS credentials outside this file.",
    `AWS_REGION=${awsRegion}`,
    "# Google Vertex AI: configure Google Cloud credentials outside this file.",
    `CLOUD_ML_REGION=${vertexRegion}`,
    `ANTHROPIC_VERTEX_PROJECT_ID=${vertexProject}`,
    "# Azure AI Foundry: configure Azure credentials outside this file.",
    `ANTHROPIC_FOUNDRY_RESOURCE=${foundryResource}`,
    ...localLines,
    "",
    "# Optional. Composio MCP powers the autonomous training loop for",
    "# inviting real employees: a Claude agent studies the CEO-chosen",
    "# lookback window (30-360 days, default 90) of their work signal",
    "# (Slack, Gmail, GitHub, Linear, calendar) and writes the 9 profile",
    "# markdown files. Marketplace agents (Alex Morgan etc.) work without",
    "# it. Add the key here later or from /employees when you're ready to",
    "# invite your first real employee.",
    `COMPOSIO_API_KEY=${composioKey ?? ""}`,
    "",
    "# Optional. ElevenLabs for cloned twin voices.",
    `ELEVENLABS_API_KEY=${elevenLabsKey ?? ""}`,
    "",
    "# Optional. Optimizes the twins' memory — more accurate recall of the",
    "# most relevant past context, so answers stay sharp over time. Everything",
    "# works without it (memory falls back to keyword recall).",
    `OPENAI_API_KEY=${openaiKey ?? ""}`,
    "",
    "# Bind address. Default 127.0.0.1 — only this machine can reach the app.",
    "# Set to 0.0.0.0 to expose on your LAN (use a firewall or Tailscale!).",
    `EMPLOYEE001_BIND=${existing.EMPLOYEE001_BIND ?? "127.0.0.1"}`,
    "",
    "# Shared-secret access token. Required when EMPLOYEE001_BIND is non-loopback.",
    "# Ignored when bound to 127.0.0.1. Rotate by deleting and re-running `setup`.",
    `EMPLOYEE001_TOKEN=${token}`,
    "",
    "# Local server port.",
    `PORT=${port}`,
    "",
  ];

  writeFileSync(ENV_PATH, lines.join("\n"), { mode: 0o600 });
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // Consent belongs with other local workspace settings, not in .env. Keep
  // unrelated settings if setup is run again, and only mint an install id
  // when the operator explicitly opted in.
  const settingsPath = resolve(DATA_DIR, "settings.json");
  let settings = {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (parsed && typeof parsed === "object") settings = parsed;
  } catch {
    // First-run or corrupt settings: the safe default below replaces it.
  }
  const existingTelemetry = settings.telemetry && typeof settings.telemetry === "object" ? settings.telemetry : {};
  const telemetry = telemetryConsent
    ? { consent: true, installId: existingTelemetry.installId || randomUUID(), ...(existingTelemetry.lastSentAt ? { lastSentAt: existingTelemetry.lastSentAt } : {}) }
    : { consent: false };
  writeFileSync(settingsPath, JSON.stringify({ ...settings, telemetry }, null, 2) + "\n", { mode: 0o600 });

  p.note(
    [
      `Wrote ${ENV_PATH}`,
      `Created ${DATA_DIR}`,
    ].join("\n"),
    "All set",
  );

  // Offer to launch the server right away — saves a context switch
  // ("now type employee001 start") for the >99% case.
  const startNow = await p.confirm({
    message: `Start Employee001 now? It'll boot on port ${port} and open your browser.`,
    initialValue: true,
  });

  if (p.isCancel(startNow) || !startNow) {
    p.outro(
      [
        "Done. Whenever you're ready:",
        "  employee001 start",
        "",
        "Then open http://localhost:" + port,
      ].join("\n"),
    );
    return;
  }

  p.outro("Booting…");

  // Hand off to the start command in-process. It blocks on the child
  // server until the user hits Ctrl-C, so this is effectively the last
  // thing setup does. Forward whatever CLI flags came in (e.g. --port).
  const start = await import("./start.mjs");
  await start.default([]);
}
