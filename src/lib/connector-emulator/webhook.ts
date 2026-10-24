// Composio trigger deliveries for "new email" and "new Slack message", signed
// the way Composio signs them (V3 envelope; webhook-id / webhook-timestamp /
// webhook-signature headers; v1 = base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`).
// What /api/email/composio and /api/slack/composio verify with the real SDK.
// Pure and import-free (beyond node:crypto) so scripts/connector-emulator-trigger.mjs
// can load it with Node's type stripping.

import { createHash, createHmac, randomUUID } from "node:crypto";

const gmailId = (key: string) => createHash("sha256").update(`gmail:${key}`).digest("hex").slice(0, 16);
const slackTs = (ms: number) => `${Math.floor(ms / 1000)}.${String((ms % 1000) * 1000).padStart(6, "0")}`;

export type Delivery = { body: string; headers: Record<string, string> };

export function signDelivery(body: string, secret: string, id = `msg_${randomUUID()}`, timestampSec = Math.floor(Date.now() / 1000)): Delivery {
  const timestamp = String(timestampSec);
  const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { body, headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` } };
}

function envelope(triggerSlug: string, employeeId: string, toolkit: string, data: Record<string, unknown>, now: number) {
  return {
    id: `evt_${gmailId(`${triggerSlug}:${employeeId}:${now}:${JSON.stringify(data)}`)}`,
    timestamp: new Date(now).toISOString(),
    type: "composio.trigger.message",
    metadata: {
      log_id: `log_${gmailId(`log:${now}`)}`,
      trigger_slug: triggerSlug,
      trigger_id: `ti_emu_${toolkit}_${employeeId}`,
      connected_account_id: `ca_emu_${toolkit}_${employeeId}`,
      auth_config_id: `ac_emu_${toolkit}`,
      user_id: `employee:${employeeId}`,
    },
    data,
  };
}

export type IncomingEmailEvent = { from: string; to: string; subject: string; body: string; threadId?: string; messageId?: string };

/** GMAIL_NEW_GMAIL_MESSAGE, with the fields Composio's Gmail trigger carries. */
export function emailTrigger(employeeId: string, mail: IncomingEmailEvent, now = Date.now()) {
  const messageId = mail.messageId ?? gmailId(`incoming:${employeeId}:${now}:${mail.subject}`);
  return envelope("GMAIL_NEW_GMAIL_MESSAGE", employeeId, "gmail", {
    messageId,
    threadId: mail.threadId ?? messageId,
    messageTimestamp: new Date(now).toISOString(),
    labelIds: ["INBOX", "UNREAD", "CATEGORY_PRIMARY"],
    sender: mail.from,
    to: mail.to,
    subject: mail.subject,
    messageText: mail.body,
    preview: { subject: mail.subject, body: mail.body.slice(0, 200) },
    attachmentList: [],
  }, now);
}

export type IncomingSlackEvent = { channel: string; user: string; text: string; team: string; threadTs?: string; channelType?: "channel" | "im" };

/** SLACK_NEW_MESSAGE, shaped like the Slack event the trigger forwards. */
export function slackTrigger(employeeId: string, msg: IncomingSlackEvent, now = Date.now()) {
  const ts = slackTs(now);
  return envelope("SLACK_NEW_MESSAGE", employeeId, "slack", {
    type: "message",
    channel: msg.channel,
    channel_type: msg.channelType ?? (msg.channel.startsWith("D") ? "im" : "channel"),
    user: msg.user,
    text: msg.text,
    team: msg.team,
    ts,
    event_ts: ts,
    ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
  }, now);
}

export const EMAIL_ROUTE = "/api/email/composio";
export const SLACK_ROUTE = "/api/slack/composio";
