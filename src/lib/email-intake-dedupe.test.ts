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

import { ingestEmailMessage } from "./email-intake";

describe("push/poll email dedupe", () => {
  it("uses the provider message id, so either intake path can arrive first", () => {
    queue.clear();
    const email = { messageId: "gmail-message-9", subject: "same message" };
    expect(ingestEmailMessage("ava", email)).toMatchObject({ deduped: false });
    expect(ingestEmailMessage("ava", email)).toMatchObject({ deduped: true, workItemId: "work-1" });
  });
});
