import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/routine-scheduler");
});

describe("instrumentation register", () => {
  it("does not load the scheduler in the Edge runtime", async () => {
    const ensureSchedulerStarted = vi.fn();
    const schedulerModule = vi.fn(() => ({ ensureSchedulerStarted }));
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.doMock("@/lib/routine-scheduler", schedulerModule);

    const { register } = await import("./instrumentation");
    await register();

    expect(ensureSchedulerStarted).not.toHaveBeenCalled();
    expect(schedulerModule).not.toHaveBeenCalled();
  });

  it("does not start the scheduler during a production build", async () => {
    const ensureSchedulerStarted = vi.fn();
    const schedulerModule = vi.fn(() => ({ ensureSchedulerStarted }));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.doMock("@/lib/routine-scheduler", schedulerModule);

    const { register } = await import("./instrumentation");
    await register();

    expect(ensureSchedulerStarted).not.toHaveBeenCalled();
    expect(schedulerModule).not.toHaveBeenCalled();
  });

  it("starts the scheduler when the Node.js server starts", async () => {
    const ensureSchedulerStarted = vi.fn();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.doMock("@/lib/routine-scheduler", () => ({ ensureSchedulerStarted }));

    const { register } = await import("./instrumentation");
    await register();

    expect(ensureSchedulerStarted).toHaveBeenCalledOnce();
  });
});
