import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const sidecar = (id: string) => path.join(home, "data", "employees", id, "employee.json");
function twin(id: string, body: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(sidecar(id)), { recursive: true });
  fs.writeFileSync(sidecar(id), JSON.stringify({ id, name: id, ...body }));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-consent-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("consent migration", () => {
  it("marks only twins without consent that aren't synthetic, once, and audits it", async () => {
    twin("legacy-one", {});
    twin("consented", { consent: { grantedAt: "x", version: "1.0", scopes: ["data-collection"] } });
    twin("demo", { synthetic: true });
    const { markTwinsConsentRequired, listConsentRequired } = await import("./consent-migration");

    expect(markTwinsConsentRequired()).toEqual(["legacy-one"]);
    expect(JSON.parse(fs.readFileSync(sidecar("legacy-one"), "utf8"))).toMatchObject({ consentState: "consent_required" });
    expect(markTwinsConsentRequired()).toEqual([]);
    expect(listConsentRequired().map((t) => t.id)).toEqual(["legacy-one"]);

    const audit = fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ bareName: "consentMigration", input: { markedConsentRequired: ["legacy-one"] } });
  });
});
