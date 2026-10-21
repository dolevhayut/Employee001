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
});
