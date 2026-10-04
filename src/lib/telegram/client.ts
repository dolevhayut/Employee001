export type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramMessage = {
  message_id: number;
  chat: { id: number | string };
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
};

type TelegramResponse<T> = { ok: true; result: T } | { ok: false; description?: string };

type FetchLike = typeof fetch;

export type TelegramClient = ReturnType<typeof createTelegramClient>;

/** A deliberately small wrapper around the HTTP Bot API; it needs no SDK. */
export function createTelegramClient(token: string, fetchImpl: FetchLike = fetch) {
  const baseUrl = `https://api.telegram.org/bot${token}`;

  async function call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetchImpl(`${baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Telegram ${method} failed: HTTP ${response.status}`);
    const payload = (await response.json()) as TelegramResponse<T>;
    if (!payload.ok) throw new Error(`Telegram ${method} failed: ${payload.description ?? "unknown error"}`);
    return payload.result;
  }

  return {
    getUpdates(offset?: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
      return call<TelegramUpdate[]>("getUpdates", {
        ...(offset === undefined ? {} : { offset }),
        timeout: 25,
        allowed_updates: ["callback_query"],
      }, signal);
    },
    sendMessage(chatId: number | string, text: string, replyMarkup: TelegramInlineKeyboard): Promise<TelegramMessage> {
      return call<TelegramMessage>("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: replyMarkup,
      });
    },
    answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
      return call<boolean>("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      });
    },
    editMessageText(chatId: number | string, messageId: number, text: string): Promise<TelegramMessage | true> {
      return call<TelegramMessage | true>("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
      });
    },
  };
}
