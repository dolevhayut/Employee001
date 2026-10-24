import "server-only";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import type { CustomMcpServer } from "@/lib/custom-mcp";
import { currentProvider } from "@/lib/model-provider";

const PLACEHOLDER = "__EMPLOYEE001_TWIN_COMMAND__";
const PRIVATE_NETWORKS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "fc00::/7"];

type Env = Record<string, string | undefined>;
type SandboxManager = typeof import("@anthropic-ai/sandbox-runtime").SandboxManager;

let wrappedCommand: string | undefined;
let unavailableReason: string | undefined;
let initializing: Promise<void> | undefined;

export function twinSandboxEnabled(env: Env = process.env): boolean {
  return env.EMPLOYEE001_SANDBOX === "1";
}

/** The policy is deliberately pure so policy changes can be reviewed without SRT installed. */
export function buildTwinSandboxPolicy(
  env: Env = process.env,
  customMcp: Pick<CustomMcpServer, "url" | "enabled">[] = []
): SandboxRuntimeConfig {
  const home = env.HOME || process.env.HOME || ".";
  const appHome = path.resolve(env.EMPLOYEE001_HOME || process.cwd());
  const allowedDomains = new Set<string>([
    "backend.composio.dev",
    "*.composio.dev",
  ]);
  const provider = currentProvider(env);
  if (provider === "anthropic" || provider === "claude-code") {
    ["api.anthropic.com", "*.anthropic.com", "claude.ai", "*.claude.ai", "claude.com", "*.claude.com"].forEach((host) => allowedDomains.add(host));
  } else if (provider === "bedrock") {
    const region = env.AWS_REGION || env.AWS_DEFAULT_REGION;
    if (region) allowedDomains.add(`bedrock-runtime.${region}.amazonaws.com`);
    allowedDomains.add("*.amazonaws.com");
  } else if (provider === "vertex") {
    allowedDomains.add("*.googleapis.com");
  } else if (provider === "foundry") {
    const resource = env.ANTHROPIC_FOUNDRY_RESOURCE?.trim();
    if (resource) allowedDomains.add(`${resource}.services.ai.azure.com`);
  } else if (provider === "local") {
    try {
      const host = new URL(env.ANTHROPIC_BASE_URL || "").hostname;
      if (host) allowedDomains.add(host);
    } catch {
      // model-provider.ts gives the user the configuration error before a run.
    }
  }
  for (const server of customMcp) {
    if (!server.enabled) continue;
    try {
      const host = new URL(server.url).hostname;
      if (host) allowedDomains.add(host);
    } catch {
      // Custom MCP validation rejects malformed URLs; keep this boundary defensive.
    }
  }

  return {
    network: {
      allowedDomains: [...allowedDomains].sort(),
      deniedDomains: [],
      deniedResolvedAddresses: PRIVATE_NETWORKS,
    },
    filesystem: {
      denyRead: [
        path.join(home, ".ssh"),
        path.join(appHome, ".env*"),
        path.join(appHome, "data", "auth", "**"),
        path.join(appHome, "data", "invites.json"),
        // Profile markdown remains available to the in-process read policy;
        // credentials, chats and scratch data from every twin do not.
        path.join(appHome, "data", "employees", "*", ".composio.json"),
        path.join(appHome, "data", "employees", "*", "chat-history.jsonl"),
        path.join(appHome, "data", "employees", "*", "scratch", "**"),
        path.join(appHome, "data", "memory", "**"),
      ],
      allowWrite: [
        path.join(appHome, "data", "employees"),
        path.join(appHome, "data", "scratch"),
        path.join(home, ".claude"),
        path.join(home, ".claude.json"),
        path.join(home, ".claude.json.lock"),
        env.TMPDIR || process.env.TMPDIR || "/tmp",
        "/tmp",
      ],
      denyWrite: [],
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function dependencyError(dependencies: unknown): string {
  return `Sandbox runtime dependencies are unavailable: ${JSON.stringify(dependencies)}. Install ripgrep on macOS; Linux also requires bubblewrap and socat.`;
}

async function allowPublicNetworkHost({ host, port }: { host: string; port?: number }): Promise<boolean> {
  const { appendAuditEntry } = await import("@/lib/audit-log");
  appendAuditEntry({
    runId: `sandbox_network_${Date.now()}`,
    employeeId: "sandbox",
    employeeName: "Sandbox runtime",
    toolName: "sandboxNetwork",
    bareName: "sandboxNetwork",
    input: { host, port },
    verdict: "executed",
  });
  return true;
}

export async function ensureTwinSandbox(): Promise<void> {
  if (!twinSandboxEnabled()) return;
  if (wrappedCommand) return;
  if (unavailableReason) throw new Error(unavailableReason);
  if (initializing) return initializing;

  initializing = (async () => {
    if (process.platform === "win32") {
      throw new Error("EMPLOYEE001_SANDBOX=1 is unavailable on Windows: upstream sandbox-runtime support is alpha.");
    }
    try {
      const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime") as { SandboxManager: SandboxManager };
      const dependencies = SandboxManager.checkDependencies();
      if (
        dependencies &&
        typeof dependencies === "object" &&
        "errors" in dependencies &&
        Array.isArray((dependencies as { errors: unknown }).errors) &&
        (dependencies as { errors: unknown[] }).errors.length > 0
      ) {
        throw new Error(dependencyError(dependencies));
      }
      const { listCustomMcp } = await import("@/lib/custom-mcp");
      await SandboxManager.initialize(buildTwinSandboxPolicy(process.env, await listCustomMcp()), allowPublicNetworkHost);
      wrappedCommand = await SandboxManager.wrapWithSandbox(PLACEHOLDER);
      if (!wrappedCommand.includes(PLACEHOLDER)) throw new Error("Sandbox runtime did not preserve the command placeholder.");
    } catch (error) {
      unavailableReason = `EMPLOYEE001_SANDBOX=1 requires the OS sandbox: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(unavailableReason);
    } finally {
      initializing = undefined;
    }
  })();
  return initializing;
}

/** Passed to the Agent SDK only after ensureTwinSandbox() resolves. */
export function spawnClaudeCodeProcess(options: SpawnOptions): SpawnedProcess {
  if (!twinSandboxEnabled()) {
    throw new Error("spawnClaudeCodeProcess was requested while EMPLOYEE001_SANDBOX is disabled.");
  }
  if (!wrappedCommand) {
    throw new Error(unavailableReason || "EMPLOYEE001_SANDBOX=1 is not ready. Await ensureTwinSandbox() before query().");
  }
  const command = [options.command, ...options.args].map(shellQuote).join(" ");
  return spawn(wrappedCommand.replace(PLACEHOLDER, command), [], {
    shell: true,
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    signal: options.signal,
    stdio: ["pipe", "pipe", "pipe"],
  }) as unknown as ChildProcess as SpawnedProcess;
}

export function twinSandboxStatus(): { status: "off" | "on" | "unavailable"; reason?: string } {
  if (!twinSandboxEnabled()) return { status: "off" };
  return unavailableReason ? { status: "unavailable", reason: unavailableReason } : { status: "on" };
}
