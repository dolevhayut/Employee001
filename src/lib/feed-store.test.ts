import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let previousCwd: string;
let tempDir: string;
let feed: typeof import("./feed-store");

beforeEach(async () => {
  previousCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e103-feed-"));
  process.chdir(tempDir);
  vi.resetModules();
  feed = await import("./feed-store");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T09:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  process.chdir(previousCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("feed storage", () => {
  it("guarantees appended items are persisted as open records with generated IDs", () => {
    const item = feed.appendFeedItem({
      source: { kind: "shift", employeeId: "ada", runId: "run_1" },
      type: "alert",
      title: "Review access",
      detail: "A key changed.",
      priority: 1,
    });

    expect(item).toMatchObject({
      id: expect.stringMatching(/^feed_/),
      ts: "2026-01-01T09:00:00.000Z",
      status: "open",
      priority: 1,
    });
    expect(feed.getFeedItem(item.id)).toEqual(item);
  });

  it("guarantees list filters combine type, status, employee, since, and descending limit", () => {
    const ada = feed.appendFeedItem({
      source: { kind: "shift", employeeId: "ada", runId: "run_1" },
      type: "alert",
      title: "Ada alert",
    });
    vi.advanceTimersByTime(1_000);
    const lin = feed.appendFeedItem({
      source: { kind: "twin-task", taskId: "task_1", fromId: "ada", toId: "lin" },
      type: "needs-review",
      title: "Shared task",
    });
    vi.advanceTimersByTime(1_000);
    const offTrack = feed.appendFeedItem({
      source: { kind: "off-track", departmentId: "sales", metric: "pipeline" },
      type: "alert",
      title: "Pipeline alert",
    });
    feed.resolveFeedItem(ada.id, "approved", "Reviewed");

    expect(feed.listFeed({ employeeId: "ada" }).map((item) => item.id)).toEqual([lin.id, ada.id]);
    expect(feed.listFeed({ type: "alert", status: "open" }).map((item) => item.id)).toEqual([offTrack.id]);
    expect(feed.listFeed({ since: lin.ts, limit: 1 }).map((item) => item.id)).toEqual([offTrack.id]);
    expect(feed.listFeed({ type: ["alert", "needs-review"], limit: 0 })).toEqual([]);
  });

  it("guarantees resolve records its status, timestamp, and explicit or default resolution", () => {
    const item = feed.appendFeedItem({
      source: { kind: "task-run", employeeId: "ada", runId: "run_1", task: "reconcile" },
      type: "task-handoff",
      title: "Reconcile invoices",
    });
    vi.advanceTimersByTime(5_000);

    expect(feed.resolveFeedItem(item.id, "approved", "CEO approved")).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-01-01T09:00:05.000Z",
      resolution: "CEO approved",
    });
    expect(feed.resolveFeedItem(item.id, "dismissed")).toMatchObject({
      status: "dismissed",
      resolution: "dismissed",
    });
    expect(feed.resolveFeedItem("feed_missing", "rejected")).toBeNull();
  });
});

describe("feedSourceForApproval", () => {
  it("guarantees routine approvals retain their routine origin", () => {
    expect(feed.feedSourceForApproval({
      employeeId: "ada",
      runId: "run_1",
      context: { type: "routine", routineId: "routine_1", routineName: "Daily inbox" },
    })).toEqual({
      kind: "routine",
      employeeId: "ada",
      runId: "run_1",
      routineId: "routine_1",
      routineName: "Daily inbox",
    });
  });

  it("guarantees ordinary approvals retain their shift origin", () => {
    expect(feed.feedSourceForApproval({ employeeId: "lin", runId: "run_2" })).toEqual({
      kind: "shift",
      employeeId: "lin",
      runId: "run_2",
    });
  });
});
