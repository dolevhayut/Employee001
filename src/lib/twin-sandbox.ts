import "server-only";
import os from "os";
import path from "path";
import { mkdtemp, writeFile } from "fs/promises";
import { spawn, type ChildProcess } from "child_process";
import { isIP } from "net";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import type { CustomMcpServer } from "@/lib/custom-mcp";
import { currentProvider } from "@/lib/model-provider";

const PRIVATE_NETWORKS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "fc00::/7"];
const SYSTEM_SCOPE = "system";
type Env = Record<string, string | undefined>;
type SandboxManager = typeof import("@anthropic-ai/sandbox-runtime").SandboxManager;
type WrappedSandbox = { argv: string[]; env: NodeJS.ProcessEnv };
let launcherPath: string | undefined;
let unavailableReason: string | undefined;
let initializing: Promise<void> | undefined;
const wrappedByScope = new Map<string, WrappedSandbox>();

export function twinSandboxEnabled(env: Env = process.env): boolean { return env.EMPLOYEE001_SANDBOX === "1"; }
function scopeEmployeeId(scope: string): string | null {
  if (scope === SYSTEM_SCOPE) return "system";
  return /^(builder|chat|meeting|routine|relay):([A-Za-z0-9][A-Za-z0-9_-]*)$/.exec(scope)?.[2] ?? null;
}
function localLiterals(url: string | undefined): string[] {
  try {
    const parsed = new URL(url ?? "");
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (hostname !== "localhost" && isIP(hostname) === 0) return [];
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : "");
    if (!port) return [];
    if (hostname === "localhost") return [`127.0.0.1:${port}`, `[::1]:${port}`];
    return [isIP(hostname) === 6 ? `[${hostname}]:${port}` : `${hostname}:${port}`];
  } catch { return []; }
}

