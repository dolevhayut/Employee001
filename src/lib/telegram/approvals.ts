import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveApproval, type ApprovalRequest } from "@/lib/approval-bus";
import type { TelegramClient, TelegramUpdate } from "./client";

export type TelegramLanguage = "en" | "he";
export type ApprovalAction = "approve" | "skip";

const CALLBACK_PREFIX = "ap";
const SIGNATURE_LENGTH = 16;

function secretFile(): string {
  return path.join(process.cwd(), "data", "telegram-approval-secret");
}

/** Stable per-install secret. This deliberately stays local and is never sent to Telegram. */
export function getInstallSecret(): string {
  const file = secretFile();
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // First use, or a previously unreadable file: create a fresh local secret.
  }
  const secret = randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
}

export function signApprovalCallback(approvalId: string, action: ApprovalAction, secret = getInstallSecret()): string {
  return createHmac("sha256", secret)
    .update(`${approvalId}:${action}`)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);
}

function callbackData(approvalId: string, action: ApprovalAction, secret?: string): string {
  return `${CALLBACK_PREFIX}:${approvalId}:${action}:${signApprovalCallback(approvalId, action, secret)}`;
}

export type FormattedApprovalMessage = {
  text: string;
  replyMarkup: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
};

export function formatApprovalMessage(
  approval: ApprovalRequest,
  options: { language?: TelegramLanguage; secret?: string } = {},
): FormattedApprovalMessage {
  const language = options.language ?? "en";
  const employee = approval.employeeName ?? approval.employeeId;
  const labels = language === "he"
    ? {
        heading: "נדרש אישור",
        employee: "עובד",
        action: "פעולה",
        reason: "סיבה",
        approve: "אשר",
        skip: "דלג",
      }
    : {
        heading: "Approval required",
        employee: "Employee",
        action: "Action",
        reason: "Reason",
        approve: "Approve",
        skip: "Skip",
      };
  return {
    text: `${labels.heading}\n\n${labels.employee}: ${employee}\n${labels.action}: ${approval.bareName ?? approval.toolName}\n${labels.reason}: ${approval.reason}`,
    replyMarkup: {
      inline_keyboard: [[
        { text: labels.approve, callback_data: callbackData(approval.approvalId, "approve", options.secret) },
        { text: labels.skip, callback_data: callbackData(approval.approvalId, "skip", options.secret) },
      ]],
    },
  };
}

type ParsedCallback = { approvalId: string; action: ApprovalAction; signature: string };

function parseCallback(data: string | undefined): ParsedCallback | undefined {
  if (!data) return undefined;
  const [prefix, approvalId, action, signature, ...rest] = data.split(":");
  if (prefix !== CALLBACK_PREFIX || !approvalId || rest.length > 0 || (action !== "approve" && action !== "skip") || !signature) return undefined;
  return { approvalId, action, signature };
}

function hasValidSignature(callback: ParsedCallback, secret: string): boolean {
  const expected = signApprovalCallback(callback.approvalId, callback.action, secret);
  const received = Buffer.from(callback.signature);
  const expectedBuffer = Buffer.from(expected);
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
}

export type CallbackResult = "ignored" | "rejected" | "resolved" | "missing";

export async function handleCallback(
  update: TelegramUpdate,
  options: {
    chatId: number | string;
    secret?: string;
    client?: Pick<TelegramClient, "answerCallbackQuery" | "editMessageText">;
    language?: TelegramLanguage;
  },
): Promise<CallbackResult> {
  const query = update.callback_query;
  const message = query?.message;
  if (!query || !message || String(message.chat.id) !== String(options.chatId)) return "ignored";

  const callback = parseCallback(query.data);
  const secret = options.secret ?? getInstallSecret();
  if (!callback || !hasValidSignature(callback, secret)) {
    await options.client?.answerCallbackQuery(query.id, options.language === "he" ? "אישור לא תקין" : "Invalid approval");
    return "rejected";
  }

  const resolved = resolveApproval(
    callback.approvalId,
    callback.action === "approve" ? { action: "allow" } : { action: "deny", message: "Skipped from Telegram." },
  );
  const isHebrew = options.language === "he";
  const text = resolved
    ? callback.action === "approve"
      ? isHebrew ? "האישור אושר" : "Approval approved"
      : isHebrew ? "האישור דולג" : "Approval skipped"
    : isHebrew ? "האישור כבר טופל או פג תוקפו" : "Approval already handled or expired";
  await options.client?.answerCallbackQuery(query.id, text);
  if (resolved) await options.client?.editMessageText(message.chat.id, message.message_id, text);
  return resolved ? "resolved" : "missing";
}
