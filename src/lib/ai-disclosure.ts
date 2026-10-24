// EU AI Act Art. 50: a person talking to an AI system must be told so. Every
// message a twin sends to people outside the app (chat apps, email) carries this
// disclosure. It is added at the last step before the tool runs (the
// PreToolUse hook and the final canUseTool result) and after any human edit,
// so neither the model nor an approver's edit can drop it.

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

const MARK = "🤖 AI twin of";

export function disclosureLine(employeeName: string): string {
  return `${MARK} ${employeeName.trim() || "an employee"}`;
}

/** Prefix text with the disclosure, once. */
export function withAiDisclosure(text: string, employeeName: string): string {
  const line = disclosureLine(employeeName);
  const body = text ?? "";
  if (body.trimStart().startsWith(line)) return body;
  return `${line}: ${body}`;
}

/** Same for HTML email bodies. */
function withHtmlDisclosure(html: string, employeeName: string): string {
  const line = disclosureLine(employeeName);
  if (html.includes(line)) return html;
  return `<p><strong>${escapeHtml(line)}</strong></p>${html}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// A send is the app's prefix, at most two words, then the verb as a whole
// word ("SLACK_CHAT_POST_MESSAGE", "MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE",
// "GMAIL_CREATE_EMAIL_DRAFT"). Reads never match: "GMAIL_LIST_DRAFTS",
// "SLACK_GET_SCHEDULED_MESSAGES", "GMAIL_DELETE_DRAFT".
const NOT_A_SEND = /(?:^|_)(?:LIST|GET|FETCH|SEARCH|QUERY|DELETE|REMOVE)(?:_|$)/i;
// Chat apps: Slack, Teams, Discord, Google Chat and the like.
const CHAT_SEND = /(?:^|_)(?:SLACK|MICROSOFT_TEAMS|TEAMS|DISCORD|GOOGLECHAT|GOOGLE_CHAT|WHATSAPP|TELEGRAM|MATTERMOST|ZULIP)_(?:[A-Z]+_){0,2}(?:SEND|POST|REPLY|SCHEDULE|UPDATE_(?:A_)?MESSAGE|CHAT_UPDATE)(?:_|$)/i;
const EMAIL_SEND = /(?:^|_)(?:GMAIL|OUTLOOK|EMAIL|MAIL)_(?:[A-Z]+_){0,2}(?:SEND|REPLY|FORWARD|DRAFT)(?:_|$)|(?:^|_)SEND_EMAIL(?:_|$)/i;

/** Fields a send tool may carry the message in, first = the one to add when
 *  none is present. Outlook replies use "comment", Teams posts "content". */
const CHAT_FIELDS = ["text", "markdown_text", "message", "content", "body"];
const EMAIL_TEXT_FIELDS = ["body", "message_body", "comment", "text", "content", "message"];
const EMAIL_HTML_FIELDS = ["html", "html_body", "htmlBody"];

export function isOutboundMessageTool(toolName: string): boolean {
  const bare = toolName.replace(/^mcp__[a-z0-9_]+__/i, "");
  if (NOT_A_SEND.test(bare)) return false;
  return CHAT_SEND.test(bare) || EMAIL_SEND.test(bare);
}

/** The input marks its body as HTML (Gmail/Outlook "is_html", Teams "content_type"). */
const isHtmlBody = (input: Record<string, unknown>) =>
  input.is_html === true || (typeof input.content_type === "string" && /html/i.test(input.content_type));

/**
 * Return the tool input with the disclosure applied to every message field,
 * or the input unchanged for tools that don't message people. A send with no
 * recognisable body field gets one so it still can't go out bare.
 */
export function discloseOutbound(
  toolName: string,
  input: Record<string, unknown>,
  employeeName: string,
): Record<string, unknown> {
  if (!isOutboundMessageTool(toolName)) return input;
  const bare = toolName.replace(/^mcp__[a-z0-9_]+__/i, "");
  const out: Record<string, unknown> = { ...input };
  const textFields = CHAT_SEND.test(bare) ? CHAT_FIELDS : EMAIL_TEXT_FIELDS;
  const html = isHtmlBody(input);
  let touched = false;
  for (const field of textFields) {
    if (typeof out[field] === "string") {
      out[field] = html ? withHtmlDisclosure(out[field] as string, employeeName) : withAiDisclosure(out[field] as string, employeeName);
      touched = true;
    }
  }
  for (const field of EMAIL_HTML_FIELDS) {
    if (typeof out[field] === "string") {
      out[field] = withHtmlDisclosure(out[field] as string, employeeName);
      touched = true;
    }
  }
  if (!touched) out[/(?:^|_)(?:MICROSOFT_)?TEAMS_/i.test(bare) ? "content" : textFields[0]] = withAiDisclosure("", employeeName);
  return out;
}

/** Wrap a canUseTool callback so every allowed send carries the disclosure,
 *  including input an approver edited. */
export function withOutboundDisclosure(canUseTool: CanUseTool, employeeName: string): CanUseTool {
  return async (toolName, input, options) => {
    const result = await canUseTool(toolName, input, options);
    if (!result || result.behavior !== "allow" || !isOutboundMessageTool(toolName)) return result;
    return { ...result, behavior: "allow", updatedInput: discloseOutbound(toolName, result.updatedInput ?? input, employeeName) };
  };
}
