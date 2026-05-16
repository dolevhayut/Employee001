import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

function portFree(port) {
  return new Promise((resolveP) => {
    const s = createServer();
    s.once("error", () => resolveP(false));
    s.once("listening", () => s.close(() => resolveP(true)));
    s.listen(port, "127.0.0.1");
  });
}

export default async function doctor() {
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

  // Anthropic key
  const aKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!aKey) {
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

  process.stdout.write("\n");
  if (issues === 0) process.stdout.write("All good.\n");
  else {
    process.stdout.write(`${issues} issue${issues === 1 ? "" : "s"} found.\n`);
    process.exitCode = 1;
  }
}
