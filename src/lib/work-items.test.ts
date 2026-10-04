import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
let tempDir: string;
let workItems: typeof import("./work-items");

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e118-work-items-"));
  process.chdir(tempDir);
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-10-05T09:00:00.000Z"), toFake: ["Date"] });
  workItems = await import("./work-items");
});

afterEach(() => {
  vi.useRealTimers();
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

function enqueue() {
  return workItems.enqueueWorkItem({
    type: "task",
    assigneeEmployeeId: "ada",
    title: "Reconcile invoices",
    payload: { task: "Reconcile invoices." },
    idempotencyKey: "invoice-reconcile-1",
  }).item;
}

describe("work item state machine", () => {
  it("moves a leased item through retry and terminal completion", () => {
    const queued = enqueue();
    expect(workItems.listWorkItems()).toEqual([expect.objectContaining({ id: queued.id, status: "queued", attemptCount: 0 })]);

    const firstLease = workItems.leaseNextWorkItem();
    expect(firstLease).toMatchObject({ id: queued.id, status: "leased", attemptCount: 1 });
    workItems.failWorkItem(queued.id, "Mailbox unavailable", "run_1");
    expect(workItems.listWorkItems()).toEqual([expect.objectContaining({ status: "queued", attemptCount: 1, resultSummary: "Mailbox unavailable" })]);

    const secondLease = workItems.leaseNextWorkItem();
    expect(secondLease).toMatchObject({ id: queued.id, status: "leased", attemptCount: 2 });
    workItems.completeWorkItem(queued.id, "Invoices reconciled", "run_2");
    expect(workItems.listWorkItems()).toEqual([expect.objectContaining({
      status: "done",
      attemptCount: 2,
      resultSummary: "Invoices reconciled",
      runId: "run_2",
    })]);
  });

  // Bug: completeWorkItem patches a queued item directly to done, bypassing the lease required by the state model.
  it.fails("rejects completing an item that was never leased", () => {
    const queued = enqueue();
    workItems.completeWorkItem(queued.id, "Should not complete");
    expect(workItems.listWorkItems()).toEqual([expect.objectContaining({ status: "queued" })]);
  });
});
