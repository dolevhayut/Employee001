import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_REVIEW_POLL_MS,
  getPendingReviewPollSnapshot,
  resetPendingReviewPollForTests,
  subscribePendingReviewPoll,
} from "./pending-review-poll";

describe("pending-review-poll", () => {
  const fetchMock = vi.fn();
  let visibilityState = "visible";

  beforeEach(() => {
    resetPendingReviewPollForTests();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.includes("/api/feed") ? [{ id: "f1" }] : [{ approvalId: "a1" }]),
    }));
    vi.stubGlobal("fetch", fetchMock);
    visibilityState = "visible";
    vi.stubGlobal("document", {
      visibilityState,
      addEventListener: vi.fn((type: string, handler: () => void) => {
        if (type === "visibilitychange") {
          (document as { _visHandler?: () => void })._visHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    resetPendingReviewPollForTests();
    vi.unstubAllGlobals();
  });

  it("shares one fetch across multiple subscribers", async () => {
    vi.useFakeTimers();
    const unsubA = subscribePendingReviewPoll(() => {});
    const unsubB = subscribePendingReviewPoll(() => {});
    await Promise.resolve();
    await Promise.resolve();
    const afterSubscribe = fetchMock.mock.calls.length;
    expect(afterSubscribe).toBe(2);

    await vi.advanceTimersByTimeAsync(PENDING_REVIEW_POLL_MS);
    await Promise.resolve();
    const afterOneTick = fetchMock.mock.calls.length;
    expect(afterOneTick - afterSubscribe).toBe(2);

    unsubA();
    unsubB();
    await vi.advanceTimersByTimeAsync(PENDING_REVIEW_POLL_MS);
    expect(fetchMock.mock.calls.length).toBe(afterOneTick);
    vi.useRealTimers();
  });

  it("backs off polling while the tab is hidden", async () => {
    subscribePendingReviewPoll(() => {});
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    const visibleCalls = fetchMock.mock.calls.length;

    visibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", { get: () => visibilityState, configurable: true });
    (document as { _visHandler?: () => void })._visHandler?.();

    await new Promise((r) => setTimeout(r, PENDING_REVIEW_POLL_MS + 80));
    expect(fetchMock.mock.calls.length).toBe(visibleCalls);

    visibilityState = "visible";
    (document as { _visHandler?: () => void })._visHandler?.();
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(visibleCalls));
    expect(getPendingReviewPollSnapshot().count).toBe(2);
  });
});
