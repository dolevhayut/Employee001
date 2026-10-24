import { describe, expect, it, vi } from "vitest";

const { sandbox, spawn } = vi.hoisted(() => ({
  sandbox: {
    checkDependencies: vi.fn(() => ({ errors: [] })),
    initialize: vi.fn(async () => undefined),
    wrapWithSandboxArgv: vi.fn(async () => ({ argv: ["/bin/bash", "-c", "fixed launcher"], env: { SRT: "1" } })),
  },
  spawn: vi.fn(() => ({ stdin: {}, stdout: {}, stderr: {} })),
}));

vi.mock("@anthropic-ai/sandbox-runtime", () => ({ SandboxManager: sandbox }));
vi.mock("child_process", () => ({ spawn }));

import { buildTwinSandboxPolicy, ensureTwinSandbox, spawnClaudeCodeProcess } from "@/lib/twin-sandbox";

const env = {
  EMPLOYEE001_HOME: "/workspace/employee001",
  HOME: "/Users/ceo",
  TMPDIR: "/private/tmp/employee001",
};

describe("twin sandbox policy", () => {
  it("limits each scope to its own scratch and gives builders only their employee directory", () => {
    const normal = buildTwinSandboxPolicy(env, [], "chat:maya");
    const builder = buildTwinSandboxPolicy(env, [], "builder:maya");
    expect(normal.filesystem.allowWrite).toEqual(expect.arrayContaining([
      "/workspace/employee001/data/scratch/maya",
      "/Users/ceo/.claude",
    ]));
    expect(normal.filesystem.allowRead).toContain("/workspace/employee001/data/scratch/maya");
    expect(normal.filesystem.allowWrite).not.toContain("/workspace/employee001/data/employees/maya");
    expect(builder.filesystem.allowWrite).toContain("/workspace/employee001/data/employees/maya");
  });

  it("denies secrets, relay data, all scratch reads, and Claude Code startup mutations", () => {
    const policy = buildTwinSandboxPolicy(env, [], "routine:maya");
    expect(policy.filesystem.denyRead).toEqual(expect.arrayContaining([
      "/workspace/employee001/data/org/custom-mcp.json",
      "/workspace/employee001/data/telegram-approval-secret",
      "/workspace/employee001/data/relay/**",
      "/workspace/employee001/data/handovers/**",
      "/workspace/employee001/data/audit*.jsonl",
      "/workspace/employee001/data/settings.json",
      "/workspace/employee001/data/*-secret*",
      "/workspace/employee001/data/scratch/**",
    ]));
    expect(policy.filesystem.denyWrite).toEqual(expect.arrayContaining([
      "/Users/ceo/.claude/settings.json",
      "/Users/ceo/.claude/hooks",
      "/Users/ceo/.claude.json",
    ]));
  });

  it("allows a local provider only as a port-qualified IP literal", () => {
    const policy = buildTwinSandboxPolicy({
      ...env,
      EMPLOYEE001_MODEL_PROVIDER: "local",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:11434",
    });
    expect(policy.network.allowedDomains).toContain("127.0.0.1:11434");
    expect(policy.network.deniedResolvedAddresses).toEqual(expect.arrayContaining(["10.0.0.0/8"]));
  });

  it("spawns the cached wrapper argv and keeps untrusted command text out of the shell", async () => {
    const previous = process.env.EMPLOYEE001_SANDBOX;
    process.env.EMPLOYEE001_SANDBOX = "1";
    await ensureTwinSandbox("chat:maya");
    spawnClaudeCodeProcess({
      command: "claude",
      args: ["--system-prompt", "quotes '$' and ".repeat(1000)],
      cwd: "/tmp",
      env: { E001_SANDBOX_SCOPE: "chat:maya", CHILD: "yes" },
      signal: new AbortController().signal,
    });
    expect(sandbox.wrapWithSandboxArgv).toHaveBeenCalledWith(expect.stringContaining("launcher.mjs"), undefined, expect.any(Object));
    expect(spawn).toHaveBeenCalledWith("/bin/bash", ["-c", "fixed launcher"], expect.objectContaining({
      cwd: "/tmp",
      env: expect.objectContaining({
        SRT: "1",
        CHILD: "yes",
        E001_TWIN_ARGV: expect.stringContaining("quotes '$'"),
      }),
    }));
    const spawnOptions = (spawn.mock.calls.at(-1) as unknown as [string, string[], { env: Record<string, string> }])[2];
    expect(spawnOptions.env.E001_SANDBOX_SCOPE).toBeUndefined();
    if (previous === undefined) delete process.env.EMPLOYEE001_SANDBOX;
    else process.env.EMPLOYEE001_SANDBOX = previous;
  });

  it("fails closed when the SDK child did not receive a prepared scope", () => {
    const previous = process.env.EMPLOYEE001_SANDBOX;
    process.env.EMPLOYEE001_SANDBOX = "1";
    expect(() => spawnClaudeCodeProcess({ command: "claude", args: [], env: {}, signal: new AbortController().signal })).toThrow("not ready for this scope");
    if (previous === undefined) delete process.env.EMPLOYEE001_SANDBOX;
    else process.env.EMPLOYEE001_SANDBOX = previous;
  });
});
