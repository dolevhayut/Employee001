import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAuditLines as verifyCli } from "../../bin/lib/audit-verify.mjs";

vi.mock("./composio-client", () => ({ disconnectAllToolkits: async () => 0 }));

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-auditcli-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("CLI audit verifier matches the app's", () => {
  it("agrees on intact, purged and tampered chains", async () => {
    const audit = await import("./audit-log");
    for (const id of ["noa", "itai", "noa"]) {
      audit.appendAuditEntry({ runId: "r", employeeId: id, employeeName: id, toolName: "Read", bareName: "Read", input: { f: id }, verdict: "executed", requesterId: "u1" });
    }
    const { purgeEmployee } = await import("./employee-purge");
    await purgeEmployee("noa");
    const lines = audit.exportAuditChain().trim().split("\n");

    const intact = verifyCli(lines);
    expect(intact).toEqual(audit.verifyAuditLines(lines));
    expect(intact.ok).toBe(true);

    const tampered = [...lines];
    const row = JSON.parse(tampered[1]);
    row.input = { f: "edited" };
    tampered[1] = JSON.stringify(row);
    expect(verifyCli(tampered)).toEqual(audit.verifyAuditLines(tampered));
    expect(verifyCli(tampered).ok).toBe(false);

    const dropped = lines.filter((_, i) => i !== 1);
    expect(verifyCli(dropped)).toEqual(audit.verifyAuditLines(dropped));
    expect(verifyCli(dropped).ok).toBe(false);
  });
});
