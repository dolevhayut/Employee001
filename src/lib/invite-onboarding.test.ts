import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-invite-onboarding-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("invite onboarding", () => {
  it("keeps a connected but incomplete invite out of live twin surfaces", async () => {
    const { createInvite, materializeEmployeeFromInvite } = await import("./invites");
    const invite = createInvite({ name: "Dana Levi", role: "Head of CS" });
    const { employeeId } = await materializeEmployeeFromInvite(invite.token);

    const sidecarPath = path.join(home, "data", "employees", employeeId, "employee.json");
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    expect(sidecar.pendingProfile).toBe(true);

    // Directories made by 0.9.0 with a prefilled invite name had this flag
    // false. Their incomplete invite is still authoritative.
    fs.writeFileSync(sidecarPath, JSON.stringify({ ...sidecar, pendingProfile: false }));

    const { loadEmployeesFromDisk } = await import("./employees-disk");
    const { listConsentRequired } = await import("./consent-migration");
    const { getTelemetryPreview } = await import("./telemetry");

    expect(await loadEmployeesFromDisk()).toEqual([]);
    expect(listConsentRequired()).toEqual([]);
    expect((await getTelemetryPreview()).active_twins).toBe(0);
  });
});
