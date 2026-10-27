// Temporary ask: the route hands `temporary` to the runner, never resumes a
// saved session, and keeps no question or answer text in the run history.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendTaskRun: vi.fn(),
  runSingleTwin: vi.fn(async (
    _employee: unknown,
    _question: string,
    onEvent: (event: Record<string, unknown>) => void,
    _history?: unknown,
    _options?: unknown,
  ) => {
    onEvent({ type: "text_delta", delta: "a private answer" });
    onEvent({
      type: "employee_done",
      employeeId: "self-twin",
      confidence: 1,
      turns: 1,
      costUsd: 0.01,
      stoppedReason: "natural",
    });
  }),
}));

vi.mock("@/lib/auth/request-user", () => ({ sessionUserFromHeaders: () => ({ id: "u1" }) }));
vi.mock("@/lib/employees-disk", () => ({
  loadEmployeesFromDisk: async () => [
    { id: "self-twin", name: "Taylor Doe", firstName: "Taylor", role: "Founder", twinStatus: "ready", lifecycle: "active" },
  ],
  bumpActivityOnDisk: vi.fn(),
}));
vi.mock("@/lib/hired-agents", () => ({ getHiredEmployees: () => [] }));
vi.mock("@/lib/employees-files", () => ({ hasEmployeeFiles: () => true }));
vi.mock("@/lib/council-runner", () => ({ runSingleTwin: mocks.runSingleTwin }));
vi.mock("@/lib/task-history", () => ({ appendTaskRun: mocks.appendTaskRun }));
vi.mock("@/lib/followup-suggestions", () => ({ generateFollowups: async () => [] }));
vi.mock("@/lib/model-provider", () => ({ canRunModel: () => ({ ok: true }), modelErrorMessage: (m: string) => m }));
vi.mock("@/lib/profile-relevance", () => ({ pickRelevantProfileFiles: () => [] }));
vi.mock("@/lib/demo-replay", () => ({ isDemoReplay: () => false }));
vi.mock("@/lib/relay/package-store", () => ({ loadPackage: async () => null }));

async function ask(extra: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("http://localhost/api/twin/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: "self-twin", question: "my secret question", sessionId: "s1", ...extra }),
    }) as never,
  );
  await res.text();
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/twin/chat temporary", () => {
  it("runs temporary: no resumed session, no question or answer kept in run history", async () => {
    await ask({ temporary: true });
    const opts = mocks.runSingleTwin.mock.calls[0][4] as { temporary: boolean; resumeSessionId?: string };
    expect(opts.temporary).toBe(true);
    expect(opts.resumeSessionId).toBeUndefined();
    const run = mocks.appendTaskRun.mock.calls[0][0] as { task: string; finalText: string; costUsd: number };
    expect(JSON.stringify(run)).not.toMatch(/secret question|private answer/);
    expect(run.costUsd).toBe(0.01);
  });

  it("a normal ask is unchanged", async () => {
    await ask({});
    const opts = mocks.runSingleTwin.mock.calls[0][4] as { temporary: boolean; resumeSessionId?: string };
    expect(opts.temporary).toBe(false);
    expect(opts.resumeSessionId).toBe("s1");
    const run = mocks.appendTaskRun.mock.calls[0][0] as { task: string; finalText: string };
    expect(run.task).toBe("my secret question");
    expect(run.finalText).toBe("a private answer");
  });
});
