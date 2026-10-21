// When may a twin answer a Slack message with no human in the loop?
//
// Approval is the default. A reply goes out unattended only when all hold:
//   - the employee's twin has auto-reply on (answerSlackWithoutAsking),
//   - the message is from the org's own workspace,
//   - the sender is on the admin's allowlist of known org members,
//   - it's a DM, or the channel is on the admin's channel allowlist (everyone
//     in an allowlisted channel is entitled to the twin's public profile),
//   - it isn't asking the twin to act.
// An auto-reply is drafted with RunOptions.publicReply: no tools, no memory,
// only the non-confidential profile files. Anything else waits for approval.

import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";
import { isActionRequest } from "./slack-intake";

export type SlackAutoReplyMember = { slackUserId: string; label?: string; employeeId?: string };

export type SlackAutoReplyConfig = {
  members: SlackAutoReplyMember[];
  channels: string[];
  updatedAt?: string;
  updatedBy?: string;
};

export type SlackAutoReplyDecision =
  | { mode: "auto"; reason: string; requester: SlackAutoReplyMember }
  | { mode: "approval"; reason: string; requester?: SlackAutoReplyMember };

const CONFIG_FILE = () => dataDir("org", "slack-autoreply.json");
const SLACK_ID = /^[A-Z0-9]{2,20}$/;

export function emptySlackAutoReplyConfig(): SlackAutoReplyConfig {
  return { members: [], channels: [] };
}

/** Keep only well-formed Slack ids; drop duplicates. */
export function normalizeSlackAutoReplyConfig(raw: unknown): SlackAutoReplyConfig {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const members: SlackAutoReplyMember[] = [];
  for (const m of Array.isArray(value.members) ? value.members : []) {
    const row = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const id = typeof row.slackUserId === "string" ? row.slackUserId.trim().toUpperCase() : "";
    if (!SLACK_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    members.push({
      slackUserId: id,
      ...(typeof row.label === "string" && row.label.trim() ? { label: row.label.trim().slice(0, 80) } : {}),
      ...(typeof row.employeeId === "string" && row.employeeId ? { employeeId: row.employeeId } : {}),
    });
  }
  const channels = [...new Set(
    (Array.isArray(value.channels) ? value.channels : [])
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => SLACK_ID.test(c)),
  )];
  return {
    members,
    channels,
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.updatedBy === "string" ? { updatedBy: value.updatedBy } : {}),
  };
}

export function loadSlackAutoReplyConfig(): SlackAutoReplyConfig {
  try {
    return normalizeSlackAutoReplyConfig(JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8")));
  } catch {
    return emptySlackAutoReplyConfig();
  }
}

/** Admin-only (enforced by the route). Returns what was stored. */
export function saveSlackAutoReplyConfig(raw: unknown, updatedBy: string): SlackAutoReplyConfig {
  const config = { ...normalizeSlackAutoReplyConfig(raw), updatedAt: new Date().toISOString(), updatedBy };
  const file = CONFIG_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return config;
}

export function slackAutoReplyDecision(input: {
  twinAutoReplyEnabled: boolean;
  config: SlackAutoReplyConfig;
  message: { userId: string; channel: string; isDm: boolean; text: string; externalWorkspace?: boolean };
}): SlackAutoReplyDecision {
  const { twinAutoReplyEnabled, config, message } = input;
  const requester = config.members.find((m) => m.slackUserId === message.userId.toUpperCase());
  if (!twinAutoReplyEnabled) return { mode: "approval", reason: "Auto-reply is off for this twin.", requester };
  if (message.externalWorkspace) return { mode: "approval", reason: "Message from an external workspace.", requester };
  if (!requester) return { mode: "approval", reason: "Sender isn't on the admin's auto-reply allowlist.", requester };
  if (!message.isDm && !config.channels.includes(message.channel.toUpperCase())) {
    return { mode: "approval", reason: "Channel isn't on the admin's auto-reply allowlist.", requester };
  }
  if (isActionRequest(message.text)) return { mode: "approval", reason: "The message asks the twin to act.", requester };
  return { mode: "auto", reason: "Allowlisted sender and channel; answer from the public profile only.", requester };
}
