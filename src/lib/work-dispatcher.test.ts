import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendFeedItem: vi.fn(),
  drainOrphanedApprovals: vi.fn(),
}));

vi.mock("@/lib/approval-store", () => ({
  drainOrphanedApprovals: mocks.drainOrphanedApprovals,
}));

vi.mock("@/lib/feed-store", () => ({
  appendFeedItem: mocks.appendFeedItem,
  feedSourceForApproval: (approval: {
    employeeId: string;
    runId: string;
    context?: { type: "routine"; routineId: string; routineName: string };
  }) => approval.context
    ? {
        kind: "routine",
        employeeId: approval.employeeId,
        runId: approval.runId,
        routineId: approval.context.routineId,
        routineName: approval.context.routineName,
      }
    : { kind: "shift", employeeId: approval.employeeId, runId: approval.runId },
}));

beforeEach(() => {
  mocks.appendFeedItem.mockReset();
  mocks.drainOrphanedApprovals.mockReset();
  delete (globalThis as typeof globalThis & { __workDispatcher?: unknown }).__workDispatcher;
  vi.resetModules();
});

describe("recoverOrphanedApprovals", () => {
  it("keeps routine context actionable with a routine source", async () => {
    mocks.drainOrphanedApprovals.mockReturnValue([{
      approvalId: "apr_1",
      runId: "run_1",
      employeeId: "employee_1",
      employeeName: "Ada",
      toolName: "send_email",
      input: {},
      reason: "The customer needs a reply.",
      createdAt: Date.now(),
      surface: "background",
      context: { type: "routine", routineId: "routine_1", routineName: "Inbox sweep" },
    }]);
    const { recoverOrphanedApprovals } = await import("./work-dispatcher");

    recoverOrphanedApprovals();

    expect(mocks.appendFeedItem).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        kind: "routine",
        employeeId: "employee_1",
        runId: "run_1",
        routineId: "routine_1",
        routineName: "Inbox sweep",
      },
      type: "needs-review",
    }));
  });
});
