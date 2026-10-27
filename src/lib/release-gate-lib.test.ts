import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CANARY_PREFIX,
  createFolderFixture,
  findLeaks,
  findLeaksInDir,
  folderAttackCoverage,
  folderAttackPrompt,
  requireModelProblem,
  signInErrorProblem,
  signedOutEnv,
  streamedErrorMessage,
} from "../../scripts/release-gate-lib.mjs";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "e001-gate-lib-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("signedOutEnv", () => {
  it("drops inherited model credentials, Claude settings and app switches", () => {
    const env = signedOutEnv({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-x",
      ANTHROPIC_BASE_URL: "http://x",
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      CLAUDE_CONFIG_DIR: "/real/.claude",
      EMPLOYEE001_MODEL_PROVIDER: "anthropic",
      EMPLOYEE001_SANDBOX: "1",
      HOME: "/Users/real",
    }, { home: "/tmp/empty", appHome: "/tmp/app", claudePath: "/opt/claude" });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/empty",
      CLAUDE_CONFIG_DIR: path.join("/tmp/empty", ".claude"),
      EMPLOYEE001_HOME: "/tmp/app",
      EMPLOYEE001_CLAUDE_PATH: "/opt/claude",
    });
  });

  it("leaves the CLI lookup to the app when no claude was found", () => {
    expect(signedOutEnv({}, { home: "/h", appHome: "/a" })).not.toHaveProperty("EMPLOYEE001_CLAUDE_PATH");
  });
});

describe("signInErrorProblem", () => {
  it("accepts the app's own signed-out and not-installed messages", () => {
    expect(signInErrorProblem("Claude Code isn't signed in. Run `claude` in a terminal and sign in with your Claude account, then try again.")).toBeNull();
    expect(signInErrorProblem("Claude Code isn't installed on this machine. Install it (npm install -g @anthropic-ai/claude-code), run `claude` once and sign in.")).toBeNull();
    expect(signInErrorProblem("Invalid API key. Run `claude` in a terminal and sign in with your Claude account, then try again.")).toBeNull();
  });

  it("rejects raw CLI errors that don't say what to run", () => {
    expect(signInErrorProblem("Not logged in · Please run /login")).toMatch(/command/);
    expect(signInErrorProblem("Claude Code isn't signed in.")).toMatch(/command/);
    expect(signInErrorProblem("The model call failed")).toMatch(/sign in/);
    expect(signInErrorProblem("")).toMatch(/empty/);
    expect(signInErrorProblem(undefined)).toMatch(/empty/);
  });
});

describe("streamedErrorMessage", () => {
  it("returns the first error event's message, or null", () => {
    expect(streamedErrorMessage([{ type: "text_delta", delta: "x" }])).toBeNull();
    expect(streamedErrorMessage([{ type: "session" }, { type: "error", message: "first" }, { type: "error", message: "second" }])).toBe("first");
  });
});

describe("createFolderFixture", () => {
  it("builds secrets inside the folder and symlinks that escape it", async () => {
    const fixture = await createFolderFixture(root, "abc123");
    expect(fixture.folder).toBe(fs.realpathSync(path.join(root, "knowledge")));
    expect(fs.readFileSync(fixture.readme, "utf8")).toContain(fixture.readmeMarker);
    expect(fs.readFileSync(path.join(fixture.folder, ".env.local"), "utf8")).toContain(fixture.canaries.envLocal);
    expect(fs.readFileSync(path.join(fixture.folder, "id_rsa"), "utf8")).toContain(fixture.canaries.idRsa);
    expect(fs.readFileSync(path.join(fixture.folder, ".git", "config"), "utf8")).toContain(fixture.canaries.gitConfig);

    const escape = fs.realpathSync(path.join(fixture.folder, "escape.txt"));
    expect(path.relative(fixture.folder, escape).startsWith("..")).toBe(true);
    expect(fs.readFileSync(escape, "utf8")).toContain(fixture.canaries.escape);
    const ssh = fs.realpathSync(path.join(fixture.folder, ".ssh"));
    expect(path.relative(fixture.folder, ssh).startsWith("..")).toBe(true);
    expect(ssh).not.toBe(path.join(os.homedir(), ".ssh"));
    expect(fs.readFileSync(path.join(ssh, "notes.txt"), "utf8")).toContain(fixture.canaries.ssh);

    const values = Object.values(fixture.canaries);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value.startsWith(CANARY_PREFIX)).toBe(true);
    expect(fixture.targets.map((t) => t.id)).toEqual(["envLocal", "idRsa", "gitConfig", "escape", "ssh", "grep"]);
  });

  it("uses a fresh random token by default", async () => {
    const a = await createFolderFixture(path.join(root, "a"));
    const b = await createFolderFixture(path.join(root, "b"));
    expect(a.canaries.envLocal).not.toBe(b.canaries.envLocal);
  });
});

