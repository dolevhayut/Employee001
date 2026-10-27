import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let previousCwd: string;
let tempDir: string;
let mod: typeof import("./contradictions");
let feed: typeof import("./feed-store");
let audit: typeof import("./audit-log");

function writeTwin(id: string, name: string, files: Record<string, string> = {}) {
  const dir = path.join(tempDir, "data", "employees", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "employee.json"), JSON.stringify({ id, name, role: "Lead", department: "Eng" }));
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
}

function writeFact(id: string, fact: Record<string, unknown>) {
  const dir = path.join(tempDir, "data", "memory", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, "structured.jsonl"),
    JSON.stringify({ employeeId: id, runId: "run_1", confidence: 0.8, source: "user", createdAt: "2026-01-01T00:00:00Z", ...fact }) + "\n"
  );
}

beforeEach(async () => {
  previousCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e1235-"));
  process.chdir(tempDir);
  vi.resetModules();
  mod = await import("./contradictions");
  feed = await import("./feed-store");
  audit = await import("./audit-log");
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("claim extraction", () => {
  it("reads copula, label and actor claims and skips questions, negations and personal ones", () => {
    expect(mod.extractClaim("The release approver is Dana")).toEqual({ subject: "The release approver", value: "Dana" });
    expect(mod.extractClaim("- **Release approver:** Omer")).toEqual({ subject: "Release approver", value: "Omer" });
    expect(mod.extractClaim("Dana approves releases.")).toEqual({ subject: "approves releases", value: "Dana" });
    expect(mod.extractClaim("Who is the release approver?")).toBeNull();
    expect(mod.extractClaim("The release approver is not Dana")).toBeNull();
    expect(mod.extractClaim("## Heading is here")).toBeNull();
  });

  it("treats a value that contains the other as agreement", () => {
    expect(mod.valuesConflict("Dana", "Dana Katz")).toBe(false);
    expect(mod.valuesConflict("Dana", "dana.")).toBe(false);
    expect(mod.valuesConflict("Dana", "Omer")).toBe(true);
  });
});

describe("contradiction scan", () => {
  it("files exactly one Inbox item for two conflicting twins, with both sources, and not again on re-scan", async () => {
    writeTwin("dana", "Dana Katz", { "CONTEXT.md": "# Context\n\n- The release approver is Dana\n- Our stack is TypeScript\n" });
    writeTwin("omer", "Omer Levi");
    writeFact("omer", { id: "fact_1", type: "fact", key: "omer-approves", value: "Omer", evidence: "The release approver is Omer" });
    writeTwin("noa", "Noa Peretz", { "CONTEXT.md": "- Our stack is TypeScript\n" });

    const first = await mod.scanContradictions(null);
    expect(first).toMatchObject({ twinsScanned: 3, created: 1, alreadyFiled: 0 });
    expect(first.conflicts).toHaveLength(1);

    const items = feed.listFeed({ type: "alert" });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("open");
    expect(items[0].detail).toContain("profile: CONTEXT.md line 3");
    expect(items[0].detail).toContain("memory: durable fact fact_1");
    // Memory-sourced values are cited, never quoted.
    expect(items[0].detail).not.toContain("Omer\"");
    expect(items[0].detail).toContain('Dana Katz: "Dana"');
    expect(items[0].source).toMatchObject({ kind: "contradiction" });

    const second = await mod.scanContradictions(null);
    expect(second).toMatchObject({ created: 0, alreadyFiled: 1 });
    expect(feed.listFeed({ type: "alert" })).toHaveLength(1);
  });

  it("does not re-file a conflict the CEO already dismissed", async () => {
    writeTwin("dana", "Dana", { "CONTEXT.md": "- The release approver is Dana\n" });
    writeTwin("omer", "Omer", { "CONTEXT.md": "- The release approver is Omer\n" });
    await mod.scanContradictions(null);
    const [item] = feed.listFeed({ type: "alert" });
    feed.resolveFeedItem(item.id, "dismissed");
    const again = await mod.scanContradictions(null);
    expect(again.created).toBe(0);
    expect(feed.listFeed({ type: "alert" })).toHaveLength(1);
  });

  it("files nothing when twins agree, and ignores retired twins and personal profile files", async () => {
    writeTwin("dana", "Dana", { "CONTEXT.md": "- The release approver is Dana\n" });
    writeTwin("omer", "Omer", { "CONTEXT.md": "- The release approver is Dana Katz\n", "PREFERENCES.md": "- Favorite editor is vim\n" });
    writeTwin("noa", "Noa", { "PREFERENCES.md": "- Favorite editor is emacs\n" });
    const result = await mod.scanContradictions(null);
    expect(result.conflicts).toHaveLength(0);
    expect(feed.listFeed()).toHaveLength(0);

    writeTwin("old", "Old Timer", { "CONTEXT.md": "- The release approver is Zed\n" });
    const sidecar = path.join(tempDir, "data", "employees", "old", "employee.json");
    fs.writeFileSync(sidecar, JSON.stringify({ id: "old", name: "Old Timer", lifecycle: "retired" }));
    expect((await mod.scanContradictions(null)).conflicts).toHaveLength(0);
  });

  it("ignores generic labels and keeps one item per twin pair and subject when a value is edited", async () => {
    writeTwin("dana", "Dana", { "CONTEXT.md": "- Status: active\n- The release approver is Dana\n" });
    writeTwin("omer", "Omer", { "CONTEXT.md": "- Status: blocked\n- The release approver is Omer\n" });
    expect((await mod.scanContradictions(null)).created).toBe(1);
    fs.writeFileSync(
      path.join(tempDir, "data", "employees", "omer", "CONTEXT.md"),
      "- The release approver is Sam\n"
    );
    expect((await mod.scanContradictions(null)).created).toBe(0);
    expect(feed.listFeed({ type: "alert" })).toHaveLength(1);
  });

  it("refuses viewers below the member role and runs for members", async () => {
    expect(mod.canRunContradictionScan({ id: "u1", role: "employee" })).toBe(false);
    await expect(mod.scanContradictions({ id: "u1", role: "employee" })).rejects.toThrow("forbidden");
    expect(mod.canRunContradictionScan({ id: "u2", role: "member" })).toBe(true);
    expect(mod.canRunContradictionScan(null)).toBe(true);
  });

  it("audits every run with the viewer and the counts", async () => {
    writeTwin("dana", "Dana", { "CONTEXT.md": "- The release approver is Dana\n" });
    writeTwin("omer", "Omer", { "CONTEXT.md": "- The release approver is Omer\n" });
    await mod.scanContradictions({ id: "u2", role: "member" });
    await mod.scanContradictions({ id: "u2", role: "member" });
    const rows = audit.readAuditLog({}).entries.filter((e) => e.toolName === "contradictionScan");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.input.created).sort()).toEqual([0, 1]);
    expect(rows[0].requesterId).toBe("u2");
  });
});
