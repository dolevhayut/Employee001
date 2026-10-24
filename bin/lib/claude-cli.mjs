import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// The CLI side of the "claude-code" model provider (src/lib/claude-code-cli.ts
// is the server side): find the user's own `claude` and read whether it's
// signed in. We only run Anthropic's CLI; we never read or keep its token.

export const MIN_CLAUDE_CODE_VERSION = "2.1.258";

// On Windows only the native installer's claude.exe: npm's claude.cmd shim
// can't be spawned without a shell, by us or by the Agent SDK.
const NAMES = process.platform === "win32" ? ["claude.exe"] : ["claude"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function findClaudeCli(env = process.env) {
  const override = env.EMPLOYEE001_CLAUDE_PATH?.trim();
  if (override) return isFile(override) ? override : null;
  // Git Bash sets HOME to an MSYS path on Windows: ask the OS there.
  const home = process.platform === "win32" ? homedir() : env.HOME || homedir();
  const dirs = [...(env.PATH ?? "").split(delimiter).filter(Boolean), join(home, ".local", "bin"), join(home, ".claude", "local")];
  for (const dir of dirs) for (const name of NAMES) if (isFile(join(dir, name))) return join(dir, name);
  return null;
}

function cliEnv() {
  // Report Claude Code's own sign-in: no key, token, endpoint, provider
  // switch or cloud credential from the shell (same rule as the server).
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if ((/^(ANTHROPIC_|CLAUDE_|AWS_|GOOGLE_|AZURE_|VERTEX_REGION_)/.test(k) || k === "CLOUD_ML_REGION") && k !== "CLAUDE_CONFIG_DIR") delete env[k];
  }
  return env;
}

function runCli(cli, args) {
  try {
    return execFileSync(cli, args, { encoding: "utf8", timeout: 15_000, env: cliEnv(), stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch (err) {
    // `claude auth status` may exit non-zero when signed out but still print JSON.
    return typeof err?.stdout === "string" ? err.stdout : "";
  }
}

function compareVersions(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** { installed, path?, version?, versionOk?, loggedIn?, subscriptionType? } */
export function claudeCliStatus() {
  const cli = findClaudeCli();
  if (!cli) return { installed: false };
  const version = runCli(cli, ["--version"]).trim().split(/\s+/)[0] || undefined;
  const status = { installed: true, path: cli, version, versionOk: version ? compareVersions(version, MIN_CLAUDE_CODE_VERSION) >= 0 : undefined, loggedIn: false };
  try {
    const j = JSON.parse(runCli(cli, ["auth", "status"]));
    status.loggedIn = j.loggedIn === true;
    if (typeof j.subscriptionType === "string") status.subscriptionType = j.subscriptionType;
  } catch {
    /* not signed in, or an old CLI without `auth status` */
  }
  return status;
}

/** "Max", "Pro"… for display. */
export function planLabel(status) {
  const t = status.subscriptionType;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}
