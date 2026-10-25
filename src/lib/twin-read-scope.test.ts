import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkConfiguredFolderRead, checkTwinRead, toDataRelative } from "./twin-read-scope";
import { addKnowledgeFolder } from "./knowledge-folders";

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

describe("configured folder scope", () => {
  let home = "";
  let folder = "";
  const originalHome = process.env.EMPLOYEE001_HOME;

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-folders-"));
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-folder-source-"));
    fs.writeFileSync(path.join(folder, "README.md"), "hello");
    fs.writeFileSync(path.join(folder, ".env.local"), "secret");
    fs.writeFileSync(path.join(folder, "private.key"), "secret");
    fs.mkdirSync(path.join(home, "data", "employees", ME), { recursive: true });
    fs.writeFileSync(path.join(home, "data", "employees", ME, "employee.json"), JSON.stringify({ id: ME }));
    process.env.EMPLOYEE001_HOME = home;
    await addKnowledgeFolder(ME, { path: folder, label: "Source" });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.EMPLOYEE001_HOME;
    else process.env.EMPLOYEE001_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("allows only own configured folder files and blocks sensitive names", () => {
    expect(checkTwinRead("Read", { file_path: path.join(folder, "README.md") }, ME, ROOT).ok).toBe(true);
    expect(checkTwinRead("Read", { file_path: path.join(folder, ".env.local") }, ME, ROOT).ok).toBe(false);
    expect(checkTwinRead("Read", { file_path: path.join(folder, "private.key") }, ME, ROOT).ok).toBe(false);
    expect(checkTwinRead("Glob", { path: folder, pattern: "**/.git/**" }, ME, ROOT).ok).toBe(false);
  });

  it("does not follow a symlink out of the configured folder", () => {
    const outside = path.join(home, "outside.txt");
    fs.writeFileSync(outside, "nope");
    fs.symlinkSync(outside, path.join(folder, "escape.txt"));
    expect(checkTwinRead("Read", { file_path: path.join(folder, "escape.txt") }, ME, ROOT).ok).toBe(false);
  });

  it("refuses Grep over a whole folder but allows one file", () => {
    expect(checkTwinRead("Grep", { path: folder, pattern: "secret" }, ME, ROOT).ok).toBe(false);
    expect(checkTwinRead("Grep", { path: path.join(folder, "README.md"), pattern: "hello" }, ME, ROOT).ok).toBe(true);
    expect(checkTwinRead("Grep", { path: path.join(folder, ".env.local"), pattern: "secret" }, ME, ROOT).ok).toBe(false);
  });

  it("keeps normal rules for the data dir inside a configured folder", async () => {
    const peer = path.join(home, "data", "employees", "someone-else", "knowledge");
    fs.mkdirSync(peer, { recursive: true });
    fs.writeFileSync(path.join(peer, "notes.md"), "private");
    await addKnowledgeFolder(ME, { path: home, label: "Install" });
    expect(checkTwinRead("Read", { file_path: path.join(peer, "notes.md") }, ME, path.join(home, "data")).ok).toBe(false);
  });
});

describe("checkConfiguredFolderRead (twin builder)", () => {
  it("denies secret names anywhere and allows ordinary paths", () => {
    expect(checkConfiguredFolderRead("Read", { file_path: "/x/project/.env.local" }, ME, "/tmp").ok).toBe(false);
    expect(checkConfiguredFolderRead("Glob", { path: "/x", pattern: "**/id_rsa" }, ME, "/tmp").ok).toBe(false);
    expect(checkConfiguredFolderRead("Grep", { path: "/x", glob: "**/.git/**" }, ME, "/tmp").ok).toBe(false);
    expect(checkConfiguredFolderRead("Read", { file_path: "knowledge/notes.md" }, ME, "/tmp").ok).toBe(true);
  });
});
