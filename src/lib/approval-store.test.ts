import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
let tempDir: string;

function clearApprovalRuntime(): void {
  const globalState = globalThis as typeof globalThis & {
    __approvalSweep?: ReturnType<typeof setInterval>;
    __workDispatcher?: unknown;
  };
  if (globalState.__approvalSweep) clearInterval(globalState.__approvalSweep);
  delete globalState.__approvalSweep;
  delete globalState.__workDispatcher;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e118-approval-"));
  process.chdir(tempDir);
  clearApprovalRuntime();
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-10-05T09:00:00.000Z"), toFake: ["Date"] });
});

afterEach(() => {
  clearApprovalRuntime();
  vi.useRealTimers();
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("durable approvals", () => {
  it("expires a chat approval at its TTL and removes its durable record", async () => {
    const { registerApproval, sweepPendingApprovals } = await import("./approval-bus");
    const approval = registerApproval({
      runId: "run_chat",
      employeeId: "ada",
      toolName: "send_email",
      input: {},
      reason: "A reply needs review.",
    });

    expect(JSON.parse(fs.readFileSync(path.join(tempDir, "data", "approvals-pending.json"), "utf8"))).toHaveProperty(approval.approvalId);

    sweepPendingApprovals(Date.now() + 10 * 60_000 + 1);

    await expect(approval.promise).resolves.toMatchObject({
      action: "deny",
      message: "Approval timed out — no human response within 10 minutes.",
    });
    expect(JSON.parse(fs.readFileSync(path.join(tempDir, "data", "approvals-pending.json"), "utf8"))).toEqual({});
  });

  it("recovers an approval persisted by a previous process as an actionable feed item", async () => {
    const bus = await import("./approval-bus");
    bus.registerApproval({
      runId: "run_routine",
      employeeId: "ada",
      employeeName: "Ada",
      toolName: "send_email",
      bareName: "send email",
      input: {},
      reason: "The customer needs a reply.",
      surface: "background",
      context: { type: "routine", routineId: "routine_1", routineName: "Inbox sweep" },
    });

    clearApprovalRuntime();
    vi.resetModules();
    const { recoverOrphanedApprovals } = await import("./work-dispatcher");
    const { listFeed } = await import("./feed-store");
    recoverOrphanedApprovals();

    expect(listFeed()).toEqual([
      expect.objectContaining({
        source: {
          kind: "routine",
          employeeId: "ada",
          runId: "run_routine",
          routineId: "routine_1",
          routineName: "Inbox sweep",
        },
        type: "needs-review",
        title: "Approval lost in restart: send email",
      }),
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(tempDir, "data", "approvals-pending.json"), "utf8"))).toEqual({});
  });

  it("posts a needs-review item when a background approval times out", async () => {
    const { registerApproval, sweepPendingApprovals } = await import("./approval-bus");
    const { listFeed } = await import("./feed-store");
    const approval = registerApproval({
      runId: "run_background",
      employeeId: "lin",
      employeeName: "Lin",
      toolName: "send_email",
      bareName: "send email",
      input: {},
      reason: "A reply needs review.",
      surface: "background",
    });

    sweepPendingApprovals(Date.now() + 6 * 60 * 60_000 + 1);

    await expect(approval.promise).resolves.toMatchObject({ action: "deny" });
    expect(listFeed()).toEqual([
      expect.objectContaining({
        source: { kind: "shift", employeeId: "lin", runId: "run_background" },
        type: "needs-review",
        title: "Skipped: send email wasn't approved in time",
        detail: expect.stringContaining("Lin skipped this action after waiting 6h"),
      }),
    ]);
  });
});
