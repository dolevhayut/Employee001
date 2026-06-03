import fs from "fs";
import path from "path";
import { computeNextCron } from "@/lib/cron";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Schedule =
  | { type: "daily"; time: string }                  // "HH:MM"
  | { type: "weekly"; day: number; time: string }    // day 0–6 (Sun–Sat)
  | { type: "interval"; minutes: number }            // every N minutes (testing)
  | { type: "cron"; expr: string };                  // 5-field cron expression

export type RoutineRunStatus = "ok" | "needs_approval" | "denied" | "error" | "skipped";

export type Routine = {
  id: string;
  employeeId: string;
  name: string;          // short label (e.g. "Daily GitHub digest")
  task: string;          // free-form natural language instruction for the twin
  kind?: "task" | "shift";  // defaults to "task"; "shift" = autonomous shift run
  schedule: Schedule;
  enabled: boolean;
  createdAt: string;     // ISO
  lastRunAt?: string;    // ISO
  lastRunStatus?: RoutineRunStatus;
  lastRunSummary?: string;
  /** runId of the most recent shift run — used to look up the shift archive. */
  lastRunId?: string;
  nextRunAt?: string;    // ISO
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const FILE = path.join(process.cwd(), "data", "routines.json");

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(): Routine[] {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Routine[];
  } catch {
    return [];
  }
}

function writeAll(routines: Routine[]): void {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(routines, null, 2), "utf8");
}

// ─── Schedule math ────────────────────────────────────────────────────────────

function parseHHMM(t: string): [number, number] {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return [h ?? 0, m ?? 0];
}

/**
 * Returns the next firing time for a schedule, after `from` (default: now).
 * For daily/weekly: matches HH:MM in local server time.
 */
export function computeNextRun(schedule: Schedule, from: Date = new Date()): Date {
  const next = new Date(from);

  if (schedule.type === "interval") {
    next.setTime(from.getTime() + schedule.minutes * 60_000);
    return next;
  }

  if (schedule.type === "cron") {
    return computeNextCron(schedule.expr, from);
  }

  const [h, m] = parseHHMM(schedule.time);
  next.setHours(h, m, 0, 0);

  if (schedule.type === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // weekly
  const targetDay = schedule.day; // 0=Sun..6=Sat
  const currentDay = next.getDay();
  let daysUntil = (targetDay - currentDay + 7) % 7;
  if (daysUntil === 0 && next <= from) daysUntil = 7;
  next.setDate(next.getDate() + daysUntil);
  return next;
}

export function describeSchedule(s: Schedule): string {
  if (s.type === "interval") return `every ${s.minutes} min${s.minutes === 1 ? "" : "s"}`;
  if (s.type === "daily") return `daily at ${s.time}`;
  if (s.type === "cron") return `cron: ${s.expr}`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[s.day]} at ${s.time}`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

let _counter = 0;
function makeId(): string {
  _counter++;
  return `rt_${Date.now().toString(36)}_${_counter}`;
}

export function listRoutines(): Routine[] {
  return readAll();
}

export function getRoutine(id: string): Routine | undefined {
  return readAll().find((r) => r.id === id);
}

export function createRoutine(
  input: Omit<Routine, "id" | "createdAt" | "nextRunAt">
): Routine {
  const all = readAll();
  const r: Routine = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    nextRunAt: computeNextRun(input.schedule).toISOString(),
    ...input,
  };
  all.push(r);
  writeAll(all);
  return r;
}

export function updateRoutine(id: string, patch: Partial<Routine>): Routine | undefined {
  const all = readAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch };
  writeAll(all);
  return all[idx];
}

export function deleteRoutine(id: string): boolean {
  const all = readAll();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}
