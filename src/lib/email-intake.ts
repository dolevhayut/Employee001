import { enqueueWorkItem } from "@/lib/work-items";
import { isRetiredSync } from "@/lib/twin-lifecycle";
import { toolkitAllowed } from "@/lib/consent-policy";
import { loadConsentStatus } from "@/lib/consent-status";

export type RawEmailMessage = Record<string, unknown>;
export type IncomingEmail = { messageId: string; threadId?: string; from?: string; subject?: string; date?: string; body?: string };

function text(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
export function isRecord(value: unknown): value is RawEmailMessage { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

/** Composio has used several action-result shapes; accept only arrays of records. */
export function extractEmailMessages(data: unknown): RawEmailMessage[] {
  if (!isRecord(data)) return [];
  for (const key of ["messages", "response_data", "items"]) {
    const value = data[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value) && Array.isArray(value.messages)) return value.messages.filter(isRecord);
  }
  return [];
}

export function normalizeEmailMessage(message: RawEmailMessage): IncomingEmail | null {
  const messageId = text(message.messageId) ?? text(message.message_id) ?? text(message.id);
  if (!messageId) return null;
  const payload = isRecord(message.payload) ? message.payload : undefined;
  return { messageId, threadId: text(message.threadId) ?? text(message.thread_id), from: text(message.sender) ?? text(message.from), subject: text(message.subject), date: text(message.messageTimestamp) ?? text(message.date) ?? text(message.internalDate), body: text(message.messageText) ?? text(message.snippet) ?? text(message.preview) ?? text(payload?.body) };
}

/** The one downstream door for both Composio push and reconciliation pulls.
 *  Mail is only taken in when the employee's consent covers their connected
 *  tools ("integrations"); otherwise it is dropped, not queued. */
export function ingestEmailMessage(
  employeeId: string,
  message: IncomingEmail,
): { deduped: boolean; workItemId: string | null; skipped?: "consent" | "retired" } {
  // A former employee's twin answers in the app only; it takes no work.
  if (isRetiredSync(employeeId)) return { deduped: false, workItemId: null, skipped: "retired" };
  if (!toolkitAllowed(loadConsentStatus(employeeId), "gmail")) {
    return { deduped: false, workItemId: null, skipped: "consent" };
  }
  const { item, deduped } = enqueueWorkItem({ type: "email", assigneeEmployeeId: employeeId, title: message.subject ? `Email: ${message.subject}` : "Email (no subject)", payload: message, idempotencyKey: `email:${message.messageId}` });
  return { deduped, workItemId: item.id };
}

/** Finds a mail object inside Composio V1/V2/V3 envelopes without trusting an envelope id. */
export function emailFromTriggerPayload(value: unknown): IncomingEmail | null {
  if (!isRecord(value)) return null;
  const data = isRecord(value.data) ? value.data : undefined;
  const candidates = [isRecord(value.payload) ? value.payload : undefined, isRecord(value.originalPayload) ? value.originalPayload : undefined, data, data && isRecord(data.payload) ? data.payload : undefined, data && isRecord(data.message) ? data.message : undefined, isRecord(value.message) ? value.message : undefined];
  for (const candidate of candidates) {
    if (!candidate || !["subject", "from", "sender", "messageText", "snippet", "threadId", "thread_id"].some((key) => candidate[key] !== undefined)) continue;
    const normalized = normalizeEmailMessage(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function gmailQuerySince(cursor: string | undefined): string {
  if (!cursor || !Number.isFinite(Date.parse(cursor))) return "in:inbox newer_than:2d";
  return `in:inbox after:${Math.floor(Date.parse(cursor) / 1000)}`;
}
