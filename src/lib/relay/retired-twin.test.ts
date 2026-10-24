import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A retired twin, run through the real runner with the SDK mocked: it must
// get no tools and no MCP servers, answer from the allowed profile files and
// the reviewed handover notes only, and write no memory.

const calls = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], remembered: 0 }));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: ({ options }: { options: Record<string, unknown> }) => {
      calls.options.push(options);
      return (async function* () {
        yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "From my handover notes: finance signs off." } } };
        yield { type: "result", subtype: "success", result: "From my handover notes: finance signs off.", total_cost_usd: 0, num_turns: 1 };
      })();
    },
  };
});
vi.mock("@/lib/twin-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/twin-memory")>();
  return {
    ...actual,
    rememberTwinRun: async () => {
      calls.remembered++;
    },
  };
});

let home: string;
const emp = (...p: string[]) => path.join(home, "data", "employees", "dana", ...p);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-retired-"));
  process.env.EMPLOYEE001_HOME = home;
  process.env.ANTHROPIC_API_KEY = "test-key";
  calls.options = [];
  calls.remembered = 0;
  vi.resetModules();
  fs.mkdirSync(emp(), { recursive: true });
  fs.writeFileSync(emp("employee.json"), JSON.stringify({
    id: "dana", name: "Dana Levi", role: "Head of Ops", lifecycle: "retired", retiredAt: "2026-10-20T09:00:00.000Z",
    retention: { grantedAt: "x", textDigest: "d", locale: "en" },
    consent: { grantedAt: "x", version: "1.0", scopes: ["data-collection", "integrations"] },
  }));
  fs.writeFileSync(emp("EXPERTISE.md"), "Vendor contracts and month-end close.");
  fs.writeFileSync(emp("PEOPLE.md"), "SECRET-VIEW: thinks Omer is slow.");
  fs.mkdirSync(path.join(home, "data", "handovers", "dana"), { recursive: true });
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(home, { recursive: true, force: true });
});

function writePackage(reviewed: boolean) {
  const item = { id: "r1", title: "Refunds over $500", body: "Need finance sign-off", provenance: "interview", confidence: 0.9, gaps: [] };
  fs.writeFileSync(path.join(home, "data", "handovers", "dana", "package.json"), JSON.stringify({
    source_twin_id: "dana", schema_version: "relay-rcp-1", generated_at: "2026-10-19T09:00:00.000Z", synth_mode: "model", status: "draft",
    decision_rules: [item], playbooks: [], contact_graph: [], edge_cases: [], tooling_map: [], glossary: [], open_loops: [],
    provenance: { interviewerModel: "m", transcriptRef: "interview.json", redactionApplied: true, itemCount: 1, consent: { subjectId: "dana", grantedAt: "x", banner: "b" }, auditRunId: "r" },
    ...(reviewed ? { review: { approvedAt: "2026-10-19T10:00:00.000Z" } } : {}),
  }));
}

async function ask() {
  const { runSingleTwin } = await import("../council-runner");
  const employee = {
    id: "dana", name: "Dana Levi", firstName: "Dana", role: "Head of Ops", department: "Ops", initials: "DL", avatarColor: "#ccc",
    integrations: [], twinStatus: "ready", twinConfidence: 1, profileFilesComplete: 6, questionsThisWeek: 0, skills: [], orgSkillIds: [],
    seedModel: "claude-opus-5-5", refreshModel: "claude-sonnet-5-5", ttsVoiceId: "x",
  } as const;
  // The caller doesn't say "retired": the runner reads it from disk.
  const answer = await runSingleTwin(employee as never, "Who signs off big refunds?", () => {}, [], { surface: "chat" });
  return { answer, options: calls.options[0] };
}

describe("retired twin run", () => {
  it("has no tools, no MCP servers, no memory write, and answers from the reviewed notes", async () => {
    writePackage(true);
    const { answer, options } = await ask();
    expect(answer).toContain("finance");
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual([]);
    expect(options.mcpServers).toBeUndefined();
    const prompt = (options.systemPrompt as string[]).join("\n");
    expect(prompt).toContain("has left the company on 2026-10-20");
    expect(prompt).toContain("Refunds over $500");
    expect(prompt).toContain("Vendor contracts");
    expect(prompt).not.toContain("SECRET-VIEW");
    const canUseTool = options.canUseTool as (n: string, i: unknown, o: unknown) => Promise<{ behavior: string }>;
    expect((await canUseTool("Read", { file_path: "x" }, { signal: new AbortController().signal })).behavior).toBe("deny");
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.remembered).toBe(0);
  });

  it("ignores handover notes nobody approved", async () => {
    writePackage(false);
    const { options } = await ask();
    const prompt = (options.systemPrompt as string[]).join("\n");
    expect(prompt).not.toContain("Refunds over $500");
    expect(prompt).toContain("(no reviewed handover notes)");
  });
});
