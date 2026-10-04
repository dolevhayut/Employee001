import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CouncilEvent } from "./council-runner";
import { parseRecording, type DemoRecording } from "./demo-recording";
import { loadEmployeesFromDisk } from "./employees-disk";

const fixtureRoot = path.resolve(process.cwd(), "bin", "demo");
const baseFiles = [
  "EXPERTISE.md", "DECISIONS.md", "CONTEXT.md", "PEOPLE.md", "PROJECTS.md",
  "PREFERENCES.md", "TONE.md", "BOUNDARIES.md", "EMPLOYMENT.md",
];
const bannedNames = ["daniel-azoulay", "itai-cohen", "noa-friedman", "shira-levi", "yotam-bar-lev"];
const originalHome = process.env.EMPLOYEE001_HOME;
const tempHomes: string[] = [];

afterEach(async () => {
  if (originalHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = originalHome;
  await Promise.all(tempHomes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

async function allFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  }));
  return nested.flat();
}

function asCouncilEvent(event: DemoRecording["events"][number]["event"]): CouncilEvent {
  return event;
}

describe.sequential("demo fixture", () => {
  it("has a small, complete, synthetic five-twin data tree", async () => {
    const files = await allFiles(fixtureRoot);
    const bytes = (await Promise.all(files.map(async (file) => (await fs.stat(file)).size)))
      .reduce((total, size) => total + size, 0);
    expect(bytes).toBeLessThanOrEqual(600 * 1024);

    const contents = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n").toLowerCase();
    for (const bannedName of bannedNames) expect(contents).not.toContain(bannedName);

    const employeeRoot = path.join(fixtureRoot, "data", "employees");
    const employeeIds = (await fs.readdir(employeeRoot)).sort();
    expect(employeeIds).toHaveLength(5);
    for (const employeeId of employeeIds) {
      const employeeDir = path.join(employeeRoot, employeeId);
      await expect(fs.stat(path.join(employeeDir, "employee.json"))).resolves.toBeDefined();
      await Promise.all(baseFiles.map((file) => expect(fs.stat(path.join(employeeDir, file))).resolves.toBeDefined()));
    }
  });

  it("loads from a copied EMPLOYEE001_HOME as five ready twins", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "employee001-demo-fixture-"));
    tempHomes.push(home);
    await fs.cp(path.join(fixtureRoot, "data"), path.join(home, "data"), { recursive: true });
    process.env.EMPLOYEE001_HOME = home;

    const employees = await loadEmployeesFromDisk();
    expect(employees).toHaveLength(5);
    expect(employees.every((employee) => employee.twinStatus === "ready")).toBe(true);
    expect(employees.every((employee) => employee.profileFilesComplete === 9)).toBe(true);
  });

  it("contains an ordered recording made only of supported council frames", async () => {
    const recording = parseRecording(JSON.parse(await fs.readFile(path.join(fixtureRoot, "recording.json"), "utf8")));
    expect(recording.participantIds).toHaveLength(5);
    expect(recording.events.at(-1)?.event.type).toBe("council_done");

    const states = new Map<string, "started" | "done">();
    for (const { event } of recording.events) {
      asCouncilEvent(event);
      if (event.type === "council_done") continue;
      expect(recording.participantIds).toContain(event.employeeId);
      if (event.type === "employee_start") {
        expect(states.has(event.employeeId)).toBe(false);
        states.set(event.employeeId, "started");
      } else if (event.type === "text_delta") {
        expect(states.get(event.employeeId)).toBe("started");
      } else if (event.type === "employee_done") {
        expect(states.get(event.employeeId)).toBe("started");
        states.set(event.employeeId, "done");
      }
    }
    expect([...states.values()]).toEqual(Array(5).fill("done"));
  });
});
