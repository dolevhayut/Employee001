import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ appendAuditEntry: vi.fn(() => true) }));
vi.mock("./audit-log", () => ({ appendAuditEntry: m.appendAuditEntry }));

import { addKnowledgeFolder, listKnowledgeFolders, removeKnowledgeFolder, validateKnowledgeFolder } from "./knowledge-folders";

const ME = "maya";

let home = "";
let source = "";
let userHome = "";
const originalHome = process.env.EMPLOYEE001_HOME;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-folder-validation-"));
  source = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-folder-source-"));
  // A fake home folder, so the home / protected-folder rules are testable
  // on any machine (CI may have no ~/.ssh).
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-user-home-"));
  fs.mkdirSync(path.join(userHome, ".ssh"));
  fs.mkdirSync(path.join(userHome, "Documents", "project"), { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(userHome);
  process.env.EMPLOYEE001_HOME = home;
  m.appendAuditEntry.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = originalHome;
  for (const dir of [home, source, userHome]) fs.rmSync(dir, { recursive: true, force: true });
});

function errorFor(input: { path?: unknown; label?: unknown }): string {
  const result = validateKnowledgeFolder(input);
  if (result.ok) throw new Error(`expected a rejection for ${String(input.path)}`);
  return result.error;
}

describe("validateKnowledgeFolder", () => {
  it("requires an existing absolute directory and canonicalizes symlinks", () => {
    const link = path.join(home, "link");
    fs.symlinkSync(source, link);
    expect(validateKnowledgeFolder({ path: "source", label: "Source" }).ok).toBe(false);
    expect(validateKnowledgeFolder({ path: link, label: "Source" })).toMatchObject({ ok: true, folder: { path: fs.realpathSync(source) } });
  });

  it("refuses the data directory, root, the home folder and above, and protected home folders", () => {
    fs.mkdirSync(path.join(home, "data", "employees"), { recursive: true });
    for (const folder of [path.join(home, "data"), path.join(home, "data", "employees"), path.parse(home).root, userHome, path.dirname(userHome), path.join(userHome, ".ssh")]) {
      expect(validateKnowledgeFolder({ path: folder, label: "No" }).ok).toBe(false);
    }
  });

  it("allows a folder that contains the data dir, such as the repo in dev", () => {
    fs.mkdirSync(path.join(home, "data"));
    expect(validateKnowledgeFolder({ path: home, label: "Repo" }).ok).toBe(true);
  });

  it("defaults an empty or missing label to the folder's name", () => {
    const project = path.join(userHome, "Documents", "project");
    expect(validateKnowledgeFolder({ path: project })).toMatchObject({ ok: true, folder: { label: "project" } });
    expect(validateKnowledgeFolder({ path: `${project}/`, label: "   " })).toMatchObject({ ok: true, folder: { label: "project" } });
    expect(validateKnowledgeFolder({ path: project, label: " Specs " })).toMatchObject({ ok: true, folder: { label: "Specs" } });
  });

  it("caps the label at 120 characters and caps a long default name", () => {
    expect(errorFor({ path: source, label: "x".repeat(121) })).toMatch(/120 or fewer.*leave it empty/);
    expect(validateKnowledgeFolder({ path: source, label: "x".repeat(120) }).ok).toBe(true);
    const longName = path.join(source, "n".repeat(150));
    fs.mkdirSync(longName);
    const result = validateKnowledgeFolder({ path: longName });
    expect(result.ok && result.folder.label.length).toBe(120);
  });

  it("expands a leading ~/ to the home folder", () => {
    expect(validateKnowledgeFolder({ path: "~/Documents/project" })).toMatchObject({
      ok: true,
      folder: { path: fs.realpathSync(path.join(userHome, "Documents", "project")) },
    });
  });

  it("names the cause and a next step for each rejection", () => {
    fs.mkdirSync(path.join(home, "data"));
    const file = path.join(source, "notes.md");
    fs.writeFileSync(file, "hi");
    expect(errorFor({ path: "" })).toMatch(/full path, such as ~\/Documents\/project/);
    expect(errorFor({ path: "docs/specs" })).toMatch(/relative path.*full path/);
    expect(errorFor({ path: path.join(source, "missing") })).toMatch(/doesn't exist.*Check the path/);
    expect(errorFor({ path: file })).toMatch(/is a file, not a folder.*folder that contains it/);
    expect(errorFor({ path: userHome })).toBe("Pick a subfolder such as ~/Documents/project, not your whole home folder.");
    expect(errorFor({ path: "~" })).toMatch(/not your whole home folder/);
    expect(errorFor({ path: path.dirname(userHome) })).toMatch(/contains your whole home folder.*Pick a subfolder/);
    expect(errorFor({ path: path.parse(userHome).root })).toMatch(/top of the disk.*Pick a subfolder/);
    expect(errorFor({ path: path.join(userHome, ".ssh") })).toMatch(/~\/\.ssh holds keys.*Pick a folder with work documents/);
    expect(errorFor({ path: path.join(home, "data") })).toMatch(/own data folder.*upload the files/);
  });
});

describe("addKnowledgeFolder / removeKnowledgeFolder", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(home, "data", "employees", ME), { recursive: true });
    fs.writeFileSync(path.join(home, "data", "employees", ME, "employee.json"), JSON.stringify({ id: ME, name: "Maya Chen" }));
  });

  it("writes an audit entry with who, the twin, the label and the path on add and on remove", async () => {
    const added = await addKnowledgeFolder(ME, { path: source }, { userId: "user_1" });
    expect(added.folder).toMatchObject({ path: fs.realpathSync(source), label: path.basename(source) });
    expect(m.appendAuditEntry).toHaveBeenCalledTimes(1);
    expect(m.appendAuditEntry).toHaveBeenLastCalledWith(expect.objectContaining({
      employeeId: ME,
      employeeName: "Maya Chen",
      toolName: "knowledgeFolder.add",
      verdict: "executed",
      requesterId: "user_1",
      input: { employeeId: ME, path: fs.realpathSync(source), label: path.basename(source) },
    }));

    expect(await removeKnowledgeFolder(ME, fs.realpathSync(source))).toBe(true);
    expect(m.appendAuditEntry).toHaveBeenCalledTimes(2);
    const removeEntry = (m.appendAuditEntry.mock.calls as unknown as [Record<string, unknown>][])[1][0];
    expect(removeEntry).toMatchObject({
      employeeId: ME,
      toolName: "knowledgeFolder.remove",
      input: { employeeId: ME, path: fs.realpathSync(source), label: path.basename(source) },
    });
    // No-accounts local mode: no session user, so no requester is recorded.
    expect(removeEntry).not.toHaveProperty("requesterId");
    expect(listKnowledgeFolders(ME)).toEqual([]);
  });

  it("does not audit a rejected add or a remove of an unknown folder", async () => {
    expect((await addKnowledgeFolder(ME, { path: userHome })).error).toMatch(/whole home folder/);
    expect(await removeKnowledgeFolder(ME, source)).toBe(false);
    expect(m.appendAuditEntry).not.toHaveBeenCalled();
  });

  it("explains duplicates, the 5-folder limit and a missing twin", async () => {
    await addKnowledgeFolder(ME, { path: source, label: "Source" });
    expect((await addKnowledgeFolder(ME, { path: source })).error).toMatch(/already added.*remove it first/);
    for (let i = 0; i < 4; i += 1) {
      const dir = path.join(source, `more-${i}`);
      fs.mkdirSync(dir);
      expect((await addKnowledgeFolder(ME, { path: dir })).folder).toBeDefined();
    }
    const sixth = path.join(source, "sixth");
    fs.mkdirSync(sixth);
    expect((await addKnowledgeFolder(ME, { path: sixth })).error).toMatch(/at most 5 folders.*Remove one/);
    expect((await addKnowledgeFolder("nobody", { path: source })).error).toMatch(/twin wasn't found.*Reload/);
  });
});
