import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The builder run with the SDK scripted: a profile file written after the
// builder read an uploaded document lists that document as a source and
// carries the build's real time, whatever the model put in the frontmatter.

type CanUseTool = (tool: string, input: Record<string, unknown>) => Promise<{ behavior: string; updatedInput?: Record<string, unknown> }>;

const run = vi.hoisted(() => ({ written: [] as Record<string, unknown>[] }));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: ({ options }: { options: { canUseTool: CanUseTool; cwd: string } }) =>
      (async function* () {
        const write = async (id: string, content: string) => {
          const gate = await options.canUseTool("Write", { file_path: "TONE.md", content });
          run.written.push(gate.updatedInput ?? {});
          fs.writeFileSync(String(gate.updatedInput?.file_path), String(gate.updatedInput?.content));
          return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } };
        };
        const model = "---\nfile: TONE.md\ngeneratedAt: 2026-10-25T00:00:00Z\nsources: [knowledge/invented.md]\n---\n# Tone\n";
        // Written before any read: no document to credit.
        yield await write("w0", model);
        yield { type: "assistant", message: { content: [
          { type: "tool_use", id: "r1", name: "Read", input: { file_path: "knowledge/notes.md" } },
          { type: "tool_use", id: "r2", name: "Read", input: { file_path: path.join(options.cwd, "knowledge", "missing.md") } },
        ] } };
        yield { type: "user", message: { content: [
          { type: "tool_result", tool_use_id: "r1", content: "notes" },
          { type: "tool_result", tool_use_id: "r2", content: "File does not exist.", is_error: true },
        ] } };
        yield await write("w1", model);
        yield { type: "result", subtype: "success", total_cost_usd: 0, num_turns: 3 };
      })(),
  };
});
vi.mock("@/lib/composio-client", () => ({
  buildEmployeeMcpServer: async () => null,
  readState: async () => ({ connections: {} }),
}));
vi.mock("@/lib/custom-mcp", () => ({ loadOrgCustomMcpServers: async () => ({}) }));
vi.mock("@/lib/twin-sandbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/twin-sandbox")>()),
  ensureTwinSandbox: async () => {},
}));

let home: string;
const emp = (...p: string[]) => path.join(home, "data", "employees", "ava", ...p);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-builder-src-"));
  process.env.EMPLOYEE001_HOME = home;
  run.written = [];
  vi.resetModules();
  fs.mkdirSync(emp("knowledge"), { recursive: true });
  fs.writeFileSync(emp("knowledge", "notes.md"), "I run customer success.");
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("runTwinBuilder profile frontmatter", () => {
  it("stamps the build time and credits only documents read before the write", async () => {
    const { runTwinBuilder } = await import("./twin-builder");
    const employee = { id: "ava", name: "Ava Chen", firstName: "Ava", role: "Head of Success" };
    const before = Date.now();
    await runTwinBuilder({ employee: employee as never, lookbackDays: 90, onEvent: () => {}, buildId: "b-test" });

    expect(run.written).toHaveLength(2);
    const [first, second] = run.written.map((w) => String(w.content));
    expect(first).toContain("sources: []");
    expect(second).toContain("sources: [knowledge/notes.md]");
    expect(second).not.toContain("invented.md");
    expect(second).not.toContain("missing.md");

    const stamped = second.match(/^generatedAt: (.+)$/m)?.[1] ?? "";
    expect(stamped).not.toBe("2026-10-25T00:00:00Z");
    expect(Date.parse(stamped)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(stamped)).toBeLessThanOrEqual(Date.now());
    expect(fs.readFileSync(emp("TONE.md"), "utf8")).toBe(second);
  });
});
