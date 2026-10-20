import { describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/work-items", () => ({
  enqueueWorkItem: (input: { idempotencyKey: string }) => {
    const existing = queue.get(input.idempotencyKey);
    if (existing) return { item: { id: existing }, deduped: true };
    const id = `work-${queue.size + 1}`;
    queue.set(input.idempotencyKey, id);
    return { item: { id }, deduped: false };
  },
}));

const consent = vi.hoisted(() => ({ status: { kind: "legacy" } as unknown }));
vi.mock("@/lib/consent-status", () => ({ loadConsentStatus: () => consent.status }));

import { ingestEmailMessage } from "./email-intake";

describe("push/poll email dedupe", () => {
  it("uses the provider message id, so either intake path can arrive first", () => {
    queue.clear();
    const email = { messageId: "gmail-message-9", subject: "same message" };
    expect(ingestEmailMessage("ava", email)).toMatchObject({ deduped: false });
    expect(ingestEmailMessage("ava", email)).toMatchObject({ deduped: true, workItemId: "work-1" });
  });

  it("drops mail when the employee's consent doesn't cover connected tools", () => {
    queue.clear();
    consent.status = { kind: "recorded", scopes: new Set(["data-collection"]) };
    try {
      expect(ingestEmailMessage("ava", { messageId: "m-2" })).toEqual({ deduped: false, workItemId: null, skipped: "consent" });
      expect(queue.size).toBe(0);
    } finally {
      consent.status = { kind: "legacy" };
    }
  });
});
