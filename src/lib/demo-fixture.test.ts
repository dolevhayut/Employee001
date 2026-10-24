import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CouncilEvent } from "./council-runner";
import { parseRecording, type DemoRecording } from "./demo-recording";
import { displayRole } from "./employees";
import { loadEmployeesFromDisk } from "./employees-disk";
import { retentionConsentDigest, WITHHELD_DIR, WITHHELD_FILES } from "./twin-lifecycle";
import { verifyRcpEvidence } from "./relay/evidence";
import { loadHandoverState } from "./relay/handover-state";
import { packageMarkdown } from "./relay/package-store";
import { reviewedHandoverMarkdown } from "./relay/retired-twin";
import type { CapturedItem, RoleContextPackage, ToolingRef } from "./relay/rcp.types";

const fixtureRoot = path.resolve(process.cwd(), "bin", "demo");
const baseFiles = [
  "EXPERTISE.md", "DECISIONS.md", "CONTEXT.md", "PEOPLE.md", "PROJECTS.md",
  "PREFERENCES.md", "TONE.md", "BOUNDARIES.md", "EMPLOYMENT.md",
];
const bannedNames = ["daniel-azoulay", "itai-cohen", "noa-friedman", "shira-levi", "yotam-bar-lev"];
const RETIRED_ID = "theo-lindqvist";
const originalHome = process.env.EMPLOYEE001_HOME;
const tempHomes: string[] = [];

afterEach(async () => {
  if (originalHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = originalHome;
  await Promise.all(tempHomes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

async function copiedHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "employee001-demo-fixture-"));
  tempHomes.push(home);
  await fs.cp(path.join(fixtureRoot, "data"), path.join(home, "data"), { recursive: true });
  process.env.EMPLOYEE001_HOME = home;
  return home;
}

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
  it("has a small, complete, synthetic six-twin data tree", async () => {
    const all = await allFiles(fixtureRoot);
    const size = async (list: string[]) => (await Promise.all(list.map(async (file) => (await fs.stat(file)).size)))
      .reduce((total, bytes) => total + bytes, 0);
    // The recorded voice of the demo's Ask answers is the bulk of it.
    const audio = all.filter((file) => file.endsWith(".mp3"));
    const files = all.filter((file) => !file.endsWith(".mp3"));
    expect(await size(files)).toBeLessThanOrEqual(600 * 1024);
    expect(await size(audio)).toBeLessThanOrEqual(700 * 1024);

    const contents = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n").toLowerCase();
    for (const bannedName of bannedNames) expect(contents).not.toContain(bannedName);

    const employeeRoot = path.join(fixtureRoot, "data", "employees");
    const employeeIds = (await fs.readdir(employeeRoot)).sort();
    expect(employeeIds).toHaveLength(6);
    for (const employeeId of employeeIds) {
      const employeeDir = path.join(employeeRoot, employeeId);
      await expect(fs.stat(path.join(employeeDir, "employee.json"))).resolves.toBeDefined();
      // A retired twin's private files moved out of reach (twin-lifecycle.ts).
      const withheld: readonly string[] = employeeId === RETIRED_ID ? WITHHELD_FILES : [];
      await Promise.all(baseFiles.map((file) => expect(fs.stat(path.join(employeeDir, withheld.includes(file) ? WITHHELD_DIR : "", file))).resolves.toBeDefined()));
      for (const file of withheld) await expect(fs.stat(path.join(employeeDir, file))).rejects.toThrow();
    }
  });

  it("loads from a copied EMPLOYEE001_HOME as six ready twins, one of them retired", async () => {
    const home = await copiedHome();

    const employees = await loadEmployeesFromDisk();
    expect(employees).toHaveLength(6);
    expect(employees.every((employee) => employee.twinStatus === "ready")).toBe(true);
    expect(employees.every((employee) => employee.profileFilesComplete === 9)).toBe(true);
    const retired = employees.filter((employee) => employee.lifecycle === "retired");
    expect(retired.map((employee) => employee.id)).toEqual([RETIRED_ID]);
    expect(displayRole(retired[0])).toBe("Former Head of Revenue Operations");
    expect(home).toBeTruthy();
  });

  it("retires its former employee with their own consent to the current wording", async () => {
    const sidecar = JSON.parse(await fs.readFile(path.join(fixtureRoot, "data", "employees", RETIRED_ID, "employee.json"), "utf8"));
    expect(sidecar.lifecycle).toBe("retired");
    expect(Date.parse(sidecar.retiredAt)).toBeGreaterThan(Date.parse(sidecar.retention.grantedAt));
    expect(sidecar.retention.onBehalf).toBe(false);
    expect(sidecar.retention.locale).toBe("en");
    expect(sidecar.retention.textDigest).toBe(retentionConsentDigest("en"));
  });

  it("ships an approved handover package whose every quote is in the interview", async () => {
    await copiedHome();
    const state = await loadHandoverState(RETIRED_ID);
    expect(state?.lifecycle).toBe("retired");
    const rcp = state?.package as RoleContextPackage;
    expect(rcp.schema_version).toBe("relay-rcp-1");
    expect(rcp.source_twin_id).toBe(RETIRED_ID);
    expect(rcp.review?.approvedAt).toBeTruthy();
    expect(state?.coverage?.status).toBe("handover-ready");

    // Checked the way synthesis checks it: against the transcript as text.
    const transcript = state!.messages
      .map((m) => `${m.role === "assistant" ? "INTERVIEWER" : "EMPLOYEE"}: ${m.content.trim()}`)
      .join("\n\n");
    const fields = ["decision_rules", "playbooks", "contact_graph", "edge_cases", "tooling_map", "glossary", "open_loops"] as const;
    const checked = verifyRcpEvidence(rcp, transcript);
    const items = fields.flatMap((field): Array<CapturedItem | ToolingRef> => checked[field]);
    expect(items).toHaveLength(rcp.provenance.itemCount);
    expect(items.filter((item) => !item.verified).map((item) => item.id)).toEqual([]);

    const md = packageMarkdown(rcp, { name: state!.name, role: state!.role, withSources: true });
    expect(md).toContain("# Handover: Theo Lindqvist, Head of Revenue Operations");
    expect(md).not.toContain("Not confirmed word for word");
    expect(reviewedHandoverMarkdown(rcp, { name: state!.name, role: state!.role })).toContain("Elise Moreno");
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
