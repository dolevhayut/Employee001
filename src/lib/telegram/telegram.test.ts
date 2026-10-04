import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e109-telegram-"));
  process.chdir(tempDir);
  vi.resetModules();
});

afterEach(() => {
  const globalState = globalThis as typeof globalThis & { __approvalSweep?: ReturnType<typeof setInterval> };
  if (globalState.__approvalSweep) clearInterval(globalState.__approvalSweep);
  delete globalState.__approvalSweep;
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

const approval = {
  approvalId: "apr_123",
  runId: "run_123",
  employeeId: "ada",
  employeeName: "Ada",
  toolName: "send_email",
  bareName: "send email",
  input: {},
  reason: "The customer needs a reply.",
  createdAt: 0,
  surface: "chat" as const,
};

describe("Telegram approvals", () => {
  it("formats localized, HMAC-signed approval buttons", async () => {
    const { formatApprovalMessage } = await import("./approvals");
    const message = formatApprovalMessage(approval, { language: "he", secret: "test-secret" });

    expect(message.text).toContain("נדרש אישור");
    expect(message.text).toContain("Ada");
    expect(message.replyMarkup.inline_keyboard[0]).toEqual([
      expect.objectContaining({ text: "אשר", callback_data: expect.stringMatching(/^ap:apr_123:approve:[A-Za-z0-9_-]{16}$/) }),
      expect.objectContaining({ text: "דלג", callback_data: expect.stringMatching(/^ap:apr_123:skip:[A-Za-z0-9_-]{16}$/) }),
    ]);
  });

  it("rejects a bad signature and ignores a callback from another chat", async () => {
    const { handleCallback } = await import("./approvals");
    const client = { answerCallbackQuery: vi.fn(), editMessageText: vi.fn() };
    const base = { update_id: 1, callback_query: { id: "cb_1", data: "ap:apr_123:approve:not-a-valid-hmac", message: { message_id: 4, chat: { id: 10 } } } };

    await expect(handleCallback(base, { chatId: 10, secret: "test-secret", client })).resolves.toBe("rejected");
    await expect(handleCallback({ ...base, callback_query: { ...base.callback_query, message: { message_id: 4, chat: { id: 99 } } } }, { chatId: 10, secret: "test-secret", client })).resolves.toBe("ignored");
    expect(client.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it("resolves a valid callback through the live approval bus", async () => {
    const { registerApproval } = await import("@/lib/approval-bus");
    const { formatApprovalMessage, handleCallback } = await import("./approvals");
    const pending = registerApproval({
      runId: approval.runId,
      employeeId: approval.employeeId,
      toolName: approval.toolName,
      input: approval.input,
      reason: approval.reason,
    });
    const message = formatApprovalMessage({ ...approval, approvalId: pending.approvalId }, { secret: "test-secret" });
    const callbackData = message.replyMarkup.inline_keyboard[0][0].callback_data;
    const client = { answerCallbackQuery: vi.fn(), editMessageText: vi.fn() };

    await expect(handleCallback({
      update_id: 1,
      callback_query: { id: "cb_1", data: callbackData, message: { message_id: 4, chat: { id: 10 } } },
    }, { chatId: 10, secret: "test-secret", client })).resolves.toBe("resolved");
    await expect(pending.promise).resolves.toEqual({ action: "allow" });
  });

  it("advances the long-poll offset after every update", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let getUpdates = 0;
    let finishSecondPoll: (() => void) | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (getUpdates++ === 0) return new Response(JSON.stringify({ ok: true, result: [{ update_id: 41 }] }));
      return new Promise<Response>((resolve) => {
        finishSecondPoll = () => resolve(new Response(JSON.stringify({ ok: true, result: [] })));
      });
    }) as unknown as typeof fetch;
    const { startTelegramPoller } = await import("./poller");
    const poller = startTelegramPoller({ token: "token", chatId: 10, fetchImpl });

    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    poller.stop();
    finishSecondPoll?.();
    expect(calls[0]).toMatchObject({ timeout: 25 });
    expect(calls[1]).toMatchObject({ offset: 42, timeout: 25 });
  });
});
