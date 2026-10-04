import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getTwinBudget, isUnderBudget, recordSpend, setDailyBudget } from "./twin-budget";

let previousCwd: string;
let tempDir: string;

function budgetFile(employeeId: string): string {
  return path.join(tempDir, "data", "employees", employeeId, ".shift", "budget.json");
}

beforeEach(() => {
  previousCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e103-budget-"));
  process.chdir(tempDir);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  process.chdir(previousCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("twin budgets", () => {
  it("guarantees a missing budget file receives the default daily allowance", () => {
    expect(fs.existsSync(budgetFile("ada"))).toBe(false);
    expect(getTwinBudget("ada")).toEqual({
      dailyBudgetUsd: 3,
      spentTodayUsd: 0,
      resetAt: "2026-01-01",
    });
    expect(JSON.parse(fs.readFileSync(budgetFile("ada"), "utf8"))).toEqual(getTwinBudget("ada"));
  });

  it("guarantees estimates at or under the remaining allowance are permitted", () => {
    setDailyBudget("ada", 1);
    recordSpend("ada", 0.6);

    expect(isUnderBudget("ada", 0)).toBe(true);
    expect(isUnderBudget("ada", 0.4)).toBe(true);
    expect(isUnderBudget("ada", 0.400001)).toBe(false);
  });

  it("guarantees an over-budget shift is rejected even when a budget file already exists", () => {
    fs.mkdirSync(path.dirname(budgetFile("ada")), { recursive: true });
    fs.writeFileSync(
      budgetFile("ada"),
      JSON.stringify({ dailyBudgetUsd: 2, spentTodayUsd: 2.01, resetAt: "2026-01-01" }),
    );

    expect(isUnderBudget("ada")).toBe(false);
  });

  it("guarantees Israel-time midnight resets spending while retaining the configured limit", () => {
    vi.setSystemTime(new Date("2026-01-01T21:59:00.000Z")); // 23:59 in Asia/Jerusalem
    setDailyBudget("ada", 7.5);
    recordSpend("ada", 4.25);
    expect(getTwinBudget("ada")).toMatchObject({ resetAt: "2026-01-01", spentTodayUsd: 4.25 });

    vi.setSystemTime(new Date("2026-01-01T22:01:00.000Z")); // 00:01 in Asia/Jerusalem
    expect(getTwinBudget("ada")).toEqual({
      dailyBudgetUsd: 7.5,
      spentTodayUsd: 0,
      resetAt: "2026-01-02",
    });
    expect(isUnderBudget("ada", 7.5)).toBe(true);
  });
});
