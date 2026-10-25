import "server-only";
import { appendFeedItem, listFeed, updateFeedItem } from "@/lib/feed-store";
import type { FeedItem } from "@/lib/feed-store";
import { isRetired } from "@/lib/twin-lifecycle";
import type { TwinLifecycle } from "@/lib/employees";

const MAX_OPEN_REQUESTS_PER_TWIN = 5;

export type ConnectionRequestInput = {
  twinId: string;
  twinName: string;
  lifecycle?: TwinLifecycle;
  service: string;
  reason: string;
  scope?: string;
};

export type ConnectionRequestResult =
  | { ok: true; item: FeedItem; deduped: boolean }
  | { ok: false; reason: "retired" | "rate_limited" };

/**
 * Adds an actionable Inbox request for a missing system connection. Requests
 * remain local to the workspace: this never contacts the requested service.
 */
export function requestConnection(input: ConnectionRequestInput): ConnectionRequestResult {
  if (isRetired({ lifecycle: input.lifecycle })) return { ok: false, reason: "retired" };

  const openRequests = listFeed({ status: "open", type: "connection_request" })
    .filter((item) => item.source.kind === "connection_request" && item.source.employeeId === input.twinId);
  const existing = openRequests.find(
    (item) => item.source.kind === "connection_request" && item.source.service.toLowerCase() === input.service.toLowerCase()
  );
  const now = new Date().toISOString();

  if (existing?.source.kind === "connection_request") {
    const source = {
      ...existing.source,
      reason: input.reason,
      ...(input.scope ? { scope: input.scope } : {}),
      count: existing.source.count + 1,
      lastAskedAt: now,
    };
    const item = updateFeedItem(existing.id, {
      source,
      title: `${input.twinName} requested ${input.service}`,
      detail: input.reason,
      priority: existing.priority,
    });
    return { ok: true, item: item ?? existing, deduped: true };
  }

  if (openRequests.length >= MAX_OPEN_REQUESTS_PER_TWIN) {
    return { ok: false, reason: "rate_limited" };
  }

  const item = appendFeedItem({
    source: {
      kind: "connection_request",
      employeeId: input.twinId,
      employeeName: input.twinName,
      service: input.service,
      reason: input.reason,
      ...(input.scope ? { scope: input.scope } : {}),
      count: 1,
      lastAskedAt: now,
    },
    type: "connection_request",
    title: `${input.twinName} requested ${input.service}`,
    detail: input.reason,
    priority: 2,
  });
  return { ok: true, item, deduped: false };
}
