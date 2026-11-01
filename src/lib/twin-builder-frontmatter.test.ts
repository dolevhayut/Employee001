import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeSourceForRead, stampProfileFrontmatter } from "./twin-builder-frontmatter";

const stamp = {
  employeeId: "ava-1a2b3c",
  filename: "TONE.md",
  generatedAt: "2026-10-25T21:30:45.123Z",
  knowledgeSources: ["knowledge/about-my-work.md", "knowledge/playbook.pdf"],
};

describe("stampProfileFrontmatter", () => {
  it("replaces a midnight placeholder with the build time", () => {
    const out = stampProfileFrontmatter(
      "---\nemployee: ava-1a2b3c\nfile: TONE.md\ngeneratedAt: 2026-10-25T00:00:00Z\nsources: [gmail]\n---\n# Tone\n",
      stamp,
    );
    expect(out).toContain("generatedAt: 2026-10-25T21:30:45.123Z");
    expect(out).not.toContain("T00:00:00Z");
    expect(out.endsWith("---\n# Tone\n")).toBe(true);
  });

  it("adds the documents read, keeps tool sources and drops duplicates", () => {
    const out = stampProfileFrontmatter(
      "---\nfile: TONE.md\ngeneratedAt: x\nsources: [gmail.fetch_emails, gmail.fetch_emails, slack]\nconfidenceNote: \"high — sent mail\"\n---\nbody",
      stamp,
    );
    expect(out).toContain(
      "sources: [gmail.fetch_emails, slack, knowledge/about-my-work.md, knowledge/playbook.pdf]",
    );
    expect(out).toContain('confidenceNote: "high — sent mail"');
  });

  it("drops a knowledge/ source the builder never read", () => {
    const out = stampProfileFrontmatter(
      "---\ngeneratedAt: x\nsources: [`knowledge/invented.md`, knowledge/playbook.pdf, github]\n---\nbody",
      stamp,
    );
    expect(out).not.toContain("invented.md");
    expect(out).toContain("sources: [github, knowledge/about-my-work.md, knowledge/playbook.pdf]");
  });

  it("normalizes a block-style list to the inline form the profile reads", () => {
    const out = stampProfileFrontmatter(
      "---\nfile: TONE.md\nsources:\n  - gmail\n  - \"slack.search\"\nconfidenceNote: low\n---\nbody",
      { ...stamp, knowledgeSources: [] },
    );
    expect(out).toContain("sources: [gmail, slack.search]\nconfidenceNote: low");
    expect(out).toContain("generatedAt: 2026-10-25T21:30:45.123Z");
    expect(out).not.toContain("  - gmail");
  });

  it("adds frontmatter when the model left it out", () => {
    const out = stampProfileFrontmatter("# Tone\n\nShort and direct.", stamp);
    expect(out).toBe(
      "---\nemployee: ava-1a2b3c\nfile: TONE.md\ngeneratedAt: 2026-10-25T21:30:45.123Z\nsources: [knowledge/about-my-work.md, knowledge/playbook.pdf]\n---\n# Tone\n\nShort and direct.",
    );
  });

  it("adds missing generatedAt and sources lines to existing frontmatter", () => {
    const out = stampProfileFrontmatter("---\nemployee: ava-1a2b3c\nfile: TONE.md\n---\nbody", stamp);
    expect(out).toBe(
      "---\nemployee: ava-1a2b3c\nfile: TONE.md\ngeneratedAt: 2026-10-25T21:30:45.123Z\nsources: [knowledge/about-my-work.md, knowledge/playbook.pdf]\n---\nbody",
    );
  });

  it("quotes a source name that would break the inline list", () => {
    const out = stampProfileFrontmatter("---\nsources: []\n---\n", {
      ...stamp,
      knowledgeSources: ["knowledge/q1, q2 plan.md"],
    });
    expect(out).toContain('sources: ["knowledge/q1, q2 plan.md"]');
  });
});

describe("knowledgeSourceForRead", () => {
  let root: string;
  let employeeDir: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "twin-fm-"));
    employeeDir = path.join(root, "employees", "ava");
    fs.mkdirSync(path.join(employeeDir, "knowledge"), { recursive: true });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("maps relative and absolute paths to the same source", () => {
    expect(knowledgeSourceForRead("knowledge/notes.md", employeeDir)).toBe("knowledge/notes.md");
    expect(knowledgeSourceForRead(path.join(employeeDir, "knowledge", "notes.md"), employeeDir)).toBe(
      "knowledge/notes.md",
    );
    expect(knowledgeSourceForRead("./knowledge/../knowledge/notes.md", employeeDir)).toBe("knowledge/notes.md");
  });

  it("follows a symlinked spelling of the data folder", () => {
    const link = path.join(root, "link");
    fs.symlinkSync(path.join(root, "employees"), link);
    expect(knowledgeSourceForRead(path.join(link, "ava", "knowledge", "notes.md"), employeeDir)).toBe(
      "knowledge/notes.md",
    );
  });

  it("credits the upload when its extracted text is read", () => {
    expect(knowledgeSourceForRead("knowledge/playbook.pdf.md", employeeDir)).toBe("knowledge/playbook.pdf");
    expect(knowledgeSourceForRead("knowledge/spec.docx.md", employeeDir)).toBe("knowledge/spec.docx");
  });

  it("ignores reads outside knowledge/", () => {
    expect(knowledgeSourceForRead("knowledge/../CONTEXT.md", employeeDir)).toBeNull();
    expect(knowledgeSourceForRead("CONTEXT.md", employeeDir)).toBeNull();
    expect(knowledgeSourceForRead("knowledge/sub/notes.md", employeeDir)).toBeNull();
    expect(knowledgeSourceForRead("knowledge", employeeDir)).toBeNull();
    expect(knowledgeSourceForRead("knowledge/.hidden", employeeDir)).toBeNull();
    expect(knowledgeSourceForRead("/etc/passwd", employeeDir)).toBeNull();
    expect(knowledgeSourceForRead(undefined, employeeDir)).toBeNull();
    expect(knowledgeSourceForRead("", employeeDir)).toBeNull();
  });
});
