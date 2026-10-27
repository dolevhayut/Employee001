import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeAge, staleProfileFiles } from "./profile-age";

const DAY = 86_400_000;
let home: string;
const dir = (id: string) => path.join(home, "data", "employees", id);

function twin(id: string, files: Record<string, number>, sidecar: Record<string, unknown> = {}) {
  fs.mkdirSync(dir(id), { recursive: true });
  fs.writeFileSync(path.join(dir(id), "employee.json"), JSON.stringify({ id, name: "Dana Katz", ...sidecar }));
  const now = Date.now();
  for (const [name, daysOld] of Object.entries(files)) {
    const p = path.join(dir(id), name);
    fs.writeFileSync(p, `# ${name}\nsome content that is long enough\n`);
    const t = new Date(now - daysOld * DAY);
    fs.utimesSync(p, t, t);
  }
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-age-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("age helpers", () => {
  it("words the age", () => {
    expect(describeAge(41)).toBe("41 days old");
    expect(describeAge(1)).toBe("1 day old");
    expect(describeAge(0)).toBe("updated today");
    expect(describeAge(0, "confirmed")).toBe("confirmed today");
  });

  it("lists only files older than 30 days, oldest first", () => {
    const ages = [{ days: 31 }, { days: 30 }, { days: 90 }, { days: 2 }];
    expect(staleProfileFiles(ages).map((a) => a.days)).toEqual([90, 31]);
  });
});

describe("profile file ages on disk", () => {
  it("shows the last-written age for a file that was never confirmed", async () => {
    twin("dana", { "DECISIONS.md": 41, "TONE.md": 3 });
    const { profileFileAges } = await import("./employees-disk");
    const ages = await profileFileAges("dana");
    expect(ages.map((a) => [a.file, a.days, a.basis])).toEqual([
      ["DECISIONS.md", 41, "written"],
      ["TONE.md", 3, "written"],
    ]);
  });

  it("'Still true' resets the age, keeps content and mtime, and is audited", async () => {
    twin("dana", { "DECISIONS.md": 41 });
    const file = path.join(dir("dana"), "DECISIONS.md");
    const before = { body: fs.readFileSync(file, "utf8"), mtime: fs.statSync(file).mtimeMs };
    const { confirmProfileFile, profileFileAges } = await import("./employees-disk");

    expect(await confirmProfileFile("dana", "DECISIONS.md", { id: "usr_1" })).toMatchObject({ days: 0, basis: "confirmed" });

    expect(fs.readFileSync(file, "utf8")).toBe(before.body);
    expect(fs.statSync(file).mtimeMs).toBe(before.mtime);
    expect(await profileFileAges("dana")).toMatchObject([{ file: "DECISIONS.md", days: 0, basis: "confirmed" }]);
    const sidecar = JSON.parse(fs.readFileSync(path.join(dir("dana"), "employee.json"), "utf8"));
    expect(sidecar.name).toBe("Dana Katz");

    const rows = fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ toolName: "confirmProfileFile", employeeId: "dana", input: { file: "DECISIONS.md" }, approvedBy: "usr_1" });
  });

  it("counts from the write when the file was edited after it was confirmed", async () => {
    twin("dana", { "DECISIONS.md": 1 }, { profileConfirmedAt: { "DECISIONS.md": new Date(Date.now() - 20 * DAY).toISOString() } });
    const { profileFileAges } = await import("./employees-disk");
    expect(await profileFileAges("dana")).toMatchObject([{ days: 1, basis: "written" }]);
  });

  it("fails loudly, and records nothing, when the sidecar is unreadable", async () => {
    twin("dana", { "DECISIONS.md": 5 });
    fs.writeFileSync(path.join(dir("dana"), "employee.json"), "{not json");
    const { confirmProfileFile } = await import("./employees-disk");
    await expect(confirmProfileFile("dana", "DECISIONS.md")).rejects.toThrow();
    expect(fs.existsSync(path.join(home, "data", "audit.jsonl"))).toBe(false);
  });

  it("refuses to confirm a retired twin's file and records nothing", async () => {
    twin("dana", { "DECISIONS.md": 41 }, { lifecycle: "retired" });
    const { confirmProfileFile } = await import("./employees-disk");
    expect(await confirmProfileFile("dana", "DECISIONS.md", { id: "usr_1" })).toBeNull();
    const sidecar = JSON.parse(fs.readFileSync(path.join(dir("dana"), "employee.json"), "utf8"));
    expect(sidecar.profileConfirmedAt).toBeUndefined();
    expect(fs.existsSync(path.join(home, "data", "audit.jsonl"))).toBe(false);
  });

  it("refuses unknown files, unknown twins and path tricks", async () => {
    twin("dana", { "DECISIONS.md": 5 });
    const { confirmProfileFile, profileFileAges } = await import("./employees-disk");
    expect(await confirmProfileFile("dana", "../employee.json")).toBeNull();
    expect(await confirmProfileFile("dana", "TONE.md")).toBeNull(); // not on disk
    expect(await confirmProfileFile("../dana", "DECISIONS.md")).toBeNull();
    expect(await profileFileAges("nobody")).toEqual([]);
    expect(fs.existsSync(path.join(home, "data", "audit.jsonl"))).toBe(false);
  });
});
