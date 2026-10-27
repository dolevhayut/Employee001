import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// `employee001 login` — personal MCP sign-in (device code). Starts a sign-in on
// the running app, prints the page and code, waits for a signed-in person to
// approve it there, then stores the session for `employee001 mcp`.

/** @param {Record<string, string | undefined>} [env] */
export function sessionFilePath(env = process.env) {
  return env.EMPLOYEE001_MCP_SESSION_FILE || join(homedir(), ".employee001", "mcp-session.json");
}

/**
 * The stored { url, token, expiresAt } for `mcp`, or null when absent, malformed or expired.
 * @param {Record<string, string | undefined>} [env]
 * @param {number} [now]
 */
export function readStoredSession(env = process.env, now = Date.now()) {
  try {
    const file = sessionFilePath(env);
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (typeof data?.url !== "string" || typeof data?.token !== "string" || !data.token) return null;
    if (typeof data.expiresAt === "number" && data.expiresAt <= now) return null;
    return { url: data.url, token: data.token, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

function storeSession(session, env) {
  const file = sessionFilePath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

function localPort() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return "3000";
  const match = readFileSync(envPath, "utf8").match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*$/m);
  return match ? match[1] : "3000";
}

/** Accept the app's address or its MCP endpoint; return the app's base URL. */
export function appBase(value) {
  return value.replace(/\/+$/, "").replace(/\/api\/mcp$/, "");
}

async function postJson(fetchFn, url, body) {
  const res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Run the sign-in. Returns { ok: true, file } or { ok: false, message }.
 * The optional dependencies let tests inject fetch, sleep and output.
 * @param {{ base: string, env?: Record<string, string | undefined>, fetchFn?: typeof fetch, sleep?: (ms: number) => Promise<unknown> | void, now?: () => number, write?: (text: string) => unknown }} options
 * @returns {Promise<{ ok: true, file: string } | { ok: false, message: string }>}
 */
export async function runLogin({
  base,
  env = process.env,
  fetchFn = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  write = (s) => process.stdout.write(s),
}) {
  let started;
  try {
    started = await postJson(fetchFn, `${base}/api/mcp/device/start`, {});
  } catch {
    return { ok: false, message: `Employee001 is not running at ${base}. Start it with: npx employee001 start` };
  }
  const info = started.data;
  if (!started.ok || typeof info.device_code !== "string" || typeof info.user_code !== "string") {
    return { ok: false, message: info?.message ?? `Could not start sign-in (HTTP ${started.status}).` };
  }

  write(`\nTo sign in, open:\n\n  ${info.verification_uri_complete ?? info.verification_uri}\n\n`);
  write(`and confirm this code: ${info.user_code}\n`);
  write(`Only approve it if you started this command. Waiting for approval…\n`);

  let intervalMs = Math.max(1, Number(info.interval) || 5) * 1000;
  const deadline = now() + Math.max(1, Number(info.expires_in) || 600) * 1000;
  while (now() < deadline) {
    await sleep(intervalMs);
    let polled;
    try {
      polled = await postJson(fetchFn, `${base}/api/mcp/device/poll`, { device_code: info.device_code });
    } catch {
      return { ok: false, message: "Lost connection to Employee001 while waiting. Run the command again." };
    }
    if (polled.ok && typeof polled.data.access_token === "string") {
      const file = storeSession({ url: `${base}/api/mcp`, token: polled.data.access_token, expiresAt: polled.data.expires_at }, env);
      return { ok: true, file };
    }
    const error = polled.data?.error;
    if (error === "authorization_pending" || error === "rate_limited") continue;
    if (error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (error === "expired_token") return { ok: false, message: "That sign-in expired. Run the command again." };
    return { ok: false, message: polled.data?.message ?? "Sign-in failed. Run the command again." };
  }
  return { ok: false, message: "That sign-in expired. Run the command again." };
}

export default async function login(argv) {
  const urlIndex = argv.indexOf("--url");
  if (urlIndex >= 0 && !argv[urlIndex + 1]) {
    process.stderr.write("Missing value for --url\n");
    process.exitCode = 1;
    return;
  }
  const base = appBase(urlIndex >= 0 ? argv[urlIndex + 1] : process.env.EMPLOYEE001_MCP_URL || `http://127.0.0.1:${localPort()}`);
  const result = await runLogin({ base });
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nSigned in. Session saved to ${result.file}.\n`);
  process.stdout.write("`employee001 mcp` now uses it, as you, when no --token or shared token is set.\n");
}
