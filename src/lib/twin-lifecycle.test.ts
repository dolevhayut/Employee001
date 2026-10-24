import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const sidecar = (id: string) => path.join(home, "data", "employees", id, "employee.json");
function twin(id: string, body: Record<string, unknown> = {}) {
  fs.mkdirSync(path.dirname(sidecar(id)), { recursive: true });
  fs.writeFileSync(sidecar(id), JSON.stringify({ id, name: id, ...body }));
}
const read = (id: string) => JSON.parse(fs.readFileSync(sidecar(id), "utf8"));
const auditRows = () =>
  fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-lifecycle-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("nextLifecycle", () => {
  it("only moves forward through handover, and retiring needs retention consent", async () => {
    const { nextLifecycle } = await import("./twin-lifecycle");
    expect(nextLifecycle({ lifecycle: "active" }, "start-handover")).toEqual({ ok: true, lifecycle: "handover" });
    expect(nextLifecycle({ lifecycle: "active" }, "retire").ok).toBe(false);
    expect(nextLifecycle({ lifecycle: "handover" }, "retire").ok).toBe(false);
    const consent = { grantedAt: "x", textDigest: "d", locale: "en" as const };
    expect(nextLifecycle({ lifecycle: "handover", retention: consent }, "retire")).toEqual({ ok: true, lifecycle: "retired" });
    expect(nextLifecycle({ lifecycle: "retired", retention: consent }, "start-handover").ok).toBe(false);
    expect(nextLifecycle({ lifecycle: "handover" }, "cancel-handover")).toEqual({ ok: true, lifecycle: "active" });
  });
});

describe("lifecycle on disk", () => {
  it("runs a full handover, keeps the sidecar's other fields, and audits each step", async () => {
    twin("dana", { role: "Head of Ops", consent: { grantedAt: "x", version: "1.0", scopes: ["data-collection"] } });
    const { applyLifecycleAction, recordRetentionConsent, loadLifecycle, retentionConsentDigest } = await import("./twin-lifecycle");

    expect((await loadLifecycle("dana")).lifecycle).toBe("active");
    expect((await recordRetentionConsent("dana", { agree: true, locale: "en" })).ok).toBe(false);

    expect((await applyLifecycleAction("dana", "start-handover", { userId: "u1" })).ok).toBe(true);
    const refused = await applyLifecycleAction("dana", "retire");
    expect(refused).toMatchObject({ ok: false, status: 409 });

    await recordRetentionConsent("dana", { agree: true, locale: "he" });
    expect(read("dana").retention).toMatchObject({ locale: "he", textDigest: retentionConsentDigest("he") });

    const retired = await applyLifecycleAction("dana", "retire", { userId: "u1" });
    expect(retired.ok).toBe(true);
    const after = read("dana");
    expect(after).toMatchObject({ lifecycle: "retired", role: "Head of Ops", consent: { version: "1.0" } });
    expect(after.retiredAt).toBeTruthy();

    expect(auditRows().map((r) => r.bareName)).toEqual([
      "relay.start-handover",
      "relay.retentionConsentGranted",
      "relay.retire",
    ]);
  });

  it("a later 'no' withdraws an earlier 'yes'", async () => {
    twin("omer");
    const { applyLifecycleAction, recordRetentionConsent } = await import("./twin-lifecycle");
    await applyLifecycleAction("omer", "start-handover");
    await recordRetentionConsent("omer", { agree: true, locale: "en" });
    await recordRetentionConsent("omer", { agree: false, locale: "en" });
    expect(read("omer").retention).toBeUndefined();
    expect(read("omer").retentionDeclinedAt).toBeTruthy();
    expect((await applyLifecycleAction("omer", "retire")).ok).toBe(false);
  });

  it("the consent digest covers the Hebrew and English wording separately", async () => {
    const { retentionConsentDigest, retentionConsentText } = await import("./twin-lifecycle");
    expect(retentionConsentText("en")).toContain("relayConsent.agree=");
    expect(retentionConsentDigest("en")).not.toBe(retentionConsentDigest("he"));
  });
});
