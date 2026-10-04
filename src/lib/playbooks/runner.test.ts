import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadEmployees: vi.fn(), runSingleTwin: vi.fn(), sinks: vi.fn(() => []) }));
vi.mock("@/lib/employees-disk", () => ({ loadEmployeesFromDisk: mocks.loadEmployees }));
vi.mock("@/lib/council-runner", () => ({ runSingleTwin: mocks.runSingleTwin }));
vi.mock("./sinks", () => ({ applyPlaybookSinks: mocks.sinks }));
import { registerReportRunner, runPlaybook } from "./runner";
import type { Playbook } from "./types";

const employee = { id: "ada", name: "Ada Lovelace", firstName: "Ada", role: "CTO", department: "Engineering", initials: "AL", avatarColor: "#000", integrations: [], twinStatus: "ready", twinConfidence: 1, profileFilesComplete: 9, questionsThisWeek: 0, skills: [], orgSkillIds: [], seedModel: "claude-sonnet-5-5", refreshModel: "claude-sonnet-5-5", ttsVoiceId: "voice" };
const playbook: Playbook = { id: "test", name: "Test", description: "", icon: "x", participants: "all", mode: "single", inputs: [], context: [], prompt: "Give JSON", outputSchema: "brief", sinks: [], budgetUsd: 1 };
beforeEach(() => { vi.clearAllMocks(); mocks.loadEmployees.mockResolvedValue([employee]); });
describe("playbook runner", () => {
  it("retries one invalid model reply with its validation error", async () => {
    mocks.runSingleTwin.mockResolvedValueOnce("not json").mockResolvedValueOnce('{"title":"Brief","summary":"Done","nextSteps":[]}');
    const result = await runPlaybook(playbook, {});
    expect(result.status).toBe("completed"); expect(result.outputs).toHaveLength(1); expect(mocks.runSingleTwin).toHaveBeenCalledTimes(2);
    expect(mocks.runSingleTwin.mock.calls[1][1]).toContain("previous reply failed validation");
  });
  it("uses a registered deterministic report runner without calling a model", async () => {
    const dispose = registerReportRunner("report", () => ({ status: "ok", checks: [] }));
    const result = await runPlaybook({ ...playbook, id: "report", mode: "report", outputSchema: "health" }, {});
    dispose();
    expect(result).toMatchObject({ status: "completed", outputs: [{ status: "ok", checks: [] }] }); expect(mocks.runSingleTwin).not.toHaveBeenCalled();
  });
  it("does not start another meeting participant after its budget is consumed", async () => {
    mocks.loadEmployees.mockResolvedValue([{ ...employee, id: "ada" }, { ...employee, id: "grace", name: "Grace Hopper" }]);
    mocks.runSingleTwin.mockImplementation(async (_employee: unknown, _prompt: unknown, onEvent: (event: { type: string; costUsd?: number }) => void) => { onEvent({ type: "employee_done", costUsd: 1 }); return '{"title":"Brief","summary":"Done","nextSteps":[]}' });
    const result = await runPlaybook({ ...playbook, mode: "meeting", budgetUsd: 1 }, {});
    expect(result.status).toBe("budget_exhausted"); expect(mocks.runSingleTwin).toHaveBeenCalledTimes(1);
  });
});
