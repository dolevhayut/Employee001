import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readKnowledgeFile, writeKnowledgeFile } from "./knowledge-files";
import { listKnowledgeVersions } from "./knowledge-versions";
import {
  addProposals,
  decideProposal,
  listPendingProposals,
  parseProposalReply,
  proposeKnowledgeFromMeeting,
  validateProposal,
} from "./knowledge-proposals";
import type { MeetingTurn } from "./meeting-store";

let previousCwd: string;
let tempDir: string;

beforeEach(() => {
  previousCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e084-proposals-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("validateProposal", () => {
  it("keeps a plain .md target and trims text", () => {
    expect(validateProposal({ file: "pricing.md", markdown: "  ### Pro is $49  ", reason: " decided\nin meeting " })).toEqual({
      file: "pricing.md",
      markdown: "### Pro is $49",
      reason: "decided in meeting",
    });
  });

  it("falls back to the decisions file for unsafe or non-markdown targets", () => {
    for (const file of ["../secrets.md", "notes.txt", "a/b.md", "weird name.md", 42]) {
      expect(validateProposal({ file, markdown: "x" })?.file).toBe("team-meeting-decisions.md");
    }
  });

  it("drops empty proposals and caps long ones", () => {
    expect(validateProposal({ file: "a.md", markdown: "   " })).toBeNull();
    expect(validateProposal({ markdown: "y".repeat(5000) })?.markdown).toHaveLength(2000);
  });
});

describe("parseProposalReply", () => {
  it("reads fenced or bare JSON and ignores garbage", () => {
    expect(parseProposalReply('```json\n{"proposals":[{"markdown":"a"}]}\n```')).toHaveLength(1);
    expect(parseProposalReply('{"proposals":[]}')).toEqual([]);
    expect(parseProposalReply("not json")).toEqual([]);
  });
});

describe("accept / dismiss", () => {
  it("accept appends to the file and keeps the old body in history", async () => {
    writeKnowledgeFile("twin-a", "pricing.md", "# Pricing\n");
    const [p] = await addProposals("twin-a", "m1", [{ file: "pricing.md", markdown: "### 2026-10-04 — Pro\nPro costs $49.", reason: "r" }]);
    expect(listPendingProposals("twin-a")).toHaveLength(1);

    const res = await decideProposal("twin-a", p.id, "accept");
    expect(res.ok).toBe(true);
    expect(readKnowledgeFile("twin-a", "pricing.md")?.body).toBe("# Pricing\n\n### 2026-10-04 — Pro\nPro costs $49.\n");
    expect(listKnowledgeVersions("twin-a", "pricing.md")).toHaveLength(1);
    expect(listPendingProposals("twin-a")).toHaveLength(0);
    expect(await decideProposal("twin-a", p.id, "accept")).toEqual({ ok: false, error: "already_decided" });
  });

  it("accept creates a missing target file; dismiss writes nothing", async () => {
    const [a, b] = await addProposals("twin-a", "m1", [{ markdown: "### החלטה\nמחיר Pro הוא 49 דולר." }, { file: "x.md", markdown: "skip me" }]);
    await decideProposal("twin-a", a.id, "accept");
    expect(readKnowledgeFile("twin-a", "team-meeting-decisions.md")?.body).toBe("### החלטה\nמחיר Pro הוא 49 דולר.\n");
    await decideProposal("twin-a", b.id, "dismiss");
    expect(readKnowledgeFile("twin-a", "x.md")).toBeNull();
    expect(await decideProposal("twin-a", "kp_missing", "dismiss")).toEqual({ ok: false, error: "not_found" });
  });

  it("caps at two proposals per twin per meeting", async () => {
    const created = await addProposals("twin-a", "m1", [{ markdown: "1" }, { markdown: "2" }, { markdown: "3" }]);
    expect(created).toHaveLength(2);
  });
});

describe("proposeKnowledgeFromMeeting", () => {
  const turns: MeetingTurn[] = [
    { kind: "ceo", text: "Should Pro go to $49?", ts: 1 },
    { kind: "twin", employeeId: "twin-a", employeeName: "Noa", text: "Yes, from November. " + "We checked churn, the annual plan and the reseller margin; all three hold at $49. ".repeat(3), ts: 2 },
  ];

  it("skips runs where the twins said almost nothing, and caps twins per run", async () => {
    let calls = 0;
    const complete = async () => {
      calls++;
      return '{"proposals": []}';
    };
    await proposeKnowledgeFromMeeting({
      meetingId: "m0",
      turns: [{ kind: "ceo", text: "hi", ts: 1 }, { kind: "twin", employeeId: "twin-a", employeeName: "Noa", text: "Hi!", ts: 2 }],
      twins: [{ id: "twin-a", name: "Noa" }],
      complete,
    });
    expect(calls).toBe(0);
    await proposeKnowledgeFromMeeting({
      meetingId: "m1",
      turns,
      twins: Array.from({ length: 7 }, (_, i) => ({ id: `twin-${i}`, name: `T${i}` })),
      complete,
    });
    expect(calls).toBe(4);
  });

  it("stores what the model proposes, per twin, and passes the transcript in", async () => {
    const prompts: string[] = [];
    const n = await proposeKnowledgeFromMeeting({
      meetingId: "m1",
      turns,
      twins: [{ id: "twin-a", name: "Noa Friedman" }],
      complete: async (prompt) => {
        prompts.push(prompt);
        return JSON.stringify({ proposals: [{ file: "pricing.md", markdown: "### Pro → $49 from November", reason: "pricing decision" }] });
      },
    });
    expect(n).toBe(1);
    expect(prompts[0]).toContain("Should Pro go to $49?");
    expect(prompts[0]).toContain("Noa Friedman");
    expect(listPendingProposals("twin-a")[0].file).toBe("pricing.md");
  });

  it("never throws when the model fails or returns nothing", async () => {
    const n = await proposeKnowledgeFromMeeting({
      meetingId: "m1",
      turns,
      twins: [{ id: "twin-a", name: "Noa" }, { id: "twin-b", name: "Dan" }],
      complete: async (prompt) => {
        if (prompt.includes("Dan")) throw new Error("rate limited");
        return '{"proposals": []}';
      },
    });
    expect(n).toBe(0);
  });
});
