import { stat } from "fs/promises";
import path from "path";
import { listPendingApprovals } from "@/lib/approval-bus";
import { dataDir } from "@/lib/app-home";
import { loadEmployeesFromDisk } from "@/lib/employees-disk";
import { computeNextRun, listRoutines } from "@/lib/routines";
import { getTwinBudget } from "@/lib/twin-budget";
import { listWorkItems } from "@/lib/work-items";

export type OpsHealthStatus = "ok" | "attention";
export type CheckStatus = "ok" | "warn";

export type CheckItem = { label: string; href?: string };
export type Check = {
  id: "stuck_approvals" | "missed_routines" | "over_budget" | "failed_work" | "stale_knowledge";
  status: CheckStatus;
  count: number;
  items: CheckItem[];
};

export type OpsHealth = {
  generatedAt: string;
  status: OpsHealthStatus;
  checks: Check[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_LIMIT = 5;
// The scheduler ticks every minute and a run can take a while to start;
// only call a routine missed once it is clearly overdue.
const MISSED_GRACE_MS = 15 * 60 * 1000;
const PROFILE_FILES = [
  "EXPERTISE.md", "DECISIONS.md", "CONTEXT.md", "PEOPLE.md", "PROJECTS.md",
  "PREFERENCES.md", "TONE.md", "BOUNDARIES.md", "EMPLOYMENT.md",
] as const;

function warning(id: Check["id"], count: number, items: CheckItem[]): Check {
  return { id, status: count > 0 ? "warn" : "ok", count, items: items.slice(0, ITEM_LIMIT) };
}

async function safelyCheck(id: Check["id"], check: () => Promise<Check>): Promise<Check> {
  try {
    return await check();
  } catch {
    return { id, status: "warn", count: 1, items: [{ label: "Could not check" }] };
  }
}

function routineIsMissed(
  routine: ReturnType<typeof listRoutines>[number],
  now: number,
): boolean {
  const lastRun = routine.lastRunAt ? new Date(routine.lastRunAt) : undefined;
  const nextDue = lastRun && !Number.isNaN(lastRun.getTime())
    ? computeNextRun(routine.schedule, lastRun).getTime()
    : new Date(routine.nextRunAt ?? routine.createdAt).getTime();
  return !Number.isNaN(nextDue) && nextDue + MISSED_GRACE_MS < now;
}

async function hasStaleKnowledge(employeeId: string, cutoff: number): Promise<boolean> {
  const employeeDir = dataDir("employees", employeeId);
  const mtimes = await Promise.all(PROFILE_FILES.map(async (filename) => {
    try {
      return (await stat(path.join(employeeDir, filename))).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }));
  return mtimes.every((mtime) => mtime !== undefined && mtime < cutoff);
}

export async function getOpsHealth(now = Date.now()): Promise<OpsHealth> {
  const checks = await Promise.all([
    safelyCheck("stuck_approvals", async () => {
      const stuck = listPendingApprovals().filter((approval) => now - approval.createdAt > DAY_MS);
      return warning("stuck_approvals", stuck.length, stuck.map((approval) => ({
        label: `${approval.employeeName ?? approval.employeeId}: ${approval.bareName ?? approval.toolName}`,
        href: "/inbox",
      })));
    }),
    safelyCheck("missed_routines", async () => {
      const missed = listRoutines().filter((routine) => routine.enabled && routineIsMissed(routine, now));
      return warning("missed_routines", missed.length, missed.map((routine) => ({ label: routine.name, href: "/routines" })));
    }),
    safelyCheck("over_budget", async () => {
      const employees = await loadEmployeesFromDisk();
      const overBudget = employees.filter((employee) => {
        const budget = getTwinBudget(employee.id);
        // A budget of 0 means the twin is paused on purpose, not over budget.
        return budget.spentTodayUsd > 0 && budget.spentTodayUsd >= budget.dailyBudgetUsd;
      });
      return warning("over_budget", overBudget.length, overBudget.map((employee) => ({ label: employee.name, href: "/budgets" })));
    }),
    safelyCheck("failed_work", async () => {
      const cutoff = now - 7 * DAY_MS;
      const failed = listWorkItems({ status: "failed" }).filter((item) => new Date(item.updatedAt).getTime() >= cutoff);
      return warning("failed_work", failed.length, failed.map((item) => ({ label: item.title, href: "/tasks" })));
    }),
    safelyCheck("stale_knowledge", async () => {
      const cutoff = now - 60 * DAY_MS;
      const employees = await loadEmployeesFromDisk();
      const stale = [] as CheckItem[];
      for (const employee of employees) {
        if (employee.twinStatus !== "ready") continue;
        if (await hasStaleKnowledge(employee.id, cutoff)) {
          stale.push({ label: employee.name, href: `/profile?employee=${encodeURIComponent(employee.id)}` });
        }
      }
      return warning("stale_knowledge", stale.length, stale);
    }),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    status: checks.some((check) => check.status === "warn") ? "attention" : "ok",
    checks,
  };
}
