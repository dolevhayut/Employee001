import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import semver from "semver";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..", "..");

const COLOR = process.stdout.isTTY
  ? { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", reset: "\x1b[0m", dim: "\x1b[2m" }
  : { red: "", green: "", yellow: "", reset: "", dim: "" };

function ok(label, detail = "") {
  process.stdout.write(`  ${COLOR.green}✓${COLOR.reset} ${label}${detail ? ` ${COLOR.dim}${detail}${COLOR.reset}` : ""}\n`);
}
function warn(label, detail = "") {
  process.stdout.write(`  ${COLOR.yellow}!${COLOR.reset} ${label}${detail ? ` ${COLOR.dim}${detail}${COLOR.reset}` : ""}\n`);
}
function fail(label, detail = "") {
  process.stdout.write(`  ${COLOR.red}✗${COLOR.reset} ${label}${detail ? ` ${COLOR.dim}${detail}${COLOR.reset}` : ""}\n`);
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

async function checkAnthropic(key) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    return res.ok;
  } catch {
    return null;
  }
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** File values win, matching doctor checks; process env fills anything unset. */
function egressConfig() {
  const cwd = process.cwd();
  const file = {
    ...readEnvFile(resolve(cwd, ".env")),
    ...readEnvFile(resolve(cwd, ".env.local")),
  };
  return (key) => {
    const fromFile = file[key];
    if (fromFile) return fromFile;
    return process.env[key] || "";
  };
}

/** Claude Code treats 1 / true / yes / on as on. */
function flagOn(value) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase().trim());
}

/** Hostname only. Drops userinfo, path, query, and headers. */
function hostnameOnly(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    return new URL(withScheme).hostname;
  } catch {
    return "";
  }
}

function isLocalhost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function safeToken(value, fallback) {
  if (/^[A-Za-z0-9._-]{1,64}$/.test(value)) return value;
  return fallback;
}

/**
 * Agent SDK `query()` forwards process env into Claude Code, which routes
 * to Bedrock / Vertex / Foundry when those flags are set. Direct
 * `new Anthropic()` calls stay on ANTHROPIC_BASE_URL or api.anthropic.com.
 */
function modelHosts(get) {
  const direct = hostnameOnly(get("ANTHROPIC_BASE_URL")) || "api.anthropic.com";
  const provider = (get("EMPLOYEE001_MODEL_PROVIDER") || "anthropic").toLowerCase();
  const directAllowed = provider === "anthropic" || get("EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC") === "1";
  const directOn = directAllowed && Boolean(get("ANTHROPIC_API_KEY") || get("ANTHROPIC_AUTH_TOKEN"));

  if (provider === "local") {
    const host = hostnameOnly(get("ANTHROPIC_BASE_URL"));
    return {
      agent: {
        host: host || "<missing local endpoint>",
        on: Boolean(host),
        when: `twin runs (local Anthropic-compatible endpoint${isLocalhost(host) ? "; stays on this machine" : ""})`,
      },
      direct,
      directOn: false,
      directAllowed: false,
    };
  }

  if (flagOn(get("CLAUDE_CODE_USE_BEDROCK"))) {
    const region = safeToken(get("AWS_REGION") || get("AWS_DEFAULT_REGION"), "<region>");
    const host = hostnameOnly(get("ANTHROPIC_BEDROCK_BASE_URL")) || `bedrock-runtime.${region}.amazonaws.com`;
    return { agent: { host, on: true, when: "twin runs (AWS Bedrock)" }, direct, directOn, directAllowed };
  }
  if (flagOn(get("CLAUDE_CODE_USE_VERTEX"))) {
    const region = safeToken(get("CLOUD_ML_REGION"), "global");
    const fallback = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
    const host = hostnameOnly(get("ANTHROPIC_VERTEX_BASE_URL")) || fallback;
    return { agent: { host, on: true, when: "twin runs (Google Vertex AI)" }, direct, directOn, directAllowed };
  }
  if (flagOn(get("CLAUDE_CODE_USE_FOUNDRY"))) {
    const resource = safeToken(get("ANTHROPIC_FOUNDRY_RESOURCE"), "<resource>");
    const host =
      hostnameOnly(get("ANTHROPIC_FOUNDRY_BASE_URL")) || `${resource}.services.ai.azure.com`;
    return { agent: { host, on: true, when: "twin runs (Azure AI Foundry)" }, direct, directOn, directAllowed };
  }
  return {
    agent: { host: direct, on: directOn, when: "twin chat, training, and memory distillation" },
    direct,
    directOn, directAllowed,
  };
}

function customMcpServers() {
  const path = resolve(process.cwd(), "data", "org", "custom-mcp.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.servers)) return parsed.servers;
    return [];
  } catch {
    warn("custom MCP", "data/org/custom-mcp.json could not be read");
    return [];
  }
}

