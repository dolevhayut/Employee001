import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-mem-"));
  process.env.EMPLOYEE001_HOME = home;
  // No embedding or extraction calls in this test.
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("twin memory redaction", () => {
  it("never stores identifiers, special-category data or performance judgments", async () => {
    const { rememberTwinRun } = await import("./twin-memory");
    await rememberTwinRun({
      employeeId: "noa",
      runId: "r1",
      surface: "chat",
      question: "Who owns the Acme renewal? Ping dana@acme.com or +972 54 123 4567.",
      answer: "Dana owns the Acme renewal and signs off on discounts. She is on medical leave after surgery. Honestly she is underperforming lately.",
    });
    const raw = fs.readFileSync(path.join(home, "data", "memory", "noa", "episodes.jsonl"), "utf8");
    expect(raw).toContain("owns the Acme renewal");
    expect(raw).not.toMatch(/dana@acme\.com|123 4567|surgery|medical leave|underperforming/);
  });

  it("supersedes a corrected structured fact instead of recalling the stale value", async () => {
    const { rememberTwinRun, searchStructuredMemory } = await import("./twin-memory");
    await rememberTwinRun({
      employeeId: "noa",
      runId: "r1",
      surface: "chat",
      question: "I prefer 25-minute decision meetings with notes and a weekly summary.",
      answer: "Understood.",
    });
    await rememberTwinRun({
      employeeId: "noa",
      runId: "r2",
      surface: "chat",
      question: "I prefer 25-minute decision meetings with notes and a shared agenda.",
      answer: "Understood.",
    });

    const facts = searchStructuredMemory("noa", "What meeting preference should we follow?");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      runId: "r2",
      value: "25-minute decision meetings with notes and a shared agenda",
    });

    const stored = fs
      .readFileSync(path.join(home, "data", "memory", "noa", "structured.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ runId: "r1", supersededBy: stored[1].id });
  });

  it("does not let an agent assertion supersede a user-sourced fact", async () => {
    const { rememberTwinRun, searchStructuredMemory } = await import("./twin-memory");
    await rememberTwinRun({
      employeeId: "noa",
      runId: "r1",
      surface: "chat",
      question: "I prefer 25-minute decision meetings with notes and a weekly summary.",
      answer: "Understood.",
    });
    await rememberTwinRun({
      employeeId: "noa",
      runId: "r2",
      surface: "chat",
      question: "Please restate the meeting preference.",
      answer: "I prefer 25-minute decision meetings with notes and a shared agenda.",
    });

    const facts = searchStructuredMemory("noa", "What meeting preference should we follow?");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      runId: "r1",
      source: "user",
      value: "25-minute decision meetings with notes and a weekly summary",
    });
  });
});
