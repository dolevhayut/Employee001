// The 10 MB rotation test lives in its own file, so in its own vitest worker:
// on macOS it crashed a forks worker it shared with other audit tests.
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

afterEach(() => {
  vi.useRealTimers();
  process.chdir(originalCwd);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  vi.resetModules();
});

describe("audit rotation", () => {
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
