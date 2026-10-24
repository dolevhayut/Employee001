import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleContextPackage } from "./rcp.types";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-relay-pkg-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const item = (id: string, title: string, body: string, verified = true) => ({
  id, title, body, provenance: "interview" as const, confidence: 0.8, gaps: [], evidenceQuote: `quote ${id}`, verified,
});

function rcp(): RoleContextPackage {
  return {
    source_twin_id: "dana",
    schema_version: "relay-rcp-1",
    generated_at: "2026-10-24T10:00:00.000Z",
    synth_mode: "model",
    status: "draft",
    decision_rules: [item("r1", "Refunds over $500", "Need finance sign-off"), item("r2", "Escalation", "Call Sarah first", false)],
    playbooks: [item("p1", "Month-end close", "1. Export\n2. Reconcile")],
    contact_graph: [],
    edge_cases: [],
    tooling_map: [{ id: "t1", system: "Billing console", location: "behind VPN", accessVia: "IT ticket", provenance: "interview", confidence: 0.7, gaps: [] }],
    glossary: [],
    open_loops: [],
    provenance: { interviewerModel: "m", transcriptRef: "live", redactionApplied: true, itemCount: 4, consent: { subjectId: "dana", grantedAt: "x", banner: "b" }, auditRunId: "live" },
  };
}

describe("handover package", () => {
  it("edits and removals clear an earlier approval and keep the item count right", async () => {
    const { applyItemEdit, approvePackage } = await import("./package-store");
    const approved = approvePackage(rcp(), "u1");
    expect(approved.review?.approvedBy).toBe("u1");

    const removed = applyItemEdit(approved, { op: "remove", field: "decision_rules", itemId: "r2" })!;
    expect(removed.decision_rules.map((i) => i.id)).toEqual(["r1"]);
    expect(removed.review).toBeUndefined();
    expect(removed.provenance.itemCount).toBe(3);

    const edited = applyItemEdit(rcp(), { op: "update", field: "tooling_map", itemId: "t1", title: "Billing admin" })!;
    expect(edited.tooling_map[0]).toMatchObject({ system: "Billing admin", location: "behind VPN" });
    expect(applyItemEdit(rcp(), { op: "remove", field: "glossary", itemId: "nope" })).toBeNull();
  });

  it("renders Markdown with sources, and flags what the interview doesn't confirm", async () => {
    const { packageMarkdown } = await import("./package-store");
    const md = packageMarkdown(rcp(), { name: "Dana Levi", role: "Head of Ops", withSources: true });
    expect(md).toContain("# Handover: Dana Levi, Head of Ops");
    expect(md).toContain("- **Refunds over $500**: Need finance sign-off");
    expect(md).toContain("  1. Export");
    expect(md).toContain("> quote r1");
    expect(md).toContain("_Not confirmed word for word in the interview._");
    expect(md).toContain("- **Billing console**: behind VPN; access: IT ticket");
    expect(md).not.toContain("## Glossary");
    expect(packageMarkdown(rcp(), { name: "Dana" })).not.toContain("> quote");
  });

  it("saves the interview and package to disk", async () => {
    const { saveInterview, loadInterview, savePackage, loadPackage, deleteHandover } = await import("./package-store");
    await saveInterview("dana", [{ role: "assistant", content: "Hi" }, { role: "user", content: "Hello" }]);
    expect(await loadInterview("dana")).toHaveLength(2);
    await savePackage("dana", rcp());
    expect((await loadPackage("dana"))?.source_twin_id).toBe("dana");
    await deleteHandover("dana");
    expect(await loadPackage("dana")).toBeNull();
    expect(await loadInterview("dana")).toEqual([]);
  });

  it("an edit is redacted, marked unconfirmed, and changes the approval digest", async () => {
    const { applyItemEdit, packageDigest, approvePackage } = await import("./package-store");
    const before = rcp();
    const edited = applyItemEdit(before, { op: "update", field: "decision_rules", itemId: "r1", body: "Mail dana@corp.com first" })!;
    expect(edited.decision_rules[0]).toMatchObject({ body: "Mail [REDACTED-EMAIL] first", verified: false });
    expect(packageDigest(edited)).not.toBe(packageDigest(before));
    expect(packageDigest(approvePackage(before))).toBe(packageDigest(before));
  });
});

