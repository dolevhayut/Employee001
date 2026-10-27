import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const home = await vi.hoisted(async () => {
  // dataDir() consts are read at import time, so point them at a temp home first.
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "cc-import-"));
  process.env.EMPLOYEE001_HOME = dir;
  return dir;
});

import { applyClaudeCodeImport, ImportChangedError, previewClaudeCodeImport, previewForClient } from "./claude-code-import";
import { sdkChildEnv } from "./sdk-env";

const SECRETS = ["HOOK_SECRET_CMD", "PERMISSION_SECRET_RULE", "ENV_SECRET_VALUE", "CRED_SECRET_TOKEN", "HEADER_SECRET_BEARER", "URLUSER_SECRET", "QUERY_SECRET_KEY", "PATH_SECRET_Zk3j9Qw8Lm2Xv7Rt4Yb6", "JWT_SECRET", "B64_SECRET", "k8f2abc"];
const FORBIDDEN_FILES = ["settings.json", "settings.local.json", ".credentials.json"];

const fixtureRoot = path.join(home, "fixture");
const claudeDir = path.join(fixtureRoot, ".claude");
const EMP = "emp-test";

function put(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  put(path.join(claudeDir, "CLAUDE.md"), "# My habits\nAlways write tests.\n");
  put(path.join(claudeDir, "rules", "style", "ts.md"), "Use strict TypeScript.\n");
  put(path.join(claudeDir, "skills", "pr-review", "SKILL.md"), "---\nname: PR review\ndescription: Review a pull request\n---\n# Steps\nRead the diff.\n");
  put(path.join(claudeDir, "skills", "pr-review", "run.sh"), "echo SCRIPT_NOT_IMPORTED");
  // The four things that must never be read.
  put(path.join(claudeDir, "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ hooks: [{ command: "HOOK_SECRET_CMD" }] }] },
    permissions: { allow: ["PERMISSION_SECRET_RULE"] },
    env: { API_TOKEN: "ENV_SECRET_VALUE" },
  }));
  put(path.join(claudeDir, "settings.local.json"), JSON.stringify({ env: { X: "ENV_SECRET_VALUE" } }));
  put(path.join(claudeDir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "CRED_SECRET_TOKEN" } }));
  put(path.join(fixtureRoot, ".claude.json"), JSON.stringify({
    oauthAccount: { token: "CRED_SECRET_TOKEN" },
    mcpServers: {
      docs: { type: "http", url: "https://docs.example.com/mcp", headers: { Authorization: "HEADER_SECRET_BEARER" }, env: { K: "ENV_SECRET_VALUE" } },
      withtoken: { type: "http", url: "https://user:URLUSER_SECRET@t.example.com/mcp?key=QUERY_SECRET_KEY" },
      pathtoken: { type: "http", url: "https://mcp.example.com/api/mcp/s/PATH_SECRET_Zk3j9Qw8Lm2Xv7Rt4Yb6/mcp" },
      jwtpath: { type: "http", url: "https://mcp.example.com/mcp/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.JWT_SECRET_sig" },
      b64path: { type: "http", url: "https://mcp.example.com/m/B64_SECRET%2Bab%2Fcd%3D%3D" },
      subdomain: { type: "sse", url: "https://k8f2abc.mcp.example.com/sse" },
      events: { type: "sse", url: "https://events.example.com/sse" },
      local: { type: "stdio", command: "node", args: ["x.js"], env: { K: "ENV_SECRET_VALUE" } },
    },
  }));
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function allFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFilesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("import from Claude Code", () => {
  it("previews skills, http/sse MCP servers and CLAUDE.md/rules without writing anything", async () => {
    const before = fs.existsSync(path.join(home, "data")) ? allFilesUnder(path.join(home, "data")).length : 0;
    const p = await previewClaudeCodeImport(EMP, claudeDir);
    expect(p.counts).toEqual({ skills: 1, mcpServers: 2, knowledge: 2 });
    expect(p.items.filter((i) => i.kind === "mcp").map((i) => i.kind === "mcp" && [i.name, i.transport, i.url])).toEqual([
      ["docs", "http", "https://docs.example.com/mcp"],
      ["events", "sse", "https://events.example.com/sse"],
    ]);
    expect(p.skipped.some((s) => s.what === "mcp local")).toBe(true);
    const after = fs.existsSync(path.join(home, "data")) ? allFilesUnder(path.join(home, "data")).length : 0;
    expect(after).toBe(before);
  });

  it("never reads hooks, permissions, env values or credentials (AC3)", async () => {
    const spy = vi.spyOn(fs, "readFileSync");
    const p = await previewClaudeCodeImport(EMP, claudeDir);
    const read = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(read.length).toBeGreaterThan(0);
    for (const f of read) expect(FORBIDDEN_FILES).not.toContain(path.basename(f));

    const shown = JSON.stringify(previewForClient(p)) + JSON.stringify(p);
    for (const s of SECRETS) expect(shown).not.toContain(s);

    await applyClaudeCodeImport({ employeeId: EMP, employeeName: "Tester", sourceDir: claudeDir, previewDigest: p.digest, actorId: "usr_1" });
    const written = allFilesUnder(path.join(home, "data"));
    for (const f of written) {
      const text = fs.readFileSync(f, "utf8");
      for (const s of SECRETS) expect(text, `${s} leaked into ${f}`).not.toContain(s);
    }
    expect(written.some((f) => f.endsWith("run.sh"))).toBe(false);
  });

  it("imports exactly the preview, as disabled MCP servers with no headers, and audits it (AC2, AC4)", async () => {
    const mcp = JSON.parse(fs.readFileSync(path.join(home, "data", "org", "custom-mcp.json"), "utf8")) as { servers: Array<{ name: string; enabled: boolean; headers: unknown[]; url: string }> };
    expect(mcp.servers.map((s) => s.name).sort()).toEqual(["docs", "events"]);
    expect(mcp.servers.every((s) => s.enabled === false && s.headers.length === 0)).toBe(true);
    expect(fs.existsSync(path.join(home, "data", "org-skills", "pr-review", "SKILL.md"))).toBe(true);
    const names = allFilesUnder(path.join(home, "data")).map((f) => path.basename(f));
    expect(names).toContain("claude-code-CLAUDE.md");
    expect(names).toContain("claude-code-rule-style-ts.md");

    const audit = fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const row = audit.find((r) => r.toolName === "import_claude_code")!;
    expect(row.approvedBy).toBe("usr_1");
    expect(row.ts).toBeTruthy();
    expect(row.input).toEqual({ sourcePath: claudeDir, counts: { skills: 1, mcpServers: 2, knowledge: 2 }, skippedExisting: 0 });
  });

  it("does not overwrite existing skills or servers on a second import", async () => {
    const p = await previewClaudeCodeImport(EMP, claudeDir);
    expect(p.items.filter((i) => i.kind !== "knowledge").every((i) => "status" in i && i.status === "exists")).toBe(true);
    const r = await applyClaudeCodeImport({ employeeId: EMP, employeeName: "Tester", sourceDir: claudeDir, previewDigest: p.digest, actorId: "usr_1" });
    expect(r.imported).toEqual({ skills: 0, mcpServers: 0, knowledge: 2 });
    expect(r.skippedExisting).toBe(3);
  });

  it("refuses to apply when the files changed since the preview, or the digest is wrong (AC1)", async () => {
    const p = await previewClaudeCodeImport(EMP, claudeDir);
    await expect(applyClaudeCodeImport({ employeeId: EMP, employeeName: "T", sourceDir: claudeDir, previewDigest: "nope", actorId: "u" })).rejects.toBeInstanceOf(ImportChangedError);
    fs.appendFileSync(path.join(claudeDir, "CLAUDE.md"), "more\n");
    await expect(applyClaudeCodeImport({ employeeId: EMP, employeeName: "T", sourceDir: claudeDir, previewDigest: p.digest, actorId: "u" })).rejects.toBeInstanceOf(ImportChangedError);
  });

  it("skips MCP urls that carry credentials and never lists their secrets", async () => {
    const p = await previewClaudeCodeImport(EMP, claudeDir);
    expect(p.skipped.some((s) => s.what === "mcp withtoken")).toBe(true);
    expect(p.skipped.some((s) => s.what === "mcp pathtoken")).toBe(true);
    expect(JSON.stringify(p)).not.toContain("PATH_SECRET");
    for (const n of ["jwtpath", "b64path", "subdomain"]) expect(p.skipped.some((s) => s.what === `mcp ${n}`)).toBe(true);
    for (const s of ["JWT_SECRET", "B64_SECRET", "k8f2abc"]) expect(JSON.stringify(p)).not.toContain(s);
    expect(JSON.stringify(p)).not.toContain("QUERY_SECRET_KEY");
  });

  it("does not follow a symlinked .claude folder or symlinked subfolders, and skips duplicate names", async () => {
    const real = path.join(home, "real-elsewhere");
    put(path.join(real, "CLAUDE.md"), "x");
    const link = path.join(home, "linked", ".claude");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);
    await expect(previewClaudeCodeImport(EMP, link)).rejects.toThrow(/symlink/);

    const dir = path.join(home, "dup", ".claude");
    put(path.join(dir, "skills", "a", "SKILL.md"), "---\nname: Same\n---\nbody");
    put(path.join(dir, "skills", "b", "SKILL.md"), "---\nname: Same\n---\nbody");
    put(path.join(dir, "rules", "a", "b.md"), "1");
    put(path.join(dir, "rules", "a-b.md"), "2");
    fs.symlinkSync(real, path.join(dir, "rules", "linked"));
    fs.symlinkSync(path.join(real, "CLAUDE.md"), path.join(dir, "skills", "c"));
    const p = await previewClaudeCodeImport(EMP, dir);
    expect(p.counts).toEqual({ skills: 1, mcpServers: 0, knowledge: 1 });
    expect(p.skipped.some((s) => s.what === "rules/linked")).toBe(true);
    expect(p.skipped.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps a twin's default org skills when it has no assignment entry yet", async () => {
    const { writeOrgSkill } = await import("./org-skills");
    for (const id of ["role-a", "role-b"]) writeOrgSkill({ id, label: id, description: "", triggers: [], body: "x" });
    const mod = await import("./employees-disk");
    const spy = vi.spyOn(mod, "loadEmployeesFromDisk").mockResolvedValue([{ id: "emp-role", name: "R", orgSkillIds: ["role-a", "role-b"] }] as never);
    const dir = path.join(home, "defaults", ".claude");
    put(path.join(dir, "skills", "extra", "SKILL.md"), "---\nname: Extra\n---\nbody");
    const p = await previewClaudeCodeImport("emp-role", dir);
    await applyClaudeCodeImport({ employeeId: "emp-role", employeeName: "R", sourceDir: dir, previewDigest: p.digest, actorId: "u" });
    spy.mockRestore();
    const a = JSON.parse(fs.readFileSync(path.join(home, "data", "org", "skill-assignments.json"), "utf8")) as Record<string, string[]>;
    expect(a["emp-role"]).toEqual(["role-a", "role-b", "extra"]);
  });

  it("assigns the previewed skills to the target twin", () => {
    const a = JSON.parse(fs.readFileSync(path.join(home, "data", "org", "skill-assignments.json"), "utf8")) as Record<string, string[]>;
    expect(a[EMP]).toContain("pr-review");
  });

  it("only accepts a .claude directory", async () => {
    await expect(previewClaudeCodeImport(EMP, os.tmpdir())).rejects.toThrow(/\.claude/);
  });

  it("keeps the SDK child env an allowlist (AC5)", () => {
    const env = sdkChildEnv({ PATH: "/bin", HOME: "/h", ENV_SECRET_VALUE: "x", CLAUDE_CODE_OAUTH_TOKEN: "t", API_TOKEN: "y" }, {});
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH"]);
  });
});
