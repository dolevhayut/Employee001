import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const users = vi.hoisted(() => ({ list: [] as { id: string; disabled?: boolean }[] }));
vi.mock("./auth/store", () => ({ listUsers: () => users.list }));

import { claudeCodeProblem, compareVersions, findClaudeCli, parseAuthStatus, seatProblem } from "./claude-code-cli";
import { addPersonProblem, canRunModel, claudeCodeExecutable, modelErrorMessage, modelForProvider, providerEnvForAgentSdk, providerLabel } from "./model-provider";
import { buildBaseOptions } from "./sdk-defaults";
import { sdkChildEnv } from "./sdk-env";

let dir: string;
let cli: string;
const saved = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "e001-claude-cli-"));
  cli = path.join(dir, "claude");
  fs.writeFileSync(cli, "#!/bin/sh\n", { mode: 0o755 });
  users.list = [{ id: "owner" }];
});

afterEach(() => {
  process.env = { ...saved };
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("findClaudeCli", () => {
  it("finds claude on PATH, honours the override and returns null when absent", () => {
    expect(findClaudeCli({ PATH: dir, HOME: dir })).toBe(cli);
    expect(findClaudeCli({ PATH: "", HOME: dir, EMPLOYEE001_CLAUDE_PATH: cli })).toBe(cli);
    expect(findClaudeCli({ PATH: dir, HOME: dir, EMPLOYEE001_CLAUDE_PATH: path.join(dir, "missing") })).toBeNull();
    expect(findClaudeCli({ PATH: path.join(dir, "nowhere"), HOME: path.join(dir, "nohome") })).toBeNull();
  });
});

describe("parseAuthStatus / compareVersions", () => {
  it("keeps only sign-in, method and plan", () => {
    const parsed = parseAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max", email: "a@b.c", orgId: "x" }));
    expect(parsed).toEqual({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" });
    expect(parseAuthStatus("not json")).toEqual({ loggedIn: false });
  });

  it("compares dotted versions numerically", () => {
    expect(compareVersions("2.1.258", "2.1.258")).toBe(0);
    expect(compareVersions("2.1.300", "2.1.258")).toBe(1);
    expect(compareVersions("2.0.99", "2.1.0")).toBe(-1);
  });
});

describe("claude-code provider", () => {
  it("never passes a key, token or endpoint to the child", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "claude-code";
    const env = sdkChildEnv(
      { PATH: dir, HOME: dir, ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "http://x", CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_CODE_USE_BEDROCK: "1" },
      providerEnvForAgentSdk(),
    );
    expect(env).toEqual({ PATH: dir, HOME: dir });
  });

  it("runs the user's own claude, and refuses to fall back to the bundled runtime", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "claude-code";
    process.env.PATH = dir;
    expect(claudeCodeExecutable()).toBe(cli);
    expect(buildBaseOptions({ surface: "chat", runId: "r", employeeId: "e" }).pathToClaudeCodeExecutable).toBe(cli);

    process.env.PATH = path.join(dir, "nowhere");
    process.env.HOME = path.join(dir, "nohome");
    expect(() => claudeCodeExecutable()).toThrow(/isn't installed/);
  });

  it("leaves the bundled runtime alone for other providers", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "anthropic";
    expect(claudeCodeExecutable()).toBeUndefined();
    expect(buildBaseOptions({ surface: "chat", runId: "r", employeeId: "e" }).pathToClaudeCodeExecutable).toBeUndefined();
  });

  it("is ready without an API key, and explains what's missing", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "claude-code";
    delete process.env.ANTHROPIC_API_KEY;
    process.env.PATH = dir;
    expect(canRunModel()).toEqual({ ok: true });
    expect(claudeCodeProblem({ installed: true, version: "2.1.300", versionOk: true, loggedIn: false })).toMatch(/isn't signed in/);
    expect(claudeCodeProblem({ installed: true, version: "2.0.1", versionOk: false, loggedIn: true })).toMatch(/claude update/);
    expect(claudeCodeProblem({ installed: true, version: "2.1.300", versionOk: true, loggedIn: true })).toBeNull();

    process.env.PATH = path.join(dir, "nowhere");
    process.env.HOME = path.join(dir, "nohome");
    expect(canRunModel()).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't installed/) });
  });

  it("covers one person: a second active account stops it, and adding people is refused", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "claude-code";
    process.env.PATH = dir;
    expect(addPersonProblem()).toMatch(/covers you alone/);
    users.list = [{ id: "owner" }, { id: "old", disabled: true }];
    expect(seatProblem()).toBeNull();
    users.list = [{ id: "owner" }, { id: "colleague" }];
    expect(canRunModel()).toMatchObject({ ok: false, reason: expect.stringMatching(/covers one person/) });

    process.env.EMPLOYEE001_MODEL_PROVIDER = "anthropic";
    expect(addPersonProblem()).toBeNull();
  });

  it("uses first-party model ids and points sign-in errors at claude", () => {
    process.env.EMPLOYEE001_MODEL_PROVIDER = "claude-code";
    expect(modelForProvider("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(modelErrorMessage("Invalid API key")).toMatch(/Run `claude`/);
    expect(providerLabel("claude-code")).toMatch(/Claude subscription/);
  });
});
