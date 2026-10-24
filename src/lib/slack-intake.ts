import { enqueueWorkItem } from "@/lib/work-items";
import { isRetiredSync } from "@/lib/twin-lifecycle";
import { toolkitAllowed } from "@/lib/consent-policy";
import { loadConsentStatus } from "@/lib/consent-status";

export type RawSlackMessage = Record<string, unknown>;
export type IncomingSlackMessage = {
  channel: string; ts: string; text: string; userId: string; threadTs?: string;
  workspaceId?: string; isBot: boolean; isDm: boolean; mentionedUserIds: string[];
  externalWorkspace?: boolean;
  threadMessages?: Array<{ userId?: string; text: string; ts?: string }>;
};

const string = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const record = (value: unknown): value is RawSlackMessage => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function mentionUserIds(text: string): string[] {
  return [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/gi)].map((m) => m[1]))];
}

export function normalizeSlackMessage(value: RawSlackMessage): IncomingSlackMessage | null {
  const channel = string(value.channel) ?? string((value.channel as RawSlackMessage | undefined)?.id);
  const ts = string(value.ts) ?? string(value.event_ts);
  const text = string(value.text);
  const userId = string(value.user) ?? string(value.user_id);
  if (!channel || !ts || !text || !userId) return null;
  const subtype = string(value.subtype);
  return {
    channel, ts, text, userId, threadTs: string(value.thread_ts),
    workspaceId: string(value.team) ?? string(value.team_id),
    externalWorkspace: value.is_ext_shared_channel === true || value.is_external === true,
    isBot: Boolean(value.bot_id) || subtype === "bot_message" || value.is_bot === true,
    isDm: typeof value.channel_type === "string" ? value.channel_type === "im" : channel.startsWith("D"),
    mentionedUserIds: mentionUserIds(text),
  };
}

/** Accept Composio's current and older trigger envelopes without trusting their envelope ids. */
export function slackFromTriggerPayload(value: unknown): IncomingSlackMessage | null {
  if (!record(value)) return null;
  const data = record(value.data) ? value.data : undefined;
  const candidates = [value, record(value.payload) ? value.payload : undefined, data, data && record(data.payload) ? data.payload : undefined, data && record(data.event) ? data.event : undefined, record(value.event) ? value.event : undefined];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const message = normalizeSlackMessage(candidate);
    if (message) return message;
  }
  return null;
}

export function mappedTwinForMessage(message: IncomingSlackMessage, mappings: Array<{ employeeId: string; slackUserId?: string; workspaceId?: string }>): string | null {
  // DMs are addressed to the connected identity; mentions are explicit. A mapping
  // without a provider user id is intentionally unusable — names are unsafe.
  const candidates = mappings.filter((m) => m.slackUserId && (!message.workspaceId || !m.workspaceId || m.workspaceId === message.workspaceId));
  if (message.isDm) return candidates.length === 1 ? candidates[0].employeeId : null;
  return candidates.find((m) => message.mentionedUserIds.includes(m.slackUserId!))?.employeeId ?? null;
}

export function shouldIgnoreSlackMessage(message: IncomingSlackMessage, twinSlackUserId?: string): boolean {
  return message.isBot || Boolean(twinSlackUserId && message.userId === twinSlackUserId);
}

/** Slack messages are taken in only when the employee's consent covers
 *  their connected tools ("integrations"); otherwise they are dropped. */
export function ingestSlackMessage(
  employeeId: string,
  message: IncomingSlackMessage,
): { deduped: boolean; workItemId: string | null; skipped?: "consent" | "retired" } {
  // A former employee's twin answers in the app only; it takes no work.
  if (isRetiredSync(employeeId)) return { deduped: false, workItemId: null, skipped: "retired" };
  if (!toolkitAllowed(loadConsentStatus(employeeId), "slack")) {
    return { deduped: false, workItemId: null, skipped: "consent" };
  }
  const { item, deduped } = enqueueWorkItem({
    type: "slack", assigneeEmployeeId: employeeId,
    title: message.isDm ? "Slack DM" : "Slack mention",
    payload: { channel: message.channel, ts: message.ts, threadTs: message.threadTs, text: message.text, userId: message.userId, workspaceId: message.workspaceId, externalWorkspace: message.externalWorkspace, isDm: message.isDm, mentionedTwinUserId: message.mentionedUserIds[0], threadMessages: message.threadMessages },
    idempotencyKey: `slack:${message.channel}:${message.ts}`,
  });
  return { deduped, workItemId: item.id };
}

export function isActionRequest(text: string): boolean {
  return /\b(send|post|create|delete|update|schedule|invite|approve|deploy|run|execute|change)\b|(?:שלח|פרסם|צור|מחק|עדכן|קבע|הזמן|אשר|הרץ|בצע)/i.test(text);
}

/** Pure so the per-channel hourly policy is testable without touching disk. */
export function isWithinSlackReplyRate(timestamps: number[], now = Date.now(), limit = 10): boolean {
  return timestamps.filter((ts) => ts > now - 60 * 60_000).length < limit;
}