/** The policy is deliberately pure so policy changes can be reviewed without SRT installed. */
export function buildTwinSandboxPolicy(env: Env = process.env, customMcp: Pick<CustomMcpServer, "url" | "enabled">[] = [], scope = SYSTEM_SCOPE): SandboxRuntimeConfig {
  const employeeId = scopeEmployeeId(scope);
  if (!employeeId) throw new Error(`Invalid twin sandbox scope: ${scope}`);
  const home = env.HOME || process.env.HOME || ".";
  const appHome = path.resolve(env.EMPLOYEE001_HOME || process.cwd());
  const allowedDomains = new Set<string>(["backend.composio.dev", "*.composio.dev"]);
  const provider = currentProvider(env);
  if (provider === "anthropic" || provider === "claude-code") ["api.anthropic.com", "*.anthropic.com", "claude.ai", "*.claude.ai", "claude.com", "*.claude.com"].forEach((host) => allowedDomains.add(host));
  else if (provider === "bedrock") { const region = env.AWS_REGION || env.AWS_DEFAULT_REGION; if (region) allowedDomains.add(`bedrock-runtime.${region}.amazonaws.com`); allowedDomains.add("*.amazonaws.com"); }
  else if (provider === "vertex") allowedDomains.add("*.googleapis.com");
  else if (provider === "foundry") { const resource = env.ANTHROPIC_FOUNDRY_RESOURCE?.trim(); if (resource) allowedDomains.add(`${resource}.services.ai.azure.com`); }
  else if (provider === "local") {
    const literals = localLiterals(env.ANTHROPIC_BASE_URL);
    if (literals.length) literals.forEach((literal) => allowedDomains.add(literal));
    else try { const host = new URL(env.ANTHROPIC_BASE_URL || "").hostname; if (host) allowedDomains.add(host); } catch { /* validation owns malformed URLs */ }
  }
  for (const server of customMcp) {
    if (!server.enabled) continue;
    const literals = localLiterals(server.url);
    if (literals.length) literals.forEach((literal) => allowedDomains.add(literal));
    else try { const host = new URL(server.url).hostname; if (host) allowedDomains.add(host); } catch { /* validation owns malformed URLs */ }
  }
  return {
    network: { allowedDomains: [...allowedDomains].sort(), deniedDomains: [], deniedResolvedAddresses: PRIVATE_NETWORKS },
    filesystem: {
      allowRead: [path.join(appHome, "data", "scratch", employeeId)],
      denyRead: [
        path.join(home, ".ssh"), path.join(appHome, ".env*"), path.join(appHome, "data", "auth", "**"), path.join(appHome, "data", "invites.json"),
        path.join(appHome, "data", "org", "custom-mcp.json"), path.join(appHome, "data", "telegram-approval-secret"), path.join(appHome, "data", "relay", "**"),
        path.join(appHome, "data", "handovers", "**"), path.join(appHome, "data", "audit*.jsonl"), path.join(appHome, "data", "settings.json"),
        path.join(appHome, "data", "*-secret*"), path.join(appHome, "data", "employees", "*", ".composio.json"), path.join(appHome, "data", "employees", "*", "chat-history.jsonl"),
        path.join(appHome, "data", "scratch", "**"), path.join(appHome, "data", "memory", "**"),
      ],
      allowWrite: [
        path.join(appHome, "data", "scratch", employeeId), ...(scope.startsWith("builder:") ? [path.join(appHome, "data", "employees", employeeId)] : []),
        path.join(home, ".claude"), path.join(home, ".claude.json"), path.join(home, ".claude.json.lock"), env.TMPDIR || process.env.TMPDIR || "/tmp", "/tmp",
      ],
      denyWrite: [
        path.join(home, ".claude", "settings.json"), path.join(home, ".claude", "settings.local.json"), path.join(home, ".claude", "CLAUDE.md"),
        path.join(home, ".claude", "skills"), path.join(home, ".claude", "plugins"), path.join(home, ".claude", "hooks"), path.join(home, ".claude", "agents"),
        path.join(home, ".claude", "commands"), path.join(home, ".claude", "output-styles"), path.join(home, ".claude.json"),
      ],
    },
  };
}
function dependencyError(dependencies: unknown): string { return `Sandbox runtime dependencies are unavailable: ${JSON.stringify(dependencies)}. Install ripgrep on macOS; Linux also requires bubblewrap and socat.`; }
async function writeLauncher(): Promise<string> {
  if (launcherPath) return launcherPath;
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), "employee001-twin-sandbox-")), "launcher.mjs");
  await writeFile(file, `import { spawn } from "node:child_process";
const argv = JSON.parse(process.env.E001_TWIN_ARGV || "[]"); delete process.env.E001_TWIN_ARGV;
if (!Array.isArray(argv) || typeof argv[0] !== "string") throw new Error("E001_TWIN_ARGV must be a command array");
const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("close", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
`, { mode: 0o600 });
  return launcherPath = file;
}
async function allowPublicNetworkHost({ host, port }: { host: string; port?: number }): Promise<boolean> {
  const { appendAuditEntry } = await import("@/lib/audit-log");
  appendAuditEntry({ runId: `sandbox_network_${Date.now()}`, employeeId: "sandbox", employeeName: "Sandbox runtime", toolName: "sandboxNetwork", bareName: "sandboxNetwork", input: { host, port }, verdict: "executed" });
  return true;
}
export async function ensureTwinSandbox(scope = SYSTEM_SCOPE): Promise<void> {
  if (!twinSandboxEnabled()) return;
  if (!scopeEmployeeId(scope)) throw new Error(`Invalid twin sandbox scope: ${scope}`);
  if (wrappedByScope.has(scope)) return;
  if (unavailableReason) throw new Error(unavailableReason);
  if (initializing) await initializing;
  if (wrappedByScope.has(scope)) return;
  initializing = (async () => {
    if (process.platform === "win32") throw new Error("EMPLOYEE001_SANDBOX=1 is unavailable on Windows: upstream sandbox-runtime support is alpha.");
    try {
      const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime") as { SandboxManager: SandboxManager };
      const dependencies = SandboxManager.checkDependencies();
      if (dependencies && typeof dependencies === "object" && "errors" in dependencies && Array.isArray((dependencies as { errors: unknown[] }).errors) && (dependencies as { errors: unknown[] }).errors.length > 0) throw new Error(dependencyError(dependencies));
      const { listCustomMcp } = await import("@/lib/custom-mcp");
      const mcp = await listCustomMcp();
      await SandboxManager.initialize(buildTwinSandboxPolicy(process.env, mcp), allowPublicNetworkHost);
      const policy = buildTwinSandboxPolicy(process.env, mcp, scope);
      const wrapped = await SandboxManager.wrapWithSandboxArgv(`${JSON.stringify(process.execPath)} ${JSON.stringify(await writeLauncher())}`, undefined, policy);
      if (!wrapped.argv.length) throw new Error("Sandbox runtime returned no argv.");
      wrappedByScope.set(scope, wrapped);
      while (wrappedByScope.size > 64) wrappedByScope.delete(wrappedByScope.keys().next().value as string);
    } catch (error) {
      unavailableReason = `EMPLOYEE001_SANDBOX=1 requires the OS sandbox: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(unavailableReason);
    } finally { initializing = undefined; }
  })();
  return initializing;
}
/** Passed to the Agent SDK only after ensureTwinSandbox(scope) resolves. */
export function spawnClaudeCodeProcess(options: SpawnOptions): SpawnedProcess {
  if (!twinSandboxEnabled()) throw new Error("spawnClaudeCodeProcess was requested while EMPLOYEE001_SANDBOX is disabled.");
  const scope = options.env?.E001_SANDBOX_SCOPE;
  if (!scope || !wrappedByScope.has(scope)) throw new Error(unavailableReason || "EMPLOYEE001_SANDBOX=1 is not ready for this scope. Await ensureTwinSandbox(scope) before query().");
  const childEnv = { ...options.env };
  delete childEnv.E001_SANDBOX_SCOPE;
  const wrapped = wrappedByScope.get(scope)!;
  return spawn(wrapped.argv[0], wrapped.argv.slice(1), { cwd: options.cwd, env: { ...wrapped.env, ...childEnv, E001_TWIN_ARGV: JSON.stringify([options.command, ...options.args]) }, signal: options.signal, stdio: ["pipe", "pipe", "pipe"] }) as unknown as ChildProcess as SpawnedProcess;
}
export function twinSandboxStatus(): { status: "off" | "on" | "unavailable"; reason?: string } {
  if (!twinSandboxEnabled()) return { status: "off" };
  return unavailableReason ? { status: "unavailable", reason: unavailableReason } : { status: "on" };
}
