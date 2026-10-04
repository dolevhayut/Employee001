import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendFeedItem: vi.fn(),
  persistPendingApproval: vi.fn(),
  removePendingApproval: vi.fn(),
}));

vi.mock("@/lib/approval-store", () => ({
  persistPendingApproval: mocks.persistPendingApproval,
  removePendingApproval: mocks.removePendingApproval,
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

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("sweepPendingApprovals", () => {
  it("posts one needs-review item for a background timeout and none for chat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T09:00:00.000Z"));
    const { registerApproval, sweepPendingApprovals } = await import("./approval-bus");

    const background = registerApproval({
      runId: "run_routine",
      employeeId: "employee_1",
      employeeName: "Ada",
      toolName: "mcp__mail__send",
      bareName: "send email",
      input: {},
      reason: "The customer needs a reply.",
      surface: "background",
      context: { type: "routine", routineId: "routine_1", routineName: "Inbox sweep" },
    });
    const chat = registerApproval({
      runId: "run_chat",
      employeeId: "employee_2",
      employeeName: "Lin",
      toolName: "mcp__mail__send",
      input: {},
      reason: "A reply needs approval.",
      surface: "chat",
    });

    sweepPendingApprovals(Date.now() + 6 * 60 * 60 * 1000 + 1);

    await expect(background.promise).resolves.toMatchObject({ action: "deny" });
    await expect(chat.promise).resolves.toMatchObject({ action: "deny" });
    expect(mocks.appendFeedItem).toHaveBeenCalledTimes(1);
    expect(mocks.appendFeedItem).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        kind: "routine",
        employeeId: "employee_1",
        runId: "run_routine",
        routineId: "routine_1",
        routineName: "Inbox sweep",
      },
      type: "needs-review",
      title: "Skipped: send email wasn't approved in time",
      detail: expect.stringContaining("Ada skipped this action after waiting 6h"),
    }));
  });
});
