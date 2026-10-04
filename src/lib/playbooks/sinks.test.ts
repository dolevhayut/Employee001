import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProposals: vi.fn(),
  proposalsEnabled: vi.fn(),
  registerApproval: vi.fn(),
  updateGoal: vi.fn(),
}));

vi.mock("@/lib/knowledge-proposals", () => ({
  addProposals: mocks.addProposals,
  proposalsEnabled: mocks.proposalsEnabled,
}));
vi.mock("@/lib/approval-bus", () => ({
  registerApproval: mocks.registerApproval,
}));
vi.mock("@/lib/goals", () => ({ updateGoal: mocks.updateGoal }));

import { applyPlaybookSinks } from "./sinks";
import type { Playbook } from "./types";

const output = { title: "Brief", summary: "Done", nextSteps: [] };
const playbook: Playbook = {
  id: "test",
  name: "Test",
  description: "",
  icon: "x",
  participants: "all",
  mode: "meeting",
  inputs: [{ key: "goal", label: "Goal", kind: "goal" }],
  context: [],
  prompt: "Give JSON",
  outputSchema: "brief",
  sinks: [],
  budgetUsd: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addProposals.mockResolvedValue([]);
  mocks.updateGoal.mockResolvedValue(undefined);
});

describe("playbook sinks", () => {
  it("adds one owner-approved knowledge proposal per participant", async () => {
    mocks.proposalsEnabled.mockReturnValue(true);
    const result = await applyPlaybookSinks(
      { ...playbook, sinks: ["knowledge_proposal"] },
      output,
      "run_1",
      { goal: "goal_1" },
      [
        { id: "ada", name: "Ada" },
        { id: "grace", name: "Grace" },
      ],
    );
    expect(mocks.addProposals).toHaveBeenCalledTimes(2);
    expect(mocks.addProposals).toHaveBeenCalledWith("ada", "run_1", [
      expect.objectContaining({
        file: "team-meeting-decisions.md",
        reason: "Playbook output from Test",
      }),
    ]);
    expect(result).toEqual([{ sink: "knowledge_proposal", status: "applied" }]);
  });

  it("skips knowledge proposals when that feature is disabled", async () => {
    mocks.proposalsEnabled.mockReturnValue(false);
    const result = await applyPlaybookSinks(
      { ...playbook, sinks: ["knowledge_proposal"] },
      output,
      "run_1",
    );
    expect(mocks.addProposals).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      sink: "knowledge_proposal",
      status: "skipped",
    });
  });

  it("applies a goal update after approval and ignores denial", async () => {
    let resolve!: (decision: {
      action: "allow" | "deny";
      updatedInput?: Record<string, unknown>;
    }) => void;
    mocks.registerApproval.mockImplementation(() => ({
      approvalId: "apr_1",
      promise: new Promise((done) => {
        resolve = done;
      }),
    }));
    await applyPlaybookSinks(
      { ...playbook, sinks: ["goal_update"] },
      output,
      "run_1",
      { goal: "goal_1" },
    );
    resolve({ action: "allow", updatedInput: { patch: { status: "done" } } });
    await vi.waitFor(() =>
      expect(mocks.updateGoal).toHaveBeenCalledWith("goal_1", {
        status: "done",
      }),
    );

    let deny!: (decision: { action: "allow" | "deny" }) => void;
    mocks.registerApproval.mockImplementationOnce(() => ({
      approvalId: "apr_2",
      promise: new Promise((done) => {
        deny = done;
      }),
    }));
    await applyPlaybookSinks(
      { ...playbook, sinks: ["goal_update"] },
      output,
      "run_2",
      { goal: "goal_1" },
    );
    deny({ action: "deny" });
    await Promise.resolve();
    expect(mocks.updateGoal).toHaveBeenCalledTimes(1);
  });
});
