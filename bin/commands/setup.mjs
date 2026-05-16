import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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

  // Explain WHY Composio is required before asking for it. Past users
  // (and other agents) have read the prompt as "tool integrations =
  // optional" and skipped it. It's not optional: it's the input pipeline
  // for the autonomous training loop that generates the 9 profile
  // markdown files for every employee. No Composio → no training → no
  // twins, full stop.
  p.note(
    [
      "For every invite, the CEO chooses a lookback window between 30 and",
      "360 days (default 90). An autonomous Claude agent then studies that",
      "window of the employee's work through Composio MCP — Slack, Gmail,",
      "GitHub PRs, Linear tickets, calendar — and writes the 9 profile",
      "markdown files that define who that twin is and how they think.",
      "",
      "Bigger window = more accurate twin, more API spend, longer wait.",
      "Without Composio there is no training pipeline, and no twins.",
      "That's why the next key is required, not optional.",
    ].join("\n"),
    "How twin training works",
  );

  const composioKey = await p.password({
    message:
      "Composio API key (required — powers the 30-360 day training backfill) — get one at https://app.composio.dev",
    mask: "•",
    validate(value) {
      if (!value) return "A Composio API key is required — no training pipeline without it";
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
    "# Required. Composio MCP powers the autonomous training loop:",
    "# when you onboard an employee, a Claude agent studies the CEO-chosen",
    "# lookback window (30-360 days, default 90) of their work (Slack,",
    "# Gmail, GitHub, Linear, calendar) and writes the 9 profile markdown",
    "# files. Without this key, no twins can be created — twin chat and",
    "# tool execution all depend on it too.",
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
