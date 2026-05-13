import fs from "fs";
import path from "path";

export type TwinBudget = {
  dailyBudgetUsd: number;
  spentTodayUsd: number;
  /** "YYYY-MM-DD" in Asia/Jerusalem — when spentTodayUsd was last reset. */
  resetAt: string;
};

const DEFAULT_BUDGET_USD = 3; // sonnet-4-6 default

function todayIL(): string {
  // en-CA locale yields "YYYY-MM-DD" which is easy to compare as a string.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function budgetPath(employeeId: string): string {
  return path.join(
    process.cwd(),
    "data",
    "employees",
    employeeId,
    ".shift",
    "budget.json"
  );
}

function writeBudget(employeeId: string, b: TwinBudget): void {
  const file = budgetPath(employeeId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(b, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function getTwinBudget(employeeId: string): TwinBudget {
  const today = todayIL();
  try {
    const raw = fs.readFileSync(budgetPath(employeeId), "utf8");
    const b = JSON.parse(raw) as TwinBudget;
    if (b.resetAt === today) return b;
    // New day — reset spend, keep the limit the CEO set.
    const reset: TwinBudget = { ...b, spentTodayUsd: 0, resetAt: today };
    writeBudget(employeeId, reset);
    return reset;
  } catch {
    const def: TwinBudget = {
      dailyBudgetUsd: DEFAULT_BUDGET_USD,
      spentTodayUsd: 0,
      resetAt: today,
    };
    writeBudget(employeeId, def);
    return def;
  }
}

export function setDailyBudget(employeeId: string, usd: number): TwinBudget {
  const current = getTwinBudget(employeeId);
  const updated: TwinBudget = { ...current, dailyBudgetUsd: Math.max(0, usd) };
  writeBudget(employeeId, updated);
  return updated;
}

export function recordSpend(employeeId: string, usd: number): TwinBudget {
  if (usd <= 0) return getTwinBudget(employeeId);
  const current = getTwinBudget(employeeId);
  const updated: TwinBudget = {
    ...current,
    spentTodayUsd: Math.round((current.spentTodayUsd + usd) * 1e6) / 1e6,
  };
  writeBudget(employeeId, updated);
  return updated;
}

/**
 * Returns true when the twin has enough remaining budget for a new shift.
 * estimateUsd defaults to 0 (just check "anything left at all").
 */
export function isUnderBudget(
  employeeId: string,
  estimateUsd = 0
): boolean {
  const b = getTwinBudget(employeeId);
  return b.spentTodayUsd + estimateUsd <= b.dailyBudgetUsd;
}
