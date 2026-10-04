import { listPendingApprovals } from "@/lib/approval-bus";
import { formatApprovalMessage, handleCallback, type TelegramLanguage } from "./approvals";
import { createTelegramClient } from "./client";

export type TelegramPoller = { stop: () => void };

export function startTelegramPoller({
  token,
  chatId,
  language = "en",
  fetchImpl = fetch,
}: {
  token: string;
  chatId: number | string;
  language?: TelegramLanguage;
  fetchImpl?: typeof fetch;
}): TelegramPoller {
  const client = createTelegramClient(token, fetchImpl);
  const sentApprovals = new Set<string>();
  let stopped = false;
  let offset: number | undefined;
  let controller: AbortController | undefined;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function sendPendingApprovals(): Promise<void> {
    for (const approval of listPendingApprovals()) {
      if (sentApprovals.has(approval.approvalId)) continue;
      const message = formatApprovalMessage(approval, { language });
      await client.sendMessage(chatId, message.text, message.replyMarkup);
      sentApprovals.add(approval.approvalId);
    }
  }

  void (async () => {
    let backoffMs = 1_000;
    while (!stopped) {
      try {
        await sendPendingApprovals();
        controller = new AbortController();
        const updates = await client.getUpdates(offset, controller.signal);
        controller = undefined;
        for (const update of updates) {
          // Telegram confirms every lower update on the following request, even ignored ones.
          offset = update.update_id + 1;
          await handleCallback(update, { chatId, client, language });
        }
        backoffMs = 1_000;
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === "AbortError")) break;
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  })();

  return {
    stop() {
      stopped = true;
      controller?.abort();
    },
  };
}
