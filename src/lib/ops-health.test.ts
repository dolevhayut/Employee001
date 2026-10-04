import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  computeNextRun: vi.fn(),
  dataDir: vi.fn(() => "/health-data"),
  getTwinBudget: vi.fn(),
  listPendingApprovals: vi.fn(),
  listRoutines: vi.fn(),
  listWorkItems: vi.fn(),
  loadEmployeesFromDisk: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@/lib/approval-bus", () => ({ listPendingApprovals: mocks.listPendingApprovals }));
vi.mock("@/lib/app-home", () => ({ dataDir: mocks.dataDir }));
vi.mock("@/lib/employees-disk", () => ({ loadEmployeesFromDisk: mocks.loadEmployeesFromDisk }));
vi.mock("@/lib/routines", () => ({ computeNextRun: mocks.computeNextRun, listRoutines: mocks.listRoutines }));
vi.mock("@/lib/twin-budget", () => ({ getTwinBudget: mocks.getTwinBudget }));
vi.mock("@/lib/work-items", () => ({ listWorkItems: mocks.listWorkItems }));

import { getOpsHealth } from "./ops-health";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const readyTwin = { id: "ada", name: "Ada Lovelace", twinStatus: "ready" };

function check(result: Awaited<ReturnType<typeof getOpsHealth>>, id: string) {
  const found = result.checks.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPendingApprovals.mockReturnValue([]);
  mocks.listRoutines.mockReturnValue([]);
  mocks.listWorkItems.mockReturnValue([]);
  mocks.loadEmployeesFromDisk.mockResolvedValue([]);
  mocks.getTwinBudget.mockReturnValue({ dailyBudgetUsd: 5, spentTodayUsd: 0, resetAt: "2026-10-05" });
  mocks.computeNextRun.mockImplementation((_schedule: unknown, from: Date) => new Date(from.getTime() + DAY));
  mocks.stat.mockResolvedValue({ mtimeMs: NOW - DAY });
});

describe("getOpsHealth", () => {
  it("reports an all-clear deterministic snapshot", async () => {
    const health = await getOpsHealth(NOW);

    expect(health).toMatchObject({ generatedAt: "2026-10-05T12:00:00.000Z", status: "ok" });
    expect(health.checks).toHaveLength(5);
    expect(health.checks.every((candidate) => candidate.status === "ok" && candidate.count === 0)).toBe(true);
  });

  it("flags every check and links its actionable items", async () => {
    mocks.listPendingApprovals.mockReturnValue([{ createdAt: NOW - DAY - 1, employeeId: "ada", employeeName: "Ada", toolName: "send_email" }]);
    mocks.listRoutines.mockReturnValue([{ id: "routine-1", name: "Daily review", enabled: true, createdAt: new Date(NOW - 3 * DAY).toISOString(), lastRunAt: new Date(NOW - 2 * DAY).toISOString(), schedule: { type: "daily", time: "09:00" } }]);
    mocks.loadEmployeesFromDisk.mockResolvedValue([readyTwin]);
    mocks.getTwinBudget.mockReturnValue({ dailyBudgetUsd: 5, spentTodayUsd: 5, resetAt: "2026-10-05" });
    mocks.listWorkItems.mockReturnValue([{ status: "failed", title: "Import messages", updatedAt: new Date(NOW - DAY).toISOString() }]);
    mocks.stat.mockResolvedValue({ mtimeMs: NOW - 61 * DAY });

    const health = await getOpsHealth(NOW);

    expect(health.status).toBe("attention");
    for (const id of ["stuck_approvals", "missed_routines", "over_budget", "failed_work", "stale_knowledge"]) {
      expect(check(health, id)).toMatchObject({ status: "warn", count: 1 });
      expect(check(health, id).items[0]?.href).toBeTruthy();
    }
  });

  it("turns a throwing source into a warning instead of throwing", async () => {
    mocks.listRoutines.mockImplementation(() => { throw new Error("disk offline"); });

    const health = await getOpsHealth(NOW);

    expect(check(health, "missed_routines")).toEqual({
      id: "missed_routines", status: "warn", count: 1, items: [{ label: "Could not check" }],
    });
  });

  it("caps displayed items at five while retaining the full count", async () => {
    mocks.listPendingApprovals.mockReturnValue(Array.from({ length: 6 }, (_, index) => ({
      createdAt: NOW - DAY - 1,
      employeeId: `employee-${index}`,
      toolName: "send_email",
    })));

    const health = await getOpsHealth(NOW);

    expect(check(health, "stuck_approvals")).toMatchObject({ count: 6 });
    expect(check(health, "stuck_approvals").items).toHaveLength(5);
  });

  it("uses strict 24-hour and 60-day boundaries, and an inclusive seven-day failed-work window", async () => {
    mocks.listPendingApprovals.mockReturnValue([{ createdAt: NOW - DAY, employeeId: "ada", toolName: "send_email" }]);
    mocks.listWorkItems.mockReturnValue([
      { status: "failed", title: "At boundary", updatedAt: new Date(NOW - 7 * DAY).toISOString() },
      { status: "failed", title: "Before boundary", updatedAt: new Date(NOW - 7 * DAY - 1).toISOString() },
    ]);
    mocks.loadEmployeesFromDisk.mockResolvedValue([readyTwin]);
    mocks.stat.mockResolvedValue({ mtimeMs: NOW - 60 * DAY });

    const atBoundary = await getOpsHealth(NOW);
    expect(check(atBoundary, "stuck_approvals").count).toBe(0);
    expect(check(atBoundary, "failed_work").count).toBe(1);
    expect(check(atBoundary, "stale_knowledge").count).toBe(0);

    mocks.stat.mockResolvedValue({ mtimeMs: NOW - 60 * DAY - 1 });
    const older = await getOpsHealth(NOW);
    expect(check(older, "stale_knowledge").count).toBe(1);
  });
});
