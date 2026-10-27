import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendChatMessage } from "./chat-history";
import { readKnowledgeFile } from "./knowledge-files";
import { MAX_PENDING_CORRECTIONS, addAnswerCorrection, answerStats, decideProposal, listPendingProposals } from "./knowledge-proposals";

let previousCwd: string;
let tempDir: string;

beforeEach(() => {
  previousCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "answer-corrections-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("addAnswerCorrection", () => {
  it("creates a pending answer-sourced proposal and writes no profile file", async () => {
    const r = await addAnswerCorrection("noa", { question: "Who owns billing?", answer: "Dana", correction: "Amit owns billing now." });
    expect(r.ok).toBe(true);
    const pending = listPendingProposals("noa");
    expect(pending).toHaveLength(1);
    expect(pending[0].source).toEqual({ kind: "answer", question: "Who owns billing?", answer: "Dana" });
    expect(pending[0].markdown).toContain("Amit owns billing now.");
    expect(readKnowledgeFile("noa", pending[0].file)).toBeNull();
  });

  it("rejects an empty correction", async () => {
    expect(await addAnswerCorrection("noa", { correction: "   " })).toEqual({ ok: false, error: "empty_correction" });
    expect(listPendingProposals("noa")).toHaveLength(0);
  });

  it("refuses more than the pending cap", async () => {
    for (let i = 0; i < MAX_PENDING_CORRECTIONS; i++) await addAnswerCorrection("noa", { correction: `fix ${i}` });
    expect(await addAnswerCorrection("noa", { correction: "one more" })).toEqual({ ok: false, error: "too_many_pending" });
    expect(listPendingProposals("noa")).toHaveLength(MAX_PENDING_CORRECTIONS);
  });

  it("writes to the knowledge file only after the owner accepts", async () => {
    const r = await addAnswerCorrection("noa", { question: "q", answer: "a", correction: "Fixed fact." });
    if (!r.ok) throw new Error("expected ok");
    const done = await decideProposal("noa", r.proposal.id, "accept");
    expect(done.ok).toBe(true);
    expect(readKnowledgeFile("noa", r.proposal.file)?.body).toContain("Fixed fact.");
  });
});

describe("answerStats", () => {
  it("counts Ask answers and corrections", async () => {
    expect(answerStats("noa")).toEqual({ answered: 0, corrected: 0 });
    appendChatMessage("noa", { id: "1", role: "user", text: "q", ts: 1, surface: "ask" });
    appendChatMessage("noa", { id: "2", role: "twin", text: "a", ts: 2, surface: "ask" });
    await addAnswerCorrection("noa", { correction: "x" });
    expect(answerStats("noa")).toEqual({ answered: 1, corrected: 1 });
  });
});
