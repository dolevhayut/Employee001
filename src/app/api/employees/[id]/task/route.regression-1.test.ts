// Regression: self-built twins start with profile and knowledge files, not
// Composio connections. Tasks must remain available without personal tools.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendTaskRun: vi.fn(),
  appendTaskEvent: vi.fn(),
  appendRunLog: vi.fn(),
  hasEmployeeFiles: vi.fn(() => true),
  loadEmployeesFromDisk: vi.fn(async () => [
    {
      id: "self-twin",
      name: "Taylor Doe",
      firstName: "Taylor",
      role: "Founder",
      twinStatus: "ready",
      lifecycle: "active",
    },
  ]),
  registerRun: vi.fn(),
  runSingleTwin: vi.fn(async (
    _employee: unknown,
    _task: string,
    onEvent: (event: Record<string, unknown>) => void
  ) => {
    onEvent({
      type: "employee_done",
      employeeId: "self-twin",
      employeeName: "Taylor",
      confidence: 1,
      turns: 1,
      costUsd: 0,
      stoppedReason: "natural",
      ts: Date.now(),
    });
  }),
  updateRun: vi.fn(),
  updateTaskRun: vi.fn(),
  unregisterRun: vi.fn(),
}));

vi.mock("@/lib/auth/request-user", () => ({ sessionUserFromHeaders: () => undefined }));
vi.mock("@/lib/employees-disk", () => ({ loadEmployeesFromDisk: mocks.loadEmployeesFromDisk }));
vi.mock("@/lib/hired-agents", () => ({ getHiredEmployees: () => [] }));
vi.mock("@/lib/employees-files", () => ({ hasEmployeeFiles: mocks.hasEmployeeFiles }));
vi.mock("@/lib/council-runner", () => ({ runSingleTwin: mocks.runSingleTwin }));
vi.mock("@/lib/task-history", () => ({
  appendTaskRun: mocks.appendTaskRun,
  appendTaskEvent: mocks.appendTaskEvent,
  updateTaskRun: mocks.updateTaskRun,
}));
vi.mock("@/lib/feed-store", () => ({ appendFeedItem: vi.fn() }));
vi.mock("@/lib/active-runs", () => ({
  registerRun: mocks.registerRun,
  updateRun: mocks.updateRun,
  unregisterRun: mocks.unregisterRun,
}));
vi.mock("@/lib/run-logs", () => ({
  appendRunLog: mocks.appendRunLog,
  logPathFor: () => "task.log",
}));
vi.mock("@/lib/model-provider", () => ({ canRunModel: () => ({ ok: true }) }));

describe("POST /api/employees/[id]/task", () => {
  it("runs a ready twin without personal Composio connections", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/employees/self-twin/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "Summarize my notes" }),
      }) as never,
      { params: Promise.resolve({ id: "self-twin" }) }
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.runSingleTwin).toHaveBeenCalledWith(
      expect.objectContaining({ id: "self-twin" }),
      "Summarize my notes",
      expect.any(Function),
      [],
      expect.objectContaining({ maxBudgetUsd: 0.5, surface: "chat" })
    );
  });
});
