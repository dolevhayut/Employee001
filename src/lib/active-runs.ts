import fs from "fs";
import path from "path";

export type RunSurface = "shift" | "routine" | "task" | "council" | "builder";
export type RunStatus = "running" | "complete" | "error" | "aborted";

export type ActiveRun = {
  runId: string;
  surface: RunSurface;
  employeeId: string;
  employeeName: string;
  label: string;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  toolCalls: number;
  costUsd: number;
  currentTool?: string;
  lastText?: string;
  /** Most recent extended-thinking block (if the model is reasoning out loud).
   *  Surfaces in the cockpit as a dimmed italic stream — gives the CEO a peek
   *  into the twin's reasoning before the final answer materialises. */
  lastThinking?: string;
  /** Number of subagents the main thread has spawned (Task tool). Cockpit
   *  shows "× 2" badges for parallel research bursts. */
  subagentCount?: number;
  logPath: string;
};

const FILE = path.join(process.cwd(), "data", "active-runs.json");
const LINGER_MS = 60_000;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(): Record<string, ActiveRun> {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw) as Record<string, ActiveRun>;
  } catch (err) {
    console.warn("[active-runs] read failed", err);
    return {};
  }
}

function writeAll(map: Record<string, ActiveRun>): void {
  try {
    ensureDir();
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), "utf8");
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.warn("[active-runs] write failed", err);
  }
}

function pruneExpired(map: Record<string, ActiveRun>): Record<string, ActiveRun> {
  const now = Date.now();
  let mutated = false;
  const next: Record<string, ActiveRun> = {};
  for (const [id, run] of Object.entries(map)) {
    if (run.endedAt) {
      const endedMs = new Date(run.endedAt).getTime();
      if (Number.isFinite(endedMs) && endedMs + LINGER_MS < now) {
        mutated = true;
        continue;
      }
    }
    next[id] = run;
  }
  if (mutated) writeAll(next);
  return next;
}

export function registerRun(
  run: Omit<ActiveRun, "status" | "toolCalls" | "costUsd">
): ActiveRun {
  const map = readAll();
  const entry: ActiveRun = {
    ...run,
    status: "running",
    toolCalls: 0,
    costUsd: 0,
  };
  map[entry.runId] = entry;
  writeAll(map);
  return entry;
}

export function updateRun(runId: string, patch: Partial<ActiveRun>): ActiveRun | null {
  const map = readAll();
  const existing = map[runId];
  if (!existing) return null;
  const merged: ActiveRun = { ...existing, ...patch };
  map[runId] = merged;
  writeAll(map);
  return merged;
}

export function unregisterRun(
  runId: string,
  terminal: { status: "complete" | "error" | "aborted"; costUsd?: number }
): void {
  const map = readAll();
  const existing = map[runId];
  if (!existing) return;
  map[runId] = {
    ...existing,
    status: terminal.status,
    endedAt: new Date().toISOString(),
    costUsd: typeof terminal.costUsd === "number" ? terminal.costUsd : existing.costUsd,
  };
  writeAll(map);
}

export function listActiveRuns(filter?: {
  employeeId?: string;
  surface?: RunSurface;
  includeRecent?: boolean;
}): ActiveRun[] {
  const map = pruneExpired(readAll());
  let items = Object.values(map);

  if (!filter?.includeRecent) {
    items = items.filter((r) => r.status === "running");
  }
  if (filter?.employeeId) {
    items = items.filter((r) => r.employeeId === filter.employeeId);
  }
  if (filter?.surface) {
    items = items.filter((r) => r.surface === filter.surface);
  }

  items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return items;
}

export function getActiveRun(runId: string): ActiveRun | null {
  const map = pruneExpired(readAll());
  return map[runId] ?? null;
}
