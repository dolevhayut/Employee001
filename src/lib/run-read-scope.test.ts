import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every run type whose cwd is the data root must limit Read/Glob/Grep to the
// twin's own data (twin-read-scope.ts). One check per run type, plus the hook
// itself.

const SRC = path.resolve(import.meta.dirname, "..");
const source = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** The options object of every buildTwinHooks({...}) call in a file. */
function hookCalls(text: string): string[] {
  const calls: string[] = [];
  let at = text.indexOf("buildTwinHooks({");
  while (at !== -1) {
    let depth = 0;
    let end = at + "buildTwinHooks(".length;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      if (text[end] === "}" && --depth === 0) break;
    }
    calls.push(text.slice(at, end + 1));
    at = text.indexOf("buildTwinHooks({", end);
  }
  return calls;
}

describe("read scope per run type", () => {
  it.each([
    ["shift (Inbox shifts, scheduled shifts)", "lib/shift-runner.ts"],
    ["twin run (chat, Team Meeting, routines, work items, consultations)", "lib/council-runner.ts"],
    ["twin builder (training)", "lib/twin-builder.ts"],
  ])("%s restricts reads", (_label, file) => {
    const calls = hookCalls(source(file));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/restrictReadsToTwinScope:\s*true/);
  });

  it("routines run only through the scoped runners", () => {
    const text = source("lib/routine-scheduler.ts");
    expect(text).toMatch(/runShift\(/);
    expect(text).toMatch(/runSingleTwin\(/);
    expect(text).not.toMatch(/\bquery\(/);
    expect(text).not.toMatch(/claude-agent-sdk/);
  });

  it("work items run only through the scoped runner", () => {
    const text = source("lib/work-dispatcher.ts");
    expect(text).toMatch(/runSingleTwin\(/);
    expect(text).not.toMatch(/claude-agent-sdk/);
  });

  it("relay (handover) has no tools at all: one model call, through relay/model.ts only", () => {
    for (const file of fs.readdirSync(path.join(SRC, "lib", "relay"))) {
      if (file.endsWith(".test.ts") || file === "model.ts") continue;
      expect(source(`lib/relay/${file}`), file).not.toMatch(/claude-agent-sdk|@anthropic-ai\/sdk/);
    }
    const model = source("lib/relay/model.ts");
    expect(model).toMatch(/tools:\s*\[\]/);
    expect(model).toMatch(/mcpServers:\s*\{\}/);
    expect(model).toMatch(/maxTurns:\s*1\b/);
    expect(model).toMatch(/behavior:\s*"deny"/);
  });

  it("a retired twin runs with no tools, no MCP servers and no memory write", () => {
    const text = source("lib/council-runner.ts");
    expect(text).toMatch(/isRetired\(lifecycle\)\) options = \{ \.\.\.options, retired: true, resumeSessionId: undefined/);
    // buildToolConfig gives a retired twin tools: [] (sdk-isolation.test.ts).
    expect(text).toMatch(/if \(options\.publicReply \|\| options\.retired\) \{[^}]*tools: \[\],/);
    expect(text).toMatch(/tools: toolConfig\.tools,/);
    expect(text).toMatch(/const mcpServers = publicReply \? \{\}/);
    expect(text).toMatch(/if \(!retired && !options\.temporary\) void rememberTwinRun/);
  });

  it("a temporary ask changes only what is kept: same tools, hooks and audit, no memory, no saved session", () => {
    const text = source("lib/council-runner.ts");
    // Memory: no episodic/durable write, no recall reinforcement.
    expect(text).toMatch(/!options\.temporary\) void rememberTwinRun/);
    expect(text).toMatch(/searchTwinMemory\(employee\.id, question, undefined, !options\.temporary\)/);
    expect(text).toMatch(/options\.temporary \? \{ persistSession: false \}/);
    // Nothing else in the runner branches on it: tool policy, hooks, read scope
    // and the audit log are not conditional on a temporary ask.
    expect(text.slice(text.indexOf("buildTwinHooks({"), text.indexOf("const toolConfig"))).not.toMatch(/temporary/);
    expect(text).not.toMatch(/appendAuditEntry\(\{[^}]*temporary/);
    const toolConfig = text.slice(text.indexOf("function buildToolConfig"), text.indexOf("export async function runSingleTwin"));
    expect(toolConfig).not.toMatch(/temporary/);
  });

  it("the Ask-the-company systems agent can't read files at all", () => {
    const text = source("lib/org-ask.ts");
    expect(text).toMatch(/tools: \["ToolSearch"\],/);
    expect(text).toMatch(/disallowedTools:\s*twinDisallowedTools\(\[[^\]]*"Read", "Glob", "Grep"/);
  });
});

describe("the read-scope hook", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-scope-"));
    process.env.EMPLOYEE001_HOME = home;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.EMPLOYEE001_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function preToolUse(restrict: boolean, file_path: string, tool_name = "Read") {
    const { buildTwinHooks } = await import("./sdk-defaults");
    const hooks = buildTwinHooks({ runId: "r", employeeId: "noa", employeeName: "Noa", surface: "chat", restrictReadsToTwinScope: restrict });
    const results = [];
    for (const matcher of hooks.PreToolUse ?? []) {
      for (const hook of matcher.hooks) {
        results.push(await hook({ hook_event_name: "PreToolUse", tool_name, tool_input: { file_path }, tool_use_id: "t", session_id: "s", transcript_path: "", cwd: path.join(home, "data") } as never, "t", { signal: new AbortController().signal }));
      }
    }
    return results.map((r) => (r as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision).filter(Boolean);
  }

  it("denies another twin's memory and allows the twin's own files", async () => {
    expect(await preToolUse(true, "memory/itai/cards.jsonl")).toContain("deny");
    expect(await preToolUse(true, "employees/itai/chat-history.jsonl")).toContain("deny");
    expect(await preToolUse(true, "employees/noa/CONTEXT.md")).not.toContain("deny");
  });

  it("keeps Edit and MultiEdit inside the twin's scratch, like Write", async () => {
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      expect(await preToolUse(true, "employees/noa/CONTEXT.md", tool), tool).toContain("deny");
      expect(await preToolUse(true, "/Users/someone/project/README.md", tool), tool).toContain("deny");
      expect(await preToolUse(true, "scratch/noa/notes.md", tool), tool).not.toContain("deny");
    }
  });
});