function printEgress() {
  const get = egressConfig();
  const model = modelHosts(get);
  const rows = [];

  rows.push({
    host: model.agent.host,
    sends: "prompts + profile context",
    when: model.agent.when,
    enabled: model.agent.on,
  });
  if (model.agent.host !== model.direct) {
    rows.push({
      host: "Direct Anthropic endpoint",
      sends: "prompts (direct Anthropic SDK: rerank, dreamer, relay)",
      when: model.directAllowed ? `memory rerank, Relay, follow-ups → ${model.direct}` : "disabled in boundary mode (set EMPLOYEE001_ALLOW_DIRECT_ANTHROPIC=1 to opt in)",
      enabled: model.directOn,
    });
  }

  const composioHost = hostnameOnly(get("COMPOSIO_BASE_URL")) || "backend.composio.dev";
  rows.push({
    host: composioHost,
    sends: "tool calls + OAuth",
    when: "when COMPOSIO_API_KEY is set",
    enabled: Boolean(get("COMPOSIO_API_KEY")),
  });

  const memoryOn = get("TWIN_MEMORY_ENABLED").toLowerCase() !== "false";
  rows.push({
    host: "api.openai.com",
    sends: "embeddings for semantic memory",
    when: "recall and write, if OPENAI_API_KEY is set and TWIN_MEMORY_ENABLED is not false",
    enabled: Boolean(get("OPENAI_API_KEY")) && memoryOn,
  });

  rows.push({
    host: "api.elevenlabs.io",
    sends: "text-to-speech",
    when: "when ELEVENLABS_API_KEY is set",
    enabled: Boolean(get("ELEVENLABS_API_KEY")),
  });

  for (const server of customMcpServers()) {
    if (!server || typeof server !== "object") continue;
    const host = hostnameOnly(server.url);
    if (!host) continue;
    rows.push({
      host,
      sends: "MCP tool calls",
      when: "when this server is enabled in data/org/custom-mcp.json",
      enabled: server.enabled === true,
    });
  }

  const twinsCanRun = model.agent.on || model.directOn;
  rows.push({
    host: "any host",
    sends: "search queries and fetched pages",
    when: "when a twin uses WebSearch or WebFetch",
    enabled: twinsCanRun,
  });

  rows.push({
    host: "api.github.com",
    sends: "release metadata",
    when: "only when you run employee001 update",
    enabled: false,
  });

  const npmHost = hostnameOnly(get("npm_config_registry")) || "registry.npmjs.org";
  rows.push({
    host: npmHost,
    sends: "package tarball",
    when: "only when you run employee001 update",
    enabled: false,
  });

  process.stdout.write("\nOutbound destinations\n");
  process.stdout.write(`  ${COLOR.dim}host · what is sent · when · enabled?${COLOR.reset}\n`);

  let active = 0;
  for (const row of rows) {
    const detail = `${row.sends} · ${row.when} · ${row.enabled ? "yes" : "no"}`;
    if (row.enabled) {
      ok(row.host, detail);
      active++;
    } else {
      warn(row.host, detail);
    }
  }

  const noun = active === 1 ? "destination" : "destinations";
  process.stdout.write(`\n${active} ${noun} active with your current config.\n`);
}

function portFree(port) {
  return new Promise((resolveP) => {
    const s = createServer();
    s.once("error", () => resolveP(false));
    s.once("listening", () => s.close(() => resolveP(true)));
    s.listen(port, "127.0.0.1");
  });
}

