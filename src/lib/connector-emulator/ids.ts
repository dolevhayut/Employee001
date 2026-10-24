// Deterministic provider ids for CompanySim records, so the same person always
// has the same Slack user id, Gmail message ids and so on across runs. Pure and
// alias-free: scripts/connector-emulator-trigger.mjs imports it directly.

import { createHash } from "node:crypto";

export function hash(input: string, length = 12): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export const slackUserId = (personId: string) => `U${hash(`slack-user:${personId}`, 10).toUpperCase()}`;
export const slackChannelId = (channelId: string) => `C${hash(`slack-channel:${channelId}`, 10).toUpperCase()}`;
export const slackTeamId = (domain: string) => `T${hash(`slack-team:${domain}`, 10).toUpperCase()}`;
export const gmailId = (key: string) => hash(`gmail:${key}`, 16);
export const outlookId = (key: string) => `AAMk${hash(`outlook:${key}`, 40)}`;
export const outlookConversationId = (threadKey: string) => `AAQk${hash(`outlook-conv:${threadKey}`, 40)}`;
export const jiraAccountId = (personId: string) => `712020:${hash(`jira:${personId}`, 32)}`;
export const driveFileId = (documentId: string) => `1${hash(`drive:${documentId}`, 32)}`;

export function guid(key: string): string {
  const h = hash(`guid:${key}`, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const teamsChannelId = (key: string) => `19:${hash(`teams-channel:${key}`, 32)}@thread.tacv2`;

/** Slack ts: seconds plus six digits, unique per record even for equal timestamps. */
export function slackTs(iso: string, recordId: string): string {
  const ms = Date.parse(iso);
  const micro = (ms % 1000) * 1000 + (parseInt(hash(`ts:${recordId}`, 4), 16) % 1000);
  return `${Math.floor(ms / 1000)}.${String(micro).padStart(6, "0")}`;
}
