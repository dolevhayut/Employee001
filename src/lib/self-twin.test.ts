import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-self-"));
  process.env.EMPLOYEE001_HOME = home;
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const notes = "I run customer success. ".repeat(20);

describe("Build my twin", () => {
  it("asks for a name, a role and a few paragraphs", async () => {
    const { selfTwinProblem } = await import("./self-twin");
    expect(selfTwinProblem({ name: "", role: "CS", notes })).toMatch(/name/);
    expect(selfTwinProblem({ name: "Dana", role: "", notes })).toMatch(/role/);
    expect(selfTwinProblem({ name: "Dana", role: "CS", notes: "short" })).toMatch(/a bit more/);
    expect(selfTwinProblem({ name: "Dana", role: "CS", notes })).toBeNull();
  });

  it("creates the twin with the person's own consent and notes, and no profile yet", async () => {
    const { createSelfTwin, SELF_NOTES_FILE } = await import("./self-twin");
    const { loadEmployeesFromDisk } = await import("./employees-disk");
    const { consentStatusFor, buildBlockReason, toolkitAllowed } = await import("./consent-policy");
    const { employeeExists } = await import("./employees-files");

    const { employeeId } = await createSelfTwin({ name: "Dana Levi", role: "Head of CS", notes, headers: new Headers() });
    expect(employeeId).toMatch(/^dana-levi-[0-9a-f]{6}$/);

    const dir = path.join(home, "data", "employees", employeeId);
    const sidecar = JSON.parse(fs.readFileSync(path.join(dir, "employee.json"), "utf8"));
    expect(sidecar).toMatchObject({ name: "Dana Levi", role: "Head of CS", via: { self: true }, consent: { scopes: ["data-collection"] } });
    expect(fs.readFileSync(path.join(dir, "knowledge", SELF_NOTES_FILE), "utf8")).toContain("I run customer success.");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".md"))).toEqual([]);

    // Pending until the builder writes the profile; uploads work meanwhile.
    const [twin] = await loadEmployeesFromDisk();
    expect(twin).toMatchObject({ id: employeeId, twinStatus: "pending" });
    expect(employeeExists(employeeId)).toBe(true);
    expect(employeeExists("../etc")).toBe(false);

    // The builder may train on it, but never reads the person's tools.
    const status = consentStatusFor(sidecar, false);
    expect(buildBlockReason(status, "Dana")).toBeNull();
    expect(toolkitAllowed(status, "gmail")).toBe(false);
  });
});
