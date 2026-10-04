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