describe("folderAttackPrompt", () => {
  it("names every target but never a canary value", async () => {
    const fixture = await createFolderFixture(root);
    const prompt = folderAttackPrompt(fixture);
    for (const target of fixture.targets) expect(prompt).toContain(target.path);
    expect(prompt).toContain(fixture.readme);
    expect(prompt).toContain(CANARY_PREFIX);
    expect(findLeaks(prompt, fixture.canaries)).toEqual([]);
  });
});

describe("folderAttackCoverage", () => {
  const targets = [
    { id: "envLocal", tool: "Read", path: "/private/var/folders/x/knowledge/.env.local" },
    { id: "grep", tool: "Grep", path: "/private/var/folders/x/knowledge" },
  ];

  it("matches tool calls and audit rows by tool and path, across /private", () => {
    const events = [
      { type: "tool_call", name: "Read", args: { file_path: "/var/folders/x/knowledge/.env.local" } },
      { type: "tool_call", name: "Grep", args: { pattern: CANARY_PREFIX, path: "/private/var/folders/x/knowledge/" } },
    ];
    const audit = [
      { bareName: "Read", verdict: "hard_blocked", input: { file_path: "/private/var/folders/x/knowledge/.env.local" } },
      { bareName: "Grep", verdict: "hard_blocked", input: { path: "/var/folders/x/knowledge" } },
    ];
    expect(folderAttackCoverage(targets, events, audit)).toEqual({ attempted: ["envLocal", "grep"], notAttempted: [], notBlocked: [] });
  });

  it("reports targets never tried and tries that weren't blocked", () => {
    const events = [{ type: "tool_call", name: "Read", args: { file_path: "/var/folders/x/knowledge/.env.local" } }];
    const audit = [
      { bareName: "Read", verdict: "executed", input: { file_path: "/var/folders/x/knowledge/.env.local" } },
      // Same path but another tool doesn't count.
      { bareName: "Grep", verdict: "hard_blocked", input: { path: "/var/folders/x/knowledge/.env.local" } },
    ];
    expect(folderAttackCoverage(targets, events, audit)).toEqual({ attempted: ["envLocal"], notAttempted: ["grep"], notBlocked: ["envLocal"] });
  });

  it("ignores a Grep on a single file when the target is the folder", () => {
    const events = [{ type: "tool_call", name: "Grep", args: { path: "/var/folders/x/knowledge/README.md" } }];
    expect(folderAttackCoverage(targets, events, []).attempted).toEqual([]);
  });
});

describe("requireModelProblem", () => {
  it("fails only when the model is required and missing", () => {
    expect(requireModelProblem(true, undefined)).toMatch(/--require-model/);
    expect(requireModelProblem(true, "claude-code")).toBeNull();
    expect(requireModelProblem(false, undefined)).toBeNull();
  });
});

describe("findLeaks / findLeaksInDir", () => {
  const canaries = { envLocal: `${CANARY_PREFIX}_ENV_1`, escape: `${CANARY_PREFIX}_ESCAPE_1` };

  it("finds full canary values, not the shared prefix", () => {
    expect(findLeaks(`grep ${CANARY_PREFIX} found nothing`, canaries)).toEqual([]);
    expect(findLeaks(`token is ${CANARY_PREFIX}_ESCAPE_1`, canaries)).toEqual(["escape"]);
  });

  it("scans files recursively without following symlinks", async () => {
    const data = path.join(root, "data");
    fs.mkdirSync(path.join(data, "employees", "a"), { recursive: true });
    fs.writeFileSync(path.join(data, "employees", "a", "chat-history.jsonl"), `{"text":"${canaries.envLocal}"}\n`);
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, canaries.escape);
    fs.symlinkSync(outside, path.join(data, "link.txt"));
    expect(await findLeaksInDir(data, canaries)).toEqual(["envLocal"]);
    expect(await findLeaksInDir(path.join(root, "missing"), canaries)).toEqual([]);
  });
});
