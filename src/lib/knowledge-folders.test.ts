import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateKnowledgeFolder } from "./knowledge-folders";

describe("validateKnowledgeFolder", () => {
  let home = "";
  let source = "";
  const originalHome = process.env.EMPLOYEE001_HOME;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-folder-validation-"));
    source = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-folder-source-"));
    process.env.EMPLOYEE001_HOME = home;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.EMPLOYEE001_HOME;
    else process.env.EMPLOYEE001_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  });

  it("requires an existing absolute directory and canonicalizes symlinks", () => {
    const link = path.join(home, "link");
    fs.symlinkSync(source, link);
    expect(validateKnowledgeFolder({ path: "source", label: "Source" }).ok).toBe(false);
    expect(validateKnowledgeFolder({ path: link, label: "Source" })).toMatchObject({ ok: true, folder: { path: fs.realpathSync(source) } });
  });

  it("refuses the data directory, root, the home folder and above, and protected home folders", () => {
    fs.mkdirSync(path.join(home, "data", "employees"), { recursive: true });
    for (const folder of [path.join(home, "data"), path.join(home, "data", "employees"), path.parse(home).root, os.homedir(), path.dirname(os.homedir()), path.join(os.homedir(), ".ssh")]) {
      if (!fs.existsSync(folder)) continue;
      expect(validateKnowledgeFolder({ path: folder, label: "No" }).ok).toBe(false);
    }
  });

  it("allows a folder that contains the data dir, such as the repo in dev", () => {
    fs.mkdirSync(path.join(home, "data"));
    expect(validateKnowledgeFolder({ path: home, label: "Repo" }).ok).toBe(true);
  });
});
