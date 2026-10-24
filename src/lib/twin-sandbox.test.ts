import { describe, expect, it } from "vitest";
import { buildTwinSandboxPolicy, spawnClaudeCodeProcess, twinSandboxStatus } from "@/lib/twin-sandbox";

describe("twin sandbox policy", () => {
  it("limits filesystem writes and derives provider and custom MCP egress", () => {
    const policy = buildTwinSandboxPolicy(
      {
        EMPLOYEE001_HOME: "/workspace/employee001",
        HOME: "/Users/ceo",
        EMPLOYEE001_MODEL_PROVIDER: "bedrock",
        AWS_REGION: "eu-west-1",
        TMPDIR: "/private/tmp/employee001",
      },
      [
        { enabled: true, url: "https://mcp.example.test/v1" },
        { enabled: false, url: "https://disabled.example.test/mcp" },
      ]
    );

    expect(policy.network.allowedDomains).toEqual(expect.arrayContaining([
      "bedrock-runtime.eu-west-1.amazonaws.com",
      "*.amazonaws.com",
      "backend.composio.dev",
      "*.composio.dev",
      "mcp.example.test",
    ]));
    expect(policy.network.allowedDomains).not.toContain("disabled.example.test");
    expect(policy.network.deniedResolvedAddresses).toContain("192.168.0.0/16");
    expect(policy.filesystem.denyRead).toEqual(expect.arrayContaining([
      "/Users/ceo/.ssh",
      "/workspace/employee001/.env*",
      "/workspace/employee001/data/auth/**",
      "/workspace/employee001/data/invites.json",
      "/workspace/employee001/data/employees/*/chat-history.jsonl",
    ]));
    expect(policy.filesystem.allowWrite).toEqual(expect.arrayContaining([
      "/workspace/employee001/data/employees",
      "/workspace/employee001/data/scratch",
      "/Users/ceo/.claude",
      "/private/tmp/employee001",
    ]));
  });

  it("fails closed when the synchronous SDK spawner runs before initialization", () => {
    const prior = process.env.EMPLOYEE001_SANDBOX;
    process.env.EMPLOYEE001_SANDBOX = "1";
    expect(() => spawnClaudeCodeProcess({ command: "claude", args: [], env: {}, signal: new AbortController().signal })).toThrow("not ready");
    if (prior === undefined) delete process.env.EMPLOYEE001_SANDBOX;
    else process.env.EMPLOYEE001_SANDBOX = prior;
    expect(twinSandboxStatus().status).toBe("off");
  });

  it.skipIf(process.env.SRT_E2E !== "1")("initializes the installed SRT runtime before an integration twin run", async () => {
    const prior = process.env.EMPLOYEE001_SANDBOX;
    process.env.EMPLOYEE001_SANDBOX = "1";
    const { ensureTwinSandbox } = await import("@/lib/twin-sandbox");
    await expect(ensureTwinSandbox()).resolves.toBeUndefined();
    if (prior === undefined) delete process.env.EMPLOYEE001_SANDBOX;
    else process.env.EMPLOYEE001_SANDBOX = prior;
  });

  it("passes the whole command line to bash -c as one word, $ and quotes intact", async () => {
    const { sandboxedCommand } = await import("@/lib/twin-sandbox");
    const { execFileSync } = await import("node:child_process");
    // sandbox-runtime ends its wrap with `/bin/bash -c <command>`; printf stands in for claude.
    const line = sandboxedCommand("/bin/bash -c __EMPLOYEE001_TWIN_COMMAND__", "printf", ["%s|", "--system-prompt", "Max $50k, it's Maya's $' call", "--model", "x"]);
    expect(execFileSync("/bin/sh", ["-c", line], { encoding: "utf8" })).toBe("--system-prompt|Max $50k, it's Maya's $' call|--model|x|");
  });
});
