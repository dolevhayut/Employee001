import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-evidence-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const consent = { grantedAt: "2026-10-21T10:00:00.000Z", version: "1.0", scopes: ["integrations", "data-collection"] as const };

describe("consent evidence", () => {
  it("records who, when, which text, scopes, IP, user agent and channel in the hash chain", async () => {
    const { recordConsentEvidence, consentTextDigest } = await import("./consent-evidence");
    const { verifyAuditChain } = await import("./audit-log");
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 test" });
    expect(recordConsentEvidence({ employeeId: "noa", employeeName: "Noa F", inviteToken: "tok_secret", consent: { ...consent, scopes: [...consent.scopes] }, locale: "he", headers })).toBe(true);

    const row = JSON.parse(fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8").trim());
    expect(row).toMatchObject({
      bareName: "consentRecorded",
      employeeId: "noa",
      approvedBy: "employee:noa",
      input: {
        employeeName: "Noa F",
        grantedAt: consent.grantedAt,
        consentVersion: "1.0",
        consentTextLocale: "he",
        consentTextSha256: consentTextDigest("he"),
        scopes: ["data-collection", "integrations"],
        ip: "203.0.113.7",
        userAgent: "Mozilla/5.0 test",
        channel: "invite",
      },
    });
    expect(JSON.stringify(row)).not.toContain("tok_secret");
    expect(row.hash).toBeTruthy();
    expect(verifyAuditChain().ok).toBe(true);
  });

  it("hashes different wording per language", async () => {
    const { consentTextDigest } = await import("./consent-evidence");
    expect(consentTextDigest("en")).not.toBe(consentTextDigest("he"));
    expect(consentTextDigest("en")).toMatch(/^[0-9a-f]{64}$/);
  });
});
