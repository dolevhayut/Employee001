import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listUsers } from "./auth/store";
import { sdkChildEnv } from "./sdk-env";

// The "claude-code" model provider: twins run through the Claude Code the
// user installed and signed in to themselves, so a Claude subscription works
// without an API key. Anthropic's terms allow an end user to sign in to the
// unmodified Claude Code binary with their own subscription; they don't allow
// an app to offer Claude login, to collect or store Claude credentials, or to
// route other people's requests through one person's plan. So:
//   - we only run the user's own `claude` binary; sign-in happens in it;
//   - we never read, pass or store a Claude token (the child env drops them);
//   - it's for one person: with a second active account it stops (seatProblem).

type Env = Record<string, string | undefined>;

/** Oldest Claude Code we've verified the Agent SDK protocol against. */
export const MIN_CLAUDE_CODE_VERSION = "2.1.258";

const NAMES = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The user's `claude` executable: EMPLOYEE001_CLAUDE_PATH, then PATH, then
 *  the native installer's locations. Null when none exists. */
export function findClaudeCli(env: Env = process.env): string | null {
  const override = env.EMPLOYEE001_CLAUDE_PATH?.trim();
  if (override) return isFile(override) ? override : null;
  const home = env.HOME || os.homedir();
  const dirs = [
    ...(env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
  ];
  for (const dir of dirs) {
    for (const name of NAMES) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Env for the CLI and the SDK child in this mode: no API key, no auth token,
 *  no base URL, so Claude Code uses its own sign-in, and never a token we pass. */
export function claudeCodeEnvOverrides(): Env {
  return {
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    ANTHROPIC_BASE_URL: undefined,
    CLAUDE_CODE_OAUTH_TOKEN: undefined,
  };
}

/** Why this mode can't serve the workspace: it covers one person only. */
export function seatProblem(): string | null {
  const active = listUsers().filter((u) => !u.disabled).length;
  return active > 1
    ? "A Claude subscription covers one person, and this workspace has more than one account. Use an Anthropic API key or your cloud provider instead (run `npx employee001 setup`)."
    : null;
}

export type ClaudeCliStatus = {
  installed: boolean;
  path?: string;
  version?: string;
  versionOk?: boolean;
  loggedIn?: boolean;
  /** "claude.ai" for a subscription sign-in. */
  authMethod?: string;
  /** "pro", "max", "team", "enterprise"… */
  subscriptionType?: string;
  error?: string;
};

/** Runs the CLI; a non-zero exit that still printed something returns that
 *  output (`claude auth status` may exit non-zero when signed out). */
function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 15_000, maxBuffer: 1 << 20, env: sdkChildEnv(process.env, claudeCodeEnvOverrides()) as NodeJS.ProcessEnv, windowsHide: true, encoding: "utf8" },
      (err: Error | null, stdout: string) => (err && !stdout.trim() ? reject(err) : resolve(stdout)),
    );
  });
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** Parses `claude auth status` (JSON). Only the fields we show; the email and
 *  org are the user's and aren't kept. */
export function parseAuthStatus(stdout: string): Pick<ClaudeCliStatus, "loggedIn" | "authMethod" | "subscriptionType"> {
  try {
    const j = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
    return {
      loggedIn: j.loggedIn === true,
      authMethod: typeof j.authMethod === "string" ? j.authMethod : undefined,
      subscriptionType: typeof j.subscriptionType === "string" ? j.subscriptionType : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

let cached: { at: number; status: ClaudeCliStatus } | undefined;
const TTL_MS = 30_000;

let inflight: Promise<ClaudeCliStatus> | undefined;

/** The last status we read, if any (canRunModel is synchronous). A stale or
 *  missing one is refreshed in the background for the next caller. */
export function cachedClaudeCliStatus(): ClaudeCliStatus | undefined {
  if (!inflight && (!cached || Date.now() - cached.at >= TTL_MS)) {
    inflight = claudeCliStatus({ fresh: true }).catch(() => cached?.status ?? { installed: false }).finally(() => { inflight = undefined; });
  }
  return cached?.status;
}

/** Whether `claude` is installed, recent enough and signed in. */
export async function claudeCliStatus(opts: { fresh?: boolean } = {}): Promise<ClaudeCliStatus> {
  if (!opts.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.status;
  const cli = findClaudeCli();
  let status: ClaudeCliStatus;
  if (!cli) {
    status = { installed: false };
  } else {
    status = { installed: true, path: cli };
    try {
      status.version = (await run(cli, ["--version"])).trim().split(/\s+/)[0];
      status.versionOk = compareVersions(status.version, MIN_CLAUDE_CODE_VERSION) >= 0;
      Object.assign(status, parseAuthStatus(await run(cli, ["auth", "status"])));
    } catch (err) {
      status.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
      status.loggedIn ??= false;
    }
  }
  cached = { at: Date.now(), status };
  return status;
}

/** What's wrong with this mode right now, worded for the person fixing it. */
export function claudeCodeProblem(status: ClaudeCliStatus | undefined, env: Env = process.env): string | null {
  const seat = seatProblem();
  if (seat) return seat;
  if (!findClaudeCli(env)) return "Claude Code isn't installed on this machine. Install it (npm install -g @anthropic-ai/claude-code), run `claude` once and sign in.";
  if (!status) return null; // not checked yet: let the run report it
  if (status.version && !status.versionOk) return `Claude Code ${status.version} is too old (needs ${MIN_CLAUDE_CODE_VERSION}+). Run \`claude update\`.`;
  if (status.loggedIn === false) return "Claude Code isn't signed in. Run `claude` in a terminal and sign in with your Claude account, then try again.";
  return null;
}
