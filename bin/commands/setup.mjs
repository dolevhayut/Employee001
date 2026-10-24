import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { createKeychain, KEYCHAIN_PLACEHOLDER, SECRET_NAMES } from "../lib/keychain.mjs";
import { findFreePort, isPortInUse } from "../lib/port.mjs";
import { claudeCliStatus, MIN_CLAUDE_CODE_VERSION, planLabel } from "../lib/claude-cli.mjs";

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
    `  ${dim("Self-hosted: your files stay here; prompts go to the model provider you pick.")}`,
    `  ${dim("Telemetry is off unless you opt in. Yours to shape.")}`,
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

// Resolved per run: the CLI may chdir to EMPLOYEE001_HOME before calling setup.
let ENV_PATH = resolve(process.cwd(), ".env");
let DATA_DIR = resolve(process.cwd(), "data");

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

/**
 * @param {string[]} _argv
 * @param {{ launch?: boolean }} options `launch: false` when `start` invoked
 *   setup: it boots the server itself afterwards, so don't offer to.
 * @returns {Promise<boolean>} whether .env was written
 */
export default async function setup(_argv, { launch = true } = {}) {
  ENV_PATH = resolve(process.cwd(), ".env");
  DATA_DIR = resolve(process.cwd(), "data");
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
      return false;
    }
  }

  // A signed-in Claude Code means the user's subscription can run the twins
  // with no API key, so it's offered first.
  let claude = claudeCliStatus();
  const claudeHint = claude.loggedIn
    ? `Claude Code is signed in${planLabel(claude) ? ` (${planLabel(claude)})` : ""}. No API key needed. Just you, no colleagues`
    : claude.installed
      ? "No API key. Sign in to Claude Code first. Just you, no colleagues"
      : "No API key. Needs Claude Code on this machine. Just you, no colleagues";
  const provider = await p.select({
    message: "Where should Claude run?",
    initialValue: existing.EMPLOYEE001_MODEL_PROVIDER ?? (claude.loggedIn ? "claude-code" : "anthropic"),
    options: [
      { value: "claude-code", label: "Your Claude subscription", hint: claudeHint },
      { value: "anthropic", label: "Anthropic API key", hint: "For a team. Pay per use" },
      { value: "bedrock", label: "AWS Bedrock" },
      { value: "vertex", label: "Google Vertex AI" },
      { value: "foundry", label: "Azure AI Foundry" },
      { value: "local", label: "Local model (offline)", hint: "Evaluation and air-gapped pilots" },
    ],
  });
  if (p.isCancel(provider)) {
    p.cancel("Setup cancelled");
    return false;
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
  if (provider === "claude-code") {
    // Sign-in happens in Claude Code itself (Anthropic's own flow); we never
    // see the account's token.
    while (!claude.installed || !claude.loggedIn || claude.versionOk === false) {
      p.note(
        !claude.installed
          ? ["Install Claude Code, then sign in with your Claude account:", "", "  npm install -g @anthropic-ai/claude-code", "  claude"].join("\n")
          : claude.versionOk === false
            ? [`Claude Code ${claude.version} is too old (needs ${MIN_CLAUDE_CODE_VERSION}+). In another terminal run:`, "", "  claude update"].join("\n")
            : ["In another terminal, run `claude` and sign in with your Claude account (it opens your browser)."].join("\n"),
        "Claude Code",
      );
      const again = await p.confirm({ message: "Done? Check again", initialValue: true });
      if (p.isCancel(again) || !again) { p.cancel("Setup cancelled. Run `npx employee001 setup` again when Claude Code is ready, or pick an API key."); return false; }
      claude = claudeCliStatus();
    }
    p.log.success(`Using your Claude subscription${planLabel(claude) ? ` (${planLabel(claude)})` : ""} through Claude Code ${claude.version ?? ""}.`.replace(" .", "."));
    p.log.info("It covers you alone: to bring in colleagues later, switch to an API key or your cloud.");
  } else if (provider === "anthropic") {
    p.log.info("No key yet? Press Ctrl+C and run `npx employee001 demo`: it needs none.");
    for (;;) {
      anthropicKey = await p.password({
        message: "Anthropic API key (required) — get one from https://console.anthropic.com",
        mask: "•",
        validate(value) {
          if (!value) return "An Anthropic API key is required";
          if (!value.startsWith("sk-ant-")) return "Key should start with sk-ant-";
        },
      });
      if (p.isCancel(anthropicKey)) { p.cancel("Setup cancelled"); return false; }
      const spin = p.spinner();
      spin.start("Validating Anthropic key against api.anthropic.com…");
      const valid = await validateAnthropicKey(anthropicKey);
      if (valid) { spin.stop("Key looks good."); break; }
      spin.stop("Anthropic rejected this key, so twins would fail to answer.");
      const retry = await p.confirm({ message: "Paste a different key?", initialValue: true });
      if (p.isCancel(retry)) { p.cancel("Setup cancelled"); return false; }
      if (!retry) { p.log.warn("Saving it anyway. Fix ANTHROPIC_API_KEY in .env later, then restart."); break; }
    }
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
  if (p.isCancel(awsRegion) || p.isCancel(vertexRegion) || p.isCancel(vertexProject) || p.isCancel(foundryResource) || p.isCancel(localBaseUrl) || p.isCancel(localAuthToken) || p.isCancel(localOpusModel) || p.isCancel(localSonnetModel) || p.isCancel(localHaikuModel)) { p.cancel("Setup cancelled"); return false; }

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
      "  • Hire a marketplace agent from the Hire page (Alex Morgan / SDR",
      "    and more) and chat right away — they have no training pipeline.",
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
    return false;
  }

  const elevenLabsKey = await p.password({
    message:
      "ElevenLabs API key (optional, for twin voices) — leave blank to skip",
    mask: "•",
  });
  if (p.isCancel(elevenLabsKey)) {
    p.cancel("Setup cancelled");
    return false;
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
    return false;
  }

  // 3000 is every dev server's default; catch a clash now instead of at boot.
  // Typing a busy port a second time keeps it (it may be this app, running).
  let suggestedPort = existing.PORT ?? "3000";
  let warnedPort = null;
  let port;
  for (;;) {
    port = await p.text({
      message: "Port for the local server",
      placeholder: "3000",
      initialValue: suggestedPort,
      validate(v) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1024 || n > 65535)
          return "Port must be an integer between 1024 and 65535";
      },
    });
    if (p.isCancel(port)) {
      p.cancel("Setup cancelled");
      return false;
    }
    if (port === warnedPort || !(await isPortInUse(port))) break;
    const free = await findFreePort(Number(port) + 1);
    warnedPort = port;
    if (!free) {
      p.log.warn(`Port ${port} is in use right now. Stop that process before \`employee001 start\`.`);
      break;
    }
    p.log.warn(`Port ${port} is in use right now (another dev server?). ${free} is free; enter ${port} again to keep it.`);
    suggestedPort = String(free);
  }

  const telemetryConsent = await p.confirm({
    message: "Share anonymous usage counts? Off by default; sends counts only, never names, text, emails, hosts, or paths.",
    initialValue: false,
  });
  if (p.isCancel(telemetryConsent)) {
    p.cancel("Setup cancelled");
    return false;
  }

  // Always generate (or preserve) an access token. It's a no-op when bound
  // to 127.0.0.1; it becomes the LAN gate the moment the user flips bind to
  // 0.0.0.0, with no second setup step required.
  const token = existing.EMPLOYEE001_TOKEN || generateToken();
  const secretValues = {
    ANTHROPIC_API_KEY: anthropicKey || (existing.ANTHROPIC_API_KEY === KEYCHAIN_PLACEHOLDER ? KEYCHAIN_PLACEHOLDER : ""),
    COMPOSIO_API_KEY: composioKey || (existing.COMPOSIO_API_KEY === KEYCHAIN_PLACEHOLDER ? KEYCHAIN_PLACEHOLDER : ""),
    ELEVENLABS_API_KEY: elevenLabsKey || (existing.ELEVENLABS_API_KEY === KEYCHAIN_PLACEHOLDER ? KEYCHAIN_PLACEHOLDER : ""),
    OPENAI_API_KEY: openaiKey || (existing.OPENAI_API_KEY === KEYCHAIN_PLACEHOLDER ? KEYCHAIN_PLACEHOLDER : ""),
    EMPLOYEE001_TOKEN: token,
  };
  const keychain = createKeychain();
  const secretsToStore = SECRET_NAMES.filter((name) => secretValues[name] && secretValues[name] !== KEYCHAIN_PLACEHOLDER);
  const keychainFailures = [];
  if (keychain.available && secretsToStore.length) {
    const storeInKeychain = await p.confirm({
      message: `Store API keys in your ${keychain.kind === "linux" ? "system keyring (Secret Service)" : "macOS Keychain"}? (recommended)`,
      initialValue: true,
    });
    if (p.isCancel(storeInKeychain)) { p.cancel("Setup cancelled"); return false; }
    if (storeInKeychain) {
      for (const name of secretsToStore) {
        const value = secretValues[name];
        if (keychain.store(name, value) && keychain.read(name) === value) secretValues[name] = KEYCHAIN_PLACEHOLDER;
        else keychainFailures.push(name);
      }
    }
  }

  // Local endpoint settings are written only for the local provider: an
  // empty or stale ANTHROPIC_BASE_URL must never redirect Anthropic/cloud runs.
  // Cloud users' hand-set model pins survive a re-run (unless they were local pins).
  const keepPins = provider !== "anthropic" && provider !== "claude-code" && provider !== "local" && existing.EMPLOYEE001_MODEL_PROVIDER !== "local";
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
    "# Claude provider: claude-code (your own signed-in Claude Code, one person),",
    "# anthropic, bedrock, vertex, foundry or local. Use your own cloud account for boundary mode.",
    `EMPLOYEE001_MODEL_PROVIDER=${provider}`,
    "",
    "# Required only for the Anthropic API provider. Get one from https://console.anthropic.com",
    `ANTHROPIC_API_KEY=${secretValues.ANTHROPIC_API_KEY}`,
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
    `COMPOSIO_API_KEY=${secretValues.COMPOSIO_API_KEY}`,
    "",
    "# Optional. ElevenLabs for cloned twin voices.",
    `ELEVENLABS_API_KEY=${secretValues.ELEVENLABS_API_KEY}`,
    "",
    "# Optional. Optimizes the twins' memory — more accurate recall of the",
    "# most relevant past context, so answers stay sharp over time. Everything",
    "# works without it (memory falls back to keyword recall).",
    `OPENAI_API_KEY=${secretValues.OPENAI_API_KEY}`,
    "",
    "# Bind address. Default 127.0.0.1 — only this machine can reach the app.",
    "# Set to 0.0.0.0 to expose on your LAN (use a firewall or Tailscale!).",
    `EMPLOYEE001_BIND=${existing.EMPLOYEE001_BIND ?? "127.0.0.1"}`,
    "",
    "# Shared-secret access token. Required when EMPLOYEE001_BIND is non-loopback.",
    "# Ignored when bound to 127.0.0.1. Rotate by deleting and re-running `setup`.",
    `EMPLOYEE001_TOKEN=${secretValues.EMPLOYEE001_TOKEN}`,
    "",
    "# Local server port.",
    `PORT=${port}`,
    "",
  ];

  writeFileSync(ENV_PATH, lines.join("\n"), { mode: 0o600 });
  if (keychainFailures.length) {
    p.note(`Could not store ${keychainFailures.join(", ")} in the OS keychain; those values remain in .env.`, "Keychain");
  }
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

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

  if (!launch) {
    p.outro("Starting Employee001…");
    return true;
  }

  // Offer to launch the server right away — saves a context switch
  // ("now type employee001 start") for the >99% case.
  const startNow = await p.confirm({
    message: `Start Employee001 now? It'll boot on port ${port} and open your browser.`,
    initialValue: true,
  });

  if (p.isCancel(startNow) || !startNow) {
    p.outro(
      [
        "Done. Whenever you're ready, run this in this folder:",
        "  npx employee001",
        "",
        "Then open http://localhost:" + port,
      ].join("\n"),
    );
    return true;
  }

  p.outro("Booting…");

  // Hand off to the start command in-process. It blocks on the child
  // server until the user hits Ctrl-C, so this is effectively the last
  // thing setup does. Forward whatever CLI flags came in (e.g. --port).
  const start = await import("./start.mjs");
  await start.default([]);
  return true;
}
