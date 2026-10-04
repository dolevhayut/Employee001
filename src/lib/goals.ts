// Durable, company-wide goals. Goals form a small forest: a goal may have one
// parent, while a missing parent means it is a company-level goal.

import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataDir } from "@/lib/app-home";
import { withSidecarLock } from "@/lib/sidecar-lock";

export const GoalStatusSchema = z.enum(["active", "done", "dropped"]);

export const GoalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  ownerEmployeeId: z.string().min(1).nullable(),
  parentId: z.string().min(1).nullable(),
  status: GoalStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type Goal = z.infer<typeof GoalSchema>;
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export type CreateGoalInput = {
  title: string;
  description?: string;
  ownerEmployeeId?: string | null;
  parentId?: string | null;
  status?: GoalStatus;
};

export type UpdateGoalInput = Omit<Partial<Pick<Goal, "title" | "ownerEmployeeId" | "parentId" | "status">>, "description"> & {
  /** null removes the optional description. */
  description?: string | null;
};

function goalsFile(): string {
  return dataDir("goals.json");
}

function readAll(): Goal[] {
  const file = goalsFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  if (!Array.isArray(parsed)) {
    throw new Error("invalid_goals_file");
  }

  const goals: Goal[] = [];
  let skipped = 0;
  for (const entry of parsed) {
    const result = GoalSchema.safeParse(entry);
    if (result.success) goals.push(result.data);
    else skipped += 1;
  }
  if (skipped > 0) {
    console.warn(`Skipped ${skipped} invalid goal entr${skipped === 1 ? "y" : "ies"} in ${file}`);
  }
  return goals;
}

function writeAll(goals: Goal[]): void {
  const file = goalsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(goals, null, 2) + "\n", "utf8");
  fs.renameSync(temp, file);
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

function cleanOptionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = cleanText(value);
  return cleaned || undefined;
}

function parentIsValid(goals: Goal[], id: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  if (parentId === id) return false;

  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (cursor === id || visited.has(cursor)) return false;
    visited.add(cursor);
    const goal = byId.get(cursor);
    if (!goal) return false;
    cursor = goal.parentId;
  }
  return true;
}

function assertParentIsValid(goals: Goal[], id: string, parentId: string | null): void {
  if (!parentIsValid(goals, id, parentId)) {
    throw new Error("invalid_goal_parent");
  }
}

export function listGoals(): Goal[] {
  return readAll();
}

export function getGoal(id: string): Goal | undefined {
  return readAll().find((goal) => goal.id === id);
}

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  return withSidecarLock("goals", async () => {
    const goals = readAll();
    const title = cleanText(input.title);
    if (!title) throw new Error("invalid_goal_title");

    const id = `goal_${randomUUID()}`;
    const parentId = input.parentId ?? null;
    assertParentIsValid(goals, id, parentId);

    const now = new Date().toISOString();
    const goal = GoalSchema.parse({
      id,
      title,
      description: cleanOptionalText(input.description),
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      parentId,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    });
    goals.push(goal);
    writeAll(goals);
    return goal;
  });
}

export async function updateGoal(id: string, patch: UpdateGoalInput): Promise<Goal | undefined> {
  return withSidecarLock("goals", async () => {
    const goals = readAll();
    const index = goals.findIndex((goal) => goal.id === id);
    if (index === -1) return undefined;

    const existing = goals[index];
    const title = patch.title === undefined ? existing.title : cleanText(patch.title);
    if (!title) throw new Error("invalid_goal_title");

    const parentId = patch.parentId === undefined ? existing.parentId : patch.parentId;
    assertParentIsValid(goals, id, parentId);
    const next: Goal = GoalSchema.parse({
      ...existing,
      ...patch,
      title,
      description: Object.hasOwn(patch, "description")
        ? cleanOptionalText(patch.description ?? undefined)
        : existing.description,
      parentId,
      updatedAt: new Date().toISOString(),
    });
    goals[index] = next;
    writeAll(goals);
    return next;
  });
}

/** Delete a goal while preserving its direct children as company-level goals. */
export async function deleteGoal(id: string): Promise<boolean> {
  return withSidecarLock("goals", async () => {
    const goals = readAll();
    if (!goals.some((goal) => goal.id === id)) return false;

    const now = new Date().toISOString();
    const next = goals
      .filter((goal) => goal.id !== id)
      .map((goal) => goal.parentId === id
        ? GoalSchema.parse({ ...goal, parentId: null, updatedAt: now })
        : goal);
    writeAll(next);
    return true;
  });
}

/** The requested goal followed by its ancestors, stopping safely at a root. */
export function goalChain(goalId: string): Goal[] {
  const byId = new Map(readAll().map((goal) => [goal.id, goal]));
  const chain: Goal[] = [];
  const visited = new Set<string>();
  let current = byId.get(goalId);
  while (current && !visited.has(current.id)) {
    chain.push(current);
    visited.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return chain;
}
