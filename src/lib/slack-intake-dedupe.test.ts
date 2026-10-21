import { describe, expect, it, vi } from "vitest";
const queue = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/work-items", () => ({ enqueueWorkItem: (input: { idempotencyKey: string }) => { const old = queue.get(input.idempotencyKey); if (old) return { item: { id: old }, deduped: true }; const id = `work-${queue.size + 1}`; queue.set(input.idempotencyKey, id); return { item: { id }, deduped: false }; } }));
import { ingestSlackMessage } from "./slack-intake";
describe("Slack push/poll dedupe", () => { it("dedupes channel:ts regardless of intake path", () => { queue.clear(); const m = { channel: "C1", ts: "123.4", text: "hi", userId: "U1", isBot: false, isDm: false, mentionedUserIds: [] }; expect(ingestSlackMessage("dana", m).deduped).toBe(false); expect(ingestSlackMessage("dana", m)).toMatchObject({ deduped: true, workItemId: "work-1" }); }); });

const consent = vi.hoisted(() => ({ status: { kind: "exempt", reason: "synthetic" } as unknown }));
vi.mock("@/lib/consent-status", () => ({ loadConsentStatus: () => consent.status }));

describe("Slack intake consent", () => {
  it("drops messages when the employee's consent doesn't cover connected tools", () => {
    queue.clear();
    consent.status = { kind: "recorded", scopes: new Set(["data-collection"]) };
    try {
      const m = { channel: "C2", ts: "9.9", text: "hi", userId: "U1", isBot: false, isDm: true, mentionedUserIds: [] };
      expect(ingestSlackMessage("dana", m)).toEqual({ deduped: false, workItemId: null, skipped: "consent" });
      expect(queue.size).toBe(0);
    } finally {
      consent.status = { kind: "exempt", reason: "synthetic" };
    }
  });

  it("drops messages for a twin whose employee hasn't recorded consent", () => {
    queue.clear();
    consent.status = { kind: "consent_required" };
    try {
      const m = { channel: "C3", ts: "1.1", text: "hi", userId: "U1", isBot: false, isDm: true, mentionedUserIds: [] };
      expect(ingestSlackMessage("dana", m)).toMatchObject({ workItemId: null, skipped: "consent" });
    } finally {
      consent.status = { kind: "exempt", reason: "synthetic" };
    }
  });
});
