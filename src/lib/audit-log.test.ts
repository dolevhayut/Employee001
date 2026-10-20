import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
let tempDir: string | undefined;

async function auditModule() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-audit-"));
  process.chdir(tempDir);
  vi.resetModules();
  return import("./audit-log");
}

function entry(input: Record<string, unknown> = {}) {
  return {
    runId: "run_1",
    employeeId: "employee_1",
    employeeName: "Ada",
    toolName: "mcp__mail__send",
    bareName: "send",
    input,
    verdict: "executed" as const,
  };
}

function auditFile() {
  // Never resolve against the repo itself: a test writing here would overwrite
  // the project's real audit log (it happened once, 2026-10-20).
  if (!tempDir || process.cwd() === originalCwd) {
    throw new Error("audit test touched the real data dir: call auditModule() first");
  }
  return path.join(process.cwd(), "data", "audit.jsonl");
}

afterEach(() => {
  vi.useRealTimers();
  process.chdir(originalCwd);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  vi.resetModules();
});

describe("audit hash chain", () => {
  it("verifies a chain with recursively canonicalized input", async () => {
    const { appendAuditEntry, verifyAuditChain } = await auditModule();
    appendAuditEntry(entry({ z: 1, nested: { z: "last", a: "first" } }));
    appendAuditEntry(entry({ a: [undefined, 2, { b: true, a: false }], omitted: undefined }));

    expect(verifyAuditChain()).toEqual({ ok: true, checked: 2, legacy: 0 });
  });

  it("reports the edited middle row", async () => {
    const { appendAuditEntry, verifyAuditChain } = await auditModule();
    appendAuditEntry(entry({ subject: "one" }));
    appendAuditEntry(entry({ subject: "two" }));
    appendAuditEntry(entry({ subject: "three" }));
    const rows = fs.readFileSync(auditFile(), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    rows[1].input.subject = "tampered";
    fs.writeFileSync(auditFile(), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

    expect(verifyAuditChain()).toMatchObject({ ok: false, firstBadId: rows[1].id, reason: "hash mismatch" });
  });

  it("detects a deleted row through its successor's previous hash", async () => {
    const { appendAuditEntry, verifyAuditChain } = await auditModule();
    appendAuditEntry(entry({ sequence: 1 }));
    appendAuditEntry(entry({ sequence: 2 }));
    appendAuditEntry(entry({ sequence: 3 }));
    const rows = fs.readFileSync(auditFile(), "utf8").trim().split("\n");
    const successor = JSON.parse(rows[2]) as { id: string };
    fs.writeFileSync(auditFile(), `${rows[0]}\n${rows[2]}\n`);

    expect(verifyAuditChain()).toMatchObject({ ok: false, firstBadId: successor.id, reason: "previous hash mismatch" });
  });

  it("counts legacy rows before a chain without treating them as tampering", async () => {
    const { appendAuditEntry, verifyAuditChain } = await auditModule();
    fs.mkdirSync(path.dirname(auditFile()), { recursive: true });
    fs.writeFileSync(auditFile(), `${JSON.stringify({ id: "legacy_1", ts: "2020-01-01T00:00:00.000Z" })}\n`);
    appendAuditEntry(entry());

    expect(verifyAuditChain()).toEqual({ ok: true, checked: 1, legacy: 1 });
  });

  it("keeps a chain verifiable across rotation archives and the active file", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const { appendAuditEntry, verifyAuditChain } = await auditModule();
    appendAuditEntry(entry({ payload: "x".repeat(10 * 1024 * 1024) }));
    vi.setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
    appendAuditEntry(entry({ afterRotation: true }));

    expect(fs.existsSync(path.join(process.cwd(), "data", "audit.2020-01.jsonl"))).toBe(true);
    expect(verifyAuditChain()).toEqual({ ok: true, checked: 2, legacy: 0 });
  }, 15_000);
});

describe("audit redaction", () => {
  const row = (employeeId: string, input: Record<string, unknown>) => ({
    runId: "r", employeeId, employeeName: "Noa", toolName: "Read", bareName: "Read",
    input, verdict: "executed" as const,
  });
  const rows = () => fs.readFileSync(auditFile(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const save = (all: unknown[]) => fs.writeFileSync(auditFile(), all.map((r) => JSON.stringify(r)).join("\n") + "\n");

  it("detects a changed name on a row that wasn't redacted", async () => {
    const { appendAuditEntry, verifyAuditChain } = await auditModule();
    appendAuditEntry(row("noa", { a: 1 }));
    const all = rows();
    all[0].employeeName = "Someone Else";
    save(all);
    expect(verifyAuditChain()).toMatchObject({ ok: false, reason: "hash mismatch" });
  });

  it("only accepts a purge record for the same employee, after the rows it lists", async () => {
    const { appendAuditEntry, redactEmployeeAudit, verifyAuditChain } = await auditModule();
    // A purge record written BEFORE the row it claims to cover.
    appendAuditEntry({ ...row("noa", { redactedIds: ["later"] }), bareName: "purgeEmployee", toolName: "purgeEmployee" });
    appendAuditEntry(row("noa", { secret: 1 }));
    const all = rows();
    all[1].id = "later";
    save(all);
    // Rewriting the id breaks that row's hash, so rebuild the scenario cleanly:
    expect(verifyAuditChain().ok).toBe(false);

    fs.writeFileSync(auditFile(), "");
    appendAuditEntry(row("noa", { secret: 1 }));
    const { redactedIds } = redactEmployeeAudit("noa");
    // A purge record for a different employee doesn't count.
    appendAuditEntry({ ...row("other", { redactedIds }), bareName: "purgeEmployee", toolName: "purgeEmployee" });
    expect(verifyAuditChain()).toMatchObject({ ok: false, reason: "redacted row without a purge record" });
  });

  it("rejects a purge record that was itself marked redacted", async () => {
    const { appendAuditEntry, verifyAuditChain } = await auditModule();
    appendAuditEntry({ ...row("noa", { redactedIds: [] }), bareName: "purgeEmployee", toolName: "purgeEmployee" });
    const all = rows();
    all[0].redacted = { at: "x" };
    save(all);
    expect(verifyAuditChain()).toMatchObject({ ok: false, reason: "redacted purge record" });
  });

  it("vouches for redacted legacy rows by pin, and catches edits to them", async () => {
    const { createHash } = await import("node:crypto");
    const stable = (v: unknown): string =>
      Array.isArray(v) ? `[${v.map(stable).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
        : JSON.stringify(v);
    const legacy = { id: "aud_legacy_1", ts: "2026-05-01T00:00:00.000Z", ...row("noa", { to: "doctor@x" }), prevHash: "genesis" };
    const hash = createHash("sha256").update(`genesis\n${stable(legacy)}`).digest("hex");
    const { appendAuditEntry, redactEmployeeAudit, verifyAuditChain } = await auditModule();
    fs.mkdirSync(path.dirname(auditFile()), { recursive: true });
    fs.writeFileSync(auditFile(), JSON.stringify({ ...legacy, hash }) + "\n");
    expect(verifyAuditChain()).toMatchObject({ ok: true, checked: 1 });
    const { redactedIds, legacyPins } = redactEmployeeAudit("noa");
    appendAuditEntry({ ...row("noa", { redactedIds, legacyPins }), bareName: "purgeEmployee", toolName: "purgeEmployee" });
    expect(fs.readFileSync(auditFile(), "utf8")).not.toContain("doctor@x");
    expect(verifyAuditChain()).toMatchObject({ ok: true });

    // Forging the verdict on the redacted legacy row breaks its pin.
    const all = rows();
    all[0].verdict = "ceo_approved";
    save(all);
    expect(verifyAuditChain()).toMatchObject({ ok: false, reason: "redacted row without a purge record" });
  });
});
