import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchWorkTick: vi.fn(),
  getHiredEmployees: vi.fn(() => []),
  isAutonomyArmed: vi.fn(),
  isUnderBudget: vi.fn(() => true),
  listRoutines: vi.fn(),
  loadEmployeesFromDisk: vi.fn(async () => []),
  pollEmailInboxes: vi.fn(async () => undefined),
  recoverOrphanedApprovals: vi.fn(),
  updateRoutine: vi.fn(),
}));

vi.mock("@/lib/routines", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routines")>();
  return { ...actual, listRoutines: mocks.listRoutines, updateRoutine: mocks.updateRoutine };
});
vi.mock("@/lib/twin-budget", () => ({ isUnderBudget: mocks.isUnderBudget }));
vi.mock("@/lib/council-runner", () => ({ runSingleTwin: vi.fn() }));
vi.mock("@/lib/employees-disk", () => ({ loadEmployeesFromDisk: mocks.loadEmployeesFromDisk }));
vi.mock("@/lib/hired-agents", () => ({ getHiredEmployees: mocks.getHiredEmployees }));
vi.mock("@/lib/shift-runner", () => ({ runShift: vi.fn() }));
vi.mock("@/lib/feed-store", () => ({ appendFeedItem: vi.fn() }));
vi.mock("@/lib/active-runs", () => ({ registerRun: vi.fn(), updateRun: vi.fn(), unregisterRun: vi.fn() }));
vi.mock("@/lib/run-logs", () => ({ appendRunLog: vi.fn(), logPathFor: vi.fn() }));
vi.mock("@/lib/workspace-mode", () => ({ isAutonomyArmed: mocks.isAutonomyArmed }));
vi.mock("@/lib/work-dispatcher", () => ({
  dispatchWorkTick: mocks.dispatchWorkTick,
  recoverOrphanedApprovals: mocks.recoverOrphanedApprovals,
}));
vi.mock("@/lib/email-poller", () => ({ pollEmailInboxes: mocks.pollEmailInboxes }));

const originalCwd = process.cwd();
let tempDir: string;

function clearSchedulerRuntime(): void {
  const globalState = globalThis as typeof globalThis & {
    __routineScheduler?: { interval: ReturnType<typeof setInterval> };
  };
  if (globalState.__routineScheduler?.interval) clearInterval(globalState.__routineScheduler.interval);
  delete globalState.__routineScheduler;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e118-scheduler-"));
  process.chdir(tempDir);
  clearSchedulerRuntime();
  vi.resetModules();
  vi.clearAllMocks();
  mocks.dispatchWorkTick.mockResolvedValue(undefined);
  mocks.getHiredEmployees.mockReturnValue([]);
  mocks.isUnderBudget.mockReturnValue(true);
  mocks.loadEmployeesFromDisk.mockResolvedValue([]);
  mocks.pollEmailInboxes.mockResolvedValue(undefined);
  vi.useFakeTimers({ now: new Date("2026-10-05T12:00:00.000Z"), toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  clearSchedulerRuntime();
  vi.useRealTimers();
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("routine scheduler", () => {
  it("catches up one missed interval run and advances its cursor from the frozen clock", async () => {
    mocks.isAutonomyArmed.mockReturnValue(true);
    const missedRoutine = {
      id: "routine_1",
      employeeId: "missing_employee",
      name: "Inbox sweep",
      task: "Review inbox.",
      kind: "task",
      schedule: { type: "interval", minutes: 15 },
      enabled: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      nextRunAt: "2026-10-05T11:30:00.000Z",
    };
    // The regular tick sees no work; the boot-time pass then sees the run
    // that was missed while the scheduler was down.
    mocks.listRoutines.mockReturnValueOnce([]).mockReturnValueOnce([missedRoutine]);
    const { ensureSchedulerStarted } = await import("./routine-scheduler");

    ensureSchedulerStarted();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mocks.updateRoutine).toHaveBeenCalledWith("routine_1", {
      nextRunAt: "2026-10-05T12:15:02.000Z",
    });
  });

  it("does not schedule, catch up, poll, or dispatch while Autonomy is off", async () => {
    mocks.isAutonomyArmed.mockReturnValue(false);
    mocks.listRoutines.mockReturnValue([{
      id: "routine_1",
      employeeId: "ada",
      name: "Inbox sweep",
      task: "Review inbox.",
      schedule: { type: "interval", minutes: 15 },
      enabled: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      nextRunAt: "2026-10-05T11:00:00.000Z",
    }]);
    const { ensureSchedulerStarted } = await import("./routine-scheduler");

    ensureSchedulerStarted();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mocks.listRoutines).not.toHaveBeenCalled();
    expect(mocks.updateRoutine).not.toHaveBeenCalled();
    expect(mocks.pollEmailInboxes).not.toHaveBeenCalled();
    expect(mocks.dispatchWorkTick).not.toHaveBeenCalled();
  });
});
