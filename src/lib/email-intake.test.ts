import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emailFromTriggerPayload, gmailQuerySince, normalizeEmailMessage } from "./email-intake";
import { emailPollIntervalMs, findNewMailTrigger, publicWebhookUrl, verifyComposioWebhook } from "./email-intake-trigger";

describe("email intake", () => {
  it("normalizes a mail once, with its provider message id retained for queue dedupe", () => {
    expect(normalizeEmailMessage({ id: "gmail-42", sender: "a@example.com", subject: "Hello", snippet: "Body" })).toEqual({ messageId: "gmail-42", from: "a@example.com", subject: "Hello", body: "Body" });
    expect(emailFromTriggerPayload({ data: { message: { messageId: "gmail-42", subject: "Hello" } } })).toMatchObject({ messageId: "gmail-42" });
    // An envelope id alone must never become an idempotency key.
    expect(emailFromTriggerPayload({ id: "webhook-42", data: {} })).toBeNull();
  });

  it("uses a cursor after the first bounded recovery scan", () => {
    expect(gmailQuerySince(undefined)).toBe("in:inbox newer_than:2d");
    expect(gmailQuerySince("2026-10-04T12:00:00.000Z")).toBe("in:inbox after:1791115200");
  });

  it("selects five-minute fallback and only accepts an explicit public HTTPS base URL", () => {
    expect(emailPollIntervalMs(false)).toBe(5 * 60 * 1000);
    expect(emailPollIntervalMs(true)).toBe(30 * 60 * 1000);
    expect(publicWebhookUrl({ APP_URL: "http://127.0.0.1:3000" })).toBeNull();
    expect(publicWebhookUrl({ EMPLOYEE001_PUBLIC_URL: "https://acme.fly.dev/" })).toBe("https://acme.fly.dev/api/email/composio");
  });

  it("discovers a new-mail trigger but rejects draft-like lookalikes", () => {
    expect(findNewMailTrigger([{ slug: "GMAIL_NEW_GMAIL_MESSAGE", description: "New message in inbox" }, { slug: "GMAIL_NEW_DRAFT", description: "New email draft" }])).toBe("GMAIL_NEW_GMAIL_MESSAGE");
  });

  it("passes raw body and all Composio signature fields to the SDK verifier", async () => {
    const calls: unknown[] = [];
    const now = 1791115200 * 1000;
    process.env.EMPLOYEE001_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "e001-hook-"));
    const result = await verifyComposioWebhook({ payload: '{"x":1}', signature: "v1,sig", id: "msg_1", timestamp: "1791115200", secret: "secret", now }, async (params) => { calls.push(params); return { payload: { ok: true } }; });
    expect(result).toEqual({ payload: { ok: true } });
    expect(calls).toEqual([{ payload: '{"x":1}', signature: "v1,sig", id: "msg_1", timestamp: "1791115200", secret: "secret" }]);
    expect(await verifyComposioWebhook({ payload: "{}", signature: null, id: "msg", timestamp: "1", secret: "secret" })).toBeNull();
  });
});
