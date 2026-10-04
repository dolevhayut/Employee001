import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET as getGoalRoute, PATCH } from "@/app/api/goals/[id]/route";
import { GET as listGoalsRoute, POST } from "@/app/api/goals/route";
import { createGoal, deleteGoal, getGoal, goalChain, listGoals, updateGoal } from "./goals";

const originalHome = process.env.EMPLOYEE001_HOME;
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "employee001-goals-"));
  process.env.EMPLOYEE001_HOME = tempDir;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = originalHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function goalsFile(): string {
  return path.join(tempDir, "data", "goals.json");
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("goals", () => {
  it("creates, lists, gets, updates, and deletes goals", async () => {
    const created = await createGoal({ title: "  Ship roadmap  ", description: "  Q4  ", ownerEmployeeId: "ada" });
    expect(created).toMatchObject({ title: "Ship roadmap", description: "Q4", ownerEmployeeId: "ada", parentId: null, status: "active" });
    expect(listGoals()).toEqual([created]);
    expect(getGoal(created.id)).toEqual(created);

    const updated = await updateGoal(created.id, { title: "Ship product roadmap", description: null, status: "done" });
    expect(updated).toMatchObject({ id: created.id, title: "Ship product roadmap", status: "done" });
    expect(updated?.description).toBeUndefined();

    await expect(deleteGoal(created.id)).resolves.toBe(true);
    expect(listGoals()).toEqual([]);
    await expect(deleteGoal(created.id)).resolves.toBe(false);
  });

  it("returns a goal and all ancestors up to the company goal", async () => {
    const company = await createGoal({ title: "Company goal" });
    const team = await createGoal({ title: "Team goal", parentId: company.id });
    const project = await createGoal({ title: "Project goal", parentId: team.id });

    expect(goalChain(project.id).map((goal) => goal.id)).toEqual([project.id, team.id, company.id]);
  });

  it("rejects unknown parents and cycles", async () => {
    await expect(createGoal({ title: "Orphan", parentId: "goal_missing" })).rejects.toThrow("invalid_goal_parent");

    const parent = await createGoal({ title: "Parent" });
    const child = await createGoal({ title: "Child", parentId: parent.id });
    await expect(updateGoal(parent.id, { parentId: child.id })).rejects.toThrow("invalid_goal_parent");
    expect(getGoal(parent.id)?.parentId).toBeNull();
  });

  it("re-parents direct children to the company goal when deleting a parent", async () => {
    const parent = await createGoal({ title: "Parent" });
    const child = await createGoal({ title: "Child", parentId: parent.id });

    await deleteGoal(parent.id);
    expect(getGoal(child.id)).toMatchObject({ id: child.id, parentId: null });
  });

  it("keeps valid entries and warns when the goals file contains invalid entries", () => {
    fs.mkdirSync(path.dirname(goalsFile()), { recursive: true });
    const valid = {
      id: "goal_valid",
      title: "Valid",
      ownerEmployeeId: null,
      parentId: null,
      status: "active",
      createdAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
    };
    fs.writeFileSync(goalsFile(), JSON.stringify([valid, { id: "broken" }]), "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(listGoals()).toEqual([valid]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipped 1 invalid goal entry"));
  });

  it("does not overwrite a corrupt goals file after a failed create", async () => {
    fs.mkdirSync(path.dirname(goalsFile()), { recursive: true });
    const corrupt = "{ definitely not JSON\n";
    fs.writeFileSync(goalsFile(), corrupt, "utf8");

    await expect(createGoal({ title: "Must not write" })).rejects.toThrow();
    expect(fs.readFileSync(goalsFile(), "utf8")).toBe(corrupt);
  });

  it("rejects a goals file whose top-level value is not an array", async () => {
    fs.mkdirSync(path.dirname(goalsFile()), { recursive: true });
    fs.writeFileSync(goalsFile(), JSON.stringify({ goals: [] }), "utf8");

    await expect(createGoal({ title: "Must not write" })).rejects.toThrow("invalid_goals_file");
  });
});

describe("goals API routes", () => {
  it("handles list and create 200, 201, and 400 responses", async () => {
    expect((await listGoalsRoute()).status).toBe(200);

    const createdResponse = await POST(new Request("http://localhost/api/goals", {
      method: "POST",
      body: JSON.stringify({ title: "Route goal" }),
    }));
    expect(createdResponse.status).toBe(201);
    const { goal } = await createdResponse.json() as { goal: { id: string; title: string } };
    expect(goal.title).toBe("Route goal");

    const invalidResponse = await POST(new Request("http://localhost/api/goals", {
      method: "POST",
      body: JSON.stringify({ title: "Invalid", parentId: "goal_missing" }),
    }));
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({ error: "invalid_goal_parent" });
  });

  it("handles item GET, PATCH, and DELETE 200, 400, and 404 responses", async () => {
    const created = await createGoal({ title: "Route goal" });
    expect((await getGoalRoute(new Request("http://localhost"), context(created.id))).status).toBe(200);

    const patched = await PATCH(new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ title: "Patched route goal" }),
    }), context(created.id));
    expect(patched.status).toBe(200);

    const invalid = await PATCH(new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ parentId: "goal_missing" }),
    }), context(created.id));
    expect(invalid.status).toBe(400);

    expect((await getGoalRoute(new Request("http://localhost"), context("goal_missing"))).status).toBe(404);
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "Nope" }) }), context("goal_missing"))).status).toBe(404);
    expect((await DELETE(new Request("http://localhost"), context(created.id))).status).toBe(200);
    expect((await DELETE(new Request("http://localhost"), context(created.id))).status).toBe(404);
  });

  it("surfaces unreadable goals storage as a 500 response", async () => {
    fs.mkdirSync(path.dirname(goalsFile()), { recursive: true });
    fs.writeFileSync(goalsFile(), "not json", "utf8");

    const response = await POST(new Request("http://localhost/api/goals", {
      method: "POST",
      body: JSON.stringify({ title: "Must not write" }),
    }));
    expect(response.status).toBe(500);
    expect((await listGoalsRoute()).status).toBe(500);
    expect(fs.readFileSync(goalsFile(), "utf8")).toBe("not json");
  });
});
