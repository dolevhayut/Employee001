import { describe, expect, it } from "vitest";

import { checkTwinRead, toDataRelative } from "./twin-read-scope";

const ROOT = "/home/u/.employee001/data";
const ME = "noa-friedman";

const read = (file_path: string) => checkTwinRead("Read", { file_path }, ME, ROOT).ok;

describe("toDataRelative", () => {
  it("relativizes absolute paths inside the data root", () => {
    expect(toDataRelative(`${ROOT}/org-brain/nodes/a.md`, ROOT)).toBe("org-brain/nodes/a.md");
  });

  it("returns null for anything outside the data root", () => {
    expect(toDataRelative("/etc/passwd", ROOT)).toBeNull();
    expect(toDataRelative("../.env", ROOT)).toBeNull();
    expect(toDataRelative("org-brain/../../.env", ROOT)).toBeNull();
  });
});

describe("Read scope", () => {
  it("allows the twin's own folder, scratch and the company brain", () => {
    expect(read(`employees/${ME}/CONTEXT.md`)).toBe(true);
    expect(read(`${ROOT}/employees/${ME}/knowledge/spec.pdf`)).toBe(true);
    expect(read(`scratch/${ME}/memo.md`)).toBe(true);
    expect(read("org-brain/nodes/pricing.md")).toBe(true);
    expect(read("org-skills/retro/SKILL.md")).toBe(true);
  });

  it("allows a colleague's nine profile files only", () => {
    expect(read("employees/itai-cohen/EXPERTISE.md")).toBe(true);
    expect(read("employees/itai-cohen/chat-history.jsonl")).toBe(false);
    expect(read("employees/itai-cohen/employee.json")).toBe(false);
    expect(read("employees/itai-cohen/knowledge/notes.md")).toBe(false);
    expect(read("employees/itai-cohen/.composio.json")).toBe(false);
  });

  it("blocks memory, invites, audit, settings and other twins' scratch", () => {
    for (const p of [
      "memory/itai-cohen/cards.jsonl",
      `memory/${ME}/cards.jsonl`,
      "invites.json",
      "audit.jsonl",
      "settings.json",
      "relay/transcripts/itai-cohen.json",
      "scratch/itai-cohen/memo.md",
      "email-poll.json",
    ]) {
      expect(read(p), p).toBe(false);
    }
  });

  it("blocks escapes out of an allowed folder", () => {
    expect(read("org-brain/../invites.json")).toBe(false);
    expect(read(`employees/${ME}/../itai-cohen/chat-history.jsonl`)).toBe(false);
  });
});

describe("Grep and Glob scope", () => {
  const grep = (input: Record<string, unknown>) => checkTwinRead("Grep", input, ME, ROOT).ok;
  const glob = (input: Record<string, unknown>) => checkTwinRead("Glob", input, ME, ROOT).ok;

  it("requires Grep to name an allowed path", () => {
    expect(grep({ pattern: "salary" })).toBe(false);
    expect(grep({ pattern: "x", path: "memory" })).toBe(false);
    expect(grep({ pattern: "x", path: "org-brain" })).toBe(true);
  });

  it("allows Grep across colleagues only for their profile files, one level down", () => {
    expect(grep({ pattern: "x", path: "employees", glob: "*/EXPERTISE.md" })).toBe(true);
    expect(grep({ pattern: "x", path: "employees", glob: "*/{CONTEXT.md,PEOPLE.md}" })).toBe(true);
    // These would reach scratch/ and knowledge/ notes inside a colleague's folder.
    expect(grep({ pattern: "x", path: "employees", glob: "*.md" })).toBe(false);
    expect(grep({ pattern: "x", path: "employees", glob: "**/*.md" })).toBe(false);
    expect(grep({ pattern: "x", path: "employees", glob: "*/*.md" })).toBe(false);
    expect(grep({ pattern: "x", path: "employees", glob: "*/{CONTEXT.md,notes.md}" })).toBe(false);
    expect(grep({ pattern: "x", path: "employees", glob: "*/scratch/CONTEXT.md" })).toBe(false);
    expect(grep({ pattern: "x", path: "employees" })).toBe(false);
  });

  it("resolves relative paths against the run's cwd", () => {
    const cwd = `${ROOT}/employees/${ME}`;
    expect(checkTwinRead("Read", { file_path: "CONTEXT.md" }, ME, ROOT, cwd).ok).toBe(true);
    expect(checkTwinRead("Grep", { pattern: "x" }, ME, ROOT, cwd).ok).toBe(true);
    expect(checkTwinRead("Read", { file_path: "../../invites.json" }, ME, ROOT, cwd).ok).toBe(false);
    expect(checkTwinRead("Read", { file_path: `${ROOT}/memory/${ME}/cards.jsonl` }, ME, ROOT, cwd).ok).toBe(false);
  });

  it("lets Glob list names under employees/ and the brain, not elsewhere", () => {
    expect(glob({ pattern: "org-brain/nodes/*.md" })).toBe(true);
    expect(glob({ pattern: "*/CONTEXT.md", path: "employees" })).toBe(true);
    expect(glob({ pattern: "**/*" })).toBe(false);
    expect(glob({ pattern: "*", path: "memory" })).toBe(false);
    expect(glob({ pattern: "../memory/*", path: "org-brain" })).toBe(false);
  });

  it("leaves other tools alone", () => {
    expect(checkTwinRead("WebSearch", { query: "x" }, ME, ROOT).ok).toBe(true);
  });
});