export default async function doctor(argv = []) {
  let issues = 0;

  process.stdout.write("\nEmployee001 — doctor\n\n");

  // Node version
  const need = ">=22.0.0";
  if (semver.satisfies(process.version, need)) {
    ok(`Node ${process.version}`, `(need ${need})`);
  } else {
    fail(`Node ${process.version}`, `need ${need}`);
    issues++;
  }

  // .env
  const envPath = resolve(process.cwd(), ".env");
  let env = {};
  if (existsSync(envPath)) {
    env = parseEnv(readFileSync(envPath, "utf8"));
    ok(".env present", envPath);
  } else {
    fail(".env not found", `${envPath} — run \`employee001 setup\``);
    issues++;
  }

  // Provider (settings presence only; doctor never validates customer-cloud credentials).
  const provider = (env.EMPLOYEE001_MODEL_PROVIDER || process.env.EMPLOYEE001_MODEL_PROVIDER || "anthropic").toLowerCase();
  if (["anthropic", "bedrock", "vertex", "foundry", "local"].includes(provider)) ok("Claude provider", provider);
  else { fail("Claude provider", `${provider} is invalid — run \`employee001 setup\``); issues++; }

  // Anthropic key is only required and checked for direct Anthropic API mode.
  const aKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (provider !== "anthropic") {
    const configured = provider === "bedrock" ? env.AWS_REGION || process.env.AWS_REGION : provider === "vertex" ? (env.CLOUD_ML_REGION || process.env.CLOUD_ML_REGION) && (env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.ANTHROPIC_VERTEX_PROJECT_ID) : provider === "foundry" ? env.ANTHROPIC_FOUNDRY_RESOURCE || process.env.ANTHROPIC_FOUNDRY_RESOURCE : (env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL) && (env.ANTHROPIC_DEFAULT_OPUS_MODEL || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) && (env.ANTHROPIC_DEFAULT_SONNET_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) && (env.ANTHROPIC_DEFAULT_HAIKU_MODEL || process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
    if (configured) ok("Customer-cloud settings", "present (credentials are not checked)");
    else { fail("Customer-cloud settings", "missing — run `employee001 setup`"); issues++; }
  } else if (!aKey) {
    fail("ANTHROPIC_API_KEY", "not set — required");
    issues++;
  } else {
    const reachable = await checkAnthropic(aKey);
    if (reachable === true) ok("ANTHROPIC_API_KEY", "authenticated against api.anthropic.com");
    else if (reachable === false) {
      fail("ANTHROPIC_API_KEY", "rejected by api.anthropic.com");
      issues++;
    } else warn("ANTHROPIC_API_KEY", "set, but couldn't reach api.anthropic.com to verify");
  }

  // Composio (required — powers the 30-360 day twin-training backfill, default 90)
  if (env.COMPOSIO_API_KEY) ok("COMPOSIO_API_KEY", "set");
  else {
    fail(
      "COMPOSIO_API_KEY",
      "not set — required. Powers the autonomous training pipeline (30-360 day Composio backfill, default 90) that writes the 9 profile files per employee.",
    );
    issues++;
  }

  // ElevenLabs (optional)
  if (env.ELEVENLABS_API_KEY) ok("ELEVENLABS_API_KEY", "set");
  else warn("ELEVENLABS_API_KEY", "not set — twin voices disabled");

  // Bind + access token
  const bind = env.EMPLOYEE001_BIND ?? process.env.EMPLOYEE001_BIND ?? "127.0.0.1";
  const isLoopback = bind === "127.0.0.1" || bind === "::1" || bind === "localhost" || bind === "";
  const token = env.EMPLOYEE001_TOKEN || process.env.EMPLOYEE001_TOKEN;
  if (isLoopback) {
    ok(`Bind ${bind}`, "loopback — local-only, no access token required");
    if (token) ok("EMPLOYEE001_TOKEN", "set (unused on loopback, ready if you flip to 0.0.0.0)");
  } else {
    warn(`Bind ${bind}`, "exposed beyond loopback — use a firewall or Tailscale");
    if (token && token.length >= 16) ok("EMPLOYEE001_TOKEN", `set (${token.length} chars)`);
    else if (token) {
      fail("EMPLOYEE001_TOKEN", `too short (${token.length} chars) — regenerate with setup`);
      issues++;
    } else {
      fail("EMPLOYEE001_TOKEN", "not set — proxy will refuse every request on a non-loopback bind");
      issues++;
    }
  }

  // data/ writable
  const dataDir = resolve(process.cwd(), "data");
  if (!existsSync(dataDir)) {
    try {
      mkdirSync(dataDir, { recursive: true });
      ok("data/", "created");
    } catch (err) {
      fail("data/", `cannot create: ${err.message}`);
      issues++;
    }
  } else {
    try {
      accessSync(dataDir, constants.W_OK);
      const sz = statSync(dataDir);
      ok("data/", `writable (dir, ${sz.mode.toString(8)})`);
    } catch {
      fail("data/", "exists but not writable");
      issues++;
    }
  }

  // Port
  const port = Number(env.PORT ?? 3000);
  const free = await portFree(port);
  if (free) ok(`Port ${port}`, "free");
  else warn(`Port ${port}`, "in use — `employee001 start` will fail until it's freed");

  // Standalone build
  const server = resolve(PKG_ROOT, ".next", "standalone", "server.js");
  if (existsSync(server)) ok("Standalone build", server);
  else warn("Standalone build", "missing — needed for `employee001 start`");

  // --egress appends this section; the checks above still run.
  if (argv.includes("--egress")) printEgress();

  process.stdout.write("\n");
  if (issues === 0) process.stdout.write("All good.\n");
  else {
    process.stdout.write(`${issues} issue${issues === 1 ? "" : "s"} found.\n`);
    process.exitCode = 1;
  }
}
