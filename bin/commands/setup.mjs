import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import * as p from "@clack/prompts";

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

  const anthropicKey = await p.password({
    message:
      "Anthropic API key (required) — get one from https://console.anthropic.com",
    mask: "•",
    validate(value) {
      if (!value) return "An Anthropic API key is required";
      if (!value.startsWith("sk-ant-"))
        return "Key should start with sk-ant-";
    },
  });
  if (p.isCancel(anthropicKey)) {
    p.cancel("Setup cancelled");
    return;
  }

  const spin = p.spinner();
  spin.start("Validating Anthropic key against api.anthropic.com…");
  const valid = await validateAnthropicKey(anthropicKey);
  if (valid) {
    spin.stop("Key looks good.");
  } else {
    spin.stop("Key did not authenticate (saving anyway — you can fix it later).");
  }

  const composioKey = await p.password({
    message:
      "Composio API key (required, for Slack/Linear/GitHub MCP integrations) — get one at https://app.composio.dev",
    mask: "•",
    validate(value) {
      if (!value) return "A Composio API key is required";
    },
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

  // Always generate (or preserve) an access token. It's a no-op when bound
  // to 127.0.0.1; it becomes the LAN gate the moment the user flips bind to
  // 0.0.0.0, with no second setup step required.
  const token = existing.EMPLOYEE001_TOKEN || generateToken();

  const lines = [
    "# Employee001 — local configuration",
    "# This file is read at startup. Edits take effect on the next `employee001 start`.",
    "",
    "# Required. Get one from https://console.anthropic.com",
    `ANTHROPIC_API_KEY=${anthropicKey}`,
    "",
    "# Required. Composio MCP — Slack, Linear, GitHub, and 100+ more.",
    `COMPOSIO_API_KEY=${composioKey ?? ""}`,
    "",
    "# Optional. ElevenLabs for cloned twin voices.",
    `ELEVENLABS_API_KEY=${elevenLabsKey ?? ""}`,
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

  p.note(
    [
      `Wrote ${ENV_PATH}`,
      `Created ${DATA_DIR}`,
      "",
      "Next:",
      "  employee001 start",
      "",
      "Then open http://localhost:" + port,
    ].join("\n"),
    "All set",
  );

  p.outro("Done.");
}
