import fs from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TwinTaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type TwinTask = {
  id: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  title: string;
  description?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  status: TwinTaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  createdInRunId?: string;
  completedInRunId?: string;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const EMPLOYEES_DIR = path.join(process.cwd(), "data", "employees");

function tasksDirFor(employeeId: string): string {
  return path.join(EMPLOYEES_DIR, employeeId, ".shift", "tasks");
}

function ensureTasksDir(employeeId: string): string {
  const dir = tasksDirFor(employeeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readTaskFile(filePath: string): TwinTask | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as TwinTask;
  } catch (err) {
    console.warn("[twin-tasks] failed to read", filePath, err);
    return null;
  }
}

function writeTaskFile(task: TwinTask): void {
  try {
    const dir = ensureTasksDir(task.toEmployeeId);
    const filePath = path.join(dir, `${task.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), "utf8");
  } catch (err) {
    console.warn("[twin-tasks] failed to write", task.id, err);
  }
}

// ─── IDs ──────────────────────────────────────────────────────────────────────

let _counter = 0;
function makeId(): string {
  _counter++;
  return `tt_${Date.now().toString(36)}_${_counter}`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createTask(input: {
  fromEmployeeId: string;
  toEmployeeId: string;
  title: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  createdInRunId?: string;
}): TwinTask {
  const now = new Date().toISOString();
  const task: TwinTask = {
    id: makeId(),
    fromEmployeeId: input.fromEmployeeId,
    toEmployeeId: input.toEmployeeId,
    title: input.title,
    description: input.description,
    priority: input.priority ?? 3,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    createdInRunId: input.createdInRunId,
  };
  writeTaskFile(task);
  return task;
}

export function getTask(taskId: string): TwinTask | null {
  try {
    if (!fs.existsSync(EMPLOYEES_DIR)) return null;
    const employees = fs.readdirSync(EMPLOYEES_DIR);
    for (const empId of employees) {
      const filePath = path.join(tasksDirFor(empId), `${taskId}.json`);
      if (fs.existsSync(filePath)) {
        return readTaskFile(filePath);
      }
    }
    return null;
  } catch (err) {
    console.warn("[twin-tasks] getTask failed", taskId, err);
    return null;
  }
}

function sortTasks(tasks: TwinTask[]): TwinTask[] {
  return tasks.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function getTasksFor(
  toEmployeeId: string,
  status?: TwinTaskStatus
): TwinTask[] {
  try {
    const dir = tasksDirFor(toEmployeeId);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const tasks: TwinTask[] = [];
    for (const f of files) {
      const t = readTaskFile(path.join(dir, f));
      if (!t) continue;
      if (status && t.status !== status) continue;
      tasks.push(t);
    }
    return sortTasks(tasks);
  } catch (err) {
    console.warn("[twin-tasks] getTasksFor failed", toEmployeeId, err);
    return [];
  }
}

export function listAllPendingTasks(): TwinTask[] {
  try {
    if (!fs.existsSync(EMPLOYEES_DIR)) return [];
    const employees = fs.readdirSync(EMPLOYEES_DIR);
    const all: TwinTask[] = [];
    for (const empId of employees) {
      const dir = tasksDirFor(empId);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const t = readTaskFile(path.join(dir, f));
        if (t && t.status === "pending") all.push(t);
      }
    }
    return sortTasks(all);
  } catch (err) {
    console.warn("[twin-tasks] listAllPendingTasks failed", err);
    return [];
  }
}

export function updateTaskStatus(
  taskId: string,
  status: TwinTaskStatus
): TwinTask | null {
  const task = getTask(taskId);
  if (!task) return null;
  const now = new Date().toISOString();
  task.status = status;
  task.updatedAt = now;
  if (status === "in_progress" && !task.startedAt) {
    task.startedAt = now;
  }
  writeTaskFile(task);
  return task;
}

export function completeTask(
  taskId: string,
  result: string,
  completedInRunId?: string
): TwinTask | null {
  const task = getTask(taskId);
  if (!task) return null;
  const now = new Date().toISOString();
  task.status = "completed";
  task.result = result;
  task.completedAt = now;
  task.updatedAt = now;
  if (completedInRunId) task.completedInRunId = completedInRunId;
  writeTaskFile(task);
  return task;
}
