import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { buildTelemetryPayload, sendIfDue, shouldSend } from "./telemetry";

describe("telemetry", () => {
  it("builds an aggregate-only payload without PII fields", () => {
    const payload = buildTelemetryPayload({
      installId: "0f9b75db-5d04-41d7-af1b-14bfda52a211",
      version: "0.5.1",
      nodeMajor: 22,
      os: "darwin",
      activeTwins: 3,
      meetings7d: 2,
      approvals7d: 1,
    });
    expect(payload).toMatchObject({ active_twins: 3, meetings_7d: 2, approvals_7d: 1 });
    expect(Object.keys(payload).sort()).toEqual(["active_twins", "approvals_7d", "install_id", "meetings_7d", "node_major", "os", "version"].sort());
  });

  it("never sends without an explicit destination URL", () => {
    expect(shouldSend({ consent: true, installId: "id" }, "", Date.now())).toBe(false);
  });

  it("does not call fetch when no destination URL is configured", async () => {
    const originalCwd = process.cwd();
    const dir = fs.mkdtempSync(path.join(tmpdir(), "employee001-telemetry-"));
    const fetchMock = vi.fn();
    process.chdir(dir);
    fs.mkdirSync("data");
    fs.writeFileSync("data/settings.json", JSON.stringify({ telemetry: { consent: true, installId: "id" } }));
    vi.stubEnv("EMPLOYEE001_TELEMETRY_URL", "");
    vi.stubGlobal("fetch", fetchMock);
    try {
      await sendIfDue();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires consent and a full 24-hour interval", () => {
    const now = Date.parse("2026-10-05T12:00:00.000Z");
    expect(shouldSend({ consent: false, installId: "id" }, "https://example.test", now)).toBe(false);
    expect(shouldSend({ consent: true, installId: "id", lastSentAt: "2026-10-04T13:00:00.000Z" }, "https://example.test", now)).toBe(false);
    expect(shouldSend({ consent: true, installId: "id", lastSentAt: "2026-10-04T12:00:00.000Z" }, "https://example.test", now)).toBe(true);
  });
});
