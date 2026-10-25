"use client";

// One shared poll for live tool approvals + open needs-review feed items.
// GlobalApprovalOverlay and the notification bell subscribe here so workspace
// pages don't double-fetch the same endpoints.

export const PENDING_REVIEW_POLL_MS = 2500;

export type PendingReviewLiveRaw = {
  approvalId: string;
  runId: string;
  employeeId: string;
  employeeName?: string;
  toolName: string;
  bareName?: string;
  input: Record<string, unknown>;
  reason: string;
  createdAt: number;
  surface: "chat" | "background";
  context?: { type: "routine"; routineId: string; routineName: string };
};

export type PendingReviewFeedRaw = {
  id: string;
  ts: string;
  title: string;
  detail?: string;
  source: Record<string, unknown>;
};

type PollSnapshot = {
  live: PendingReviewLiveRaw[];
  feed: PendingReviewFeedRaw[];
  count: number;
  version: number;
};

type Listener = () => void;

let snapshot: PollSnapshot = { live: [], feed: [], count: 0, version: 0 };
const listeners = new Set<Listener>();
let subscriberCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let visibilityBound = false;

function publish(next: Omit<PollSnapshot, "version" | "count">) {
  snapshot = {
    ...next,
    count: next.live.length + next.feed.length,
    version: snapshot.version + 1,
  };
  for (const l of listeners) l();
}

async function loadPendingReview() {
  if (inFlight) return;
  inFlight = true;
  try {
    const [liveRes, feedRes] = await Promise.all([
      fetch("/api/approvals/pending", { cache: "no-store" }),
      fetch("/api/feed?status=open&type=needs-review", { cache: "no-store" }),
    ]);
    const live = liveRes.ok ? ((await liveRes.json()) as PendingReviewLiveRaw[]) : [];
    const feed = feedRes.ok ? ((await feedRes.json()) as PendingReviewFeedRaw[]) : [];
    publish({ live, feed });
  } catch {
    /* ignore — keep last good snapshot */
  } finally {
    inFlight = false;
  }
}

function clearPollTimer() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function schedulePollTimer() {
  clearPollTimer();
  if (typeof document === "undefined") return;
  if (document.visibilityState !== "visible") return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") void loadPendingReview();
  }, PENDING_REVIEW_POLL_MS);
}

function onVisibilityChange() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    void loadPendingReview();
    schedulePollTimer();
  } else {
    clearPollTimer();
  }
}

function startPolling() {
  if (typeof document === "undefined") return;
  void loadPendingReview();
  if (!visibilityBound) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    visibilityBound = true;
  }
  schedulePollTimer();
}

function stopPolling() {
  clearPollTimer();
  if (visibilityBound && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityBound = false;
  }
}

export function subscribePendingReviewPoll(onStoreChange: Listener): () => void {
  listeners.add(onStoreChange);
  subscriberCount += 1;
  if (subscriberCount === 1) startPolling();
  return () => {
    listeners.delete(onStoreChange);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) stopPolling();
  };
}

export function getPendingReviewPollSnapshot(): PollSnapshot {
  return snapshot;
}

/** Drop one item locally after resolve so overlay + bell stay in sync before the next poll. */
export function optimisticallyRemovePendingReview(key: string) {
  const live = snapshot.live.filter((a) => a.approvalId !== key);
  const feed = snapshot.feed.filter((f) => f.id !== key);
  if (live.length === snapshot.live.length && feed.length === snapshot.feed.length) return;
  publish({ live, feed });
}

/** @internal test hook — reset module state between vitest cases. */
export function resetPendingReviewPollForTests() {
  stopPolling();
  listeners.clear();
  subscriberCount = 0;
  inFlight = false;
  snapshot = { live: [], feed: [], count: 0, version: 0 };
}
