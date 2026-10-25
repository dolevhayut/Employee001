import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let previousCwd: string;
let tempDir: string;
let requests: typeof import("./connection-requests");
let feed: typeof import("./feed-store");

beforeEach(async () => {
  previousCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e001-connection-requests-"));
  process.chdir(tempDir);
  vi.resetModules();
  requests = await import("./connection-requests");
  feed = await import("./feed-store");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T09:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  process.chdir(previousCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const input = {
  twinId: "maya",
  twinName: "Maya Chen",
  service: "GitHub",
  reason: "I need read access to investigate the reported issue.",
  scope: "Read GitHub issues",
};

describe("connection requests", () => {
  it("deduplicates an open twin and service request, recording the latest ask", () => {
    const first = requests.requestConnection(input);
    vi.advanceTimersByTime(1_000);
    const repeated = requests.requestConnection({ ...input, reason: "I need the issue history for this answer." });

    expect(first).toMatchObject({ ok: true, deduped: false });
    expect(repeated).toMatchObject({ ok: true, deduped: true });
    const listed = feed.listFeed({ type: "connection_request", status: "open" });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      type: "connection_request",
      source: {
        kind: "connection_request",
        employeeId: "maya",
        employeeName: "Maya Chen",
        service: "GitHub",
        count: 2,
        reason: "I need the issue history for this answer.",
        lastAskedAt: "2026-10-25T09:00:01.000Z",
      },
    });
  });

  it("allows at most five distinct open requests per twin", () => {
    for (let i = 0; i < 5; i++) {
      expect(requests.requestConnection({ ...input, service: `Service ${i}` })).toMatchObject({ ok: true });
    }
    expect(requests.requestConnection({ ...input, service: "Sixth service" })).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("refuses retired twins and does not create a feed item", () => {
    expect(requests.requestConnection({ ...input, lifecycle: "retired" })).toEqual({ ok: false, reason: "retired" });
    expect(feed.listFeed()).toEqual([]);
  });
});
