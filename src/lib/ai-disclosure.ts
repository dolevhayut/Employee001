// EU AI Act Art. 50: a person talking to an AI system must be told so. Every
// message a twin sends to people outside the app (Slack, email) carries this
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

const SLACK_SEND = /(?:^|_)SLACK_(?:SEND|POST|REPLY|SCHEDULE|UPDATE_MESSAGE|CHAT_POST|CHAT_UPDATE)/i;
const EMAIL_SEND = /(?:GMAIL|OUTLOOK|EMAIL|MAIL).*(?:SEND|REPLY|DRAFT|FORWARD)|SEND_EMAIL/i;

/** Message fields a send tool may carry the body in. */
const SLACK_FIELDS = ["text", "markdown_text", "message"];
const EMAIL_TEXT_FIELDS = ["body", "message_body", "text", "content", "message"];
const EMAIL_HTML_FIELDS = ["html", "html_body", "htmlBody"];

export function isOutboundMessageTool(toolName: string): boolean {
  const bare = toolName.replace(/^mcp__[a-z0-9_]+__/i, "");
  return SLACK_SEND.test(bare) || EMAIL_SEND.test(bare);
}

/**
 * Return the tool input with the disclosure applied to every message field,
 * or the input unchanged for tools that don't message people. A send with no
 * recognisable body field gets a `text` field so it still can't go out bare.
 */
export function discloseOutbound(
  toolName: string,
  input: Record<string, unknown>,
  employeeName: string,
): Record<string, unknown> {
  if (!isOutboundMessageTool(toolName)) return input;
  const bare = toolName.replace(/^mcp__[a-z0-9_]+__/i, "");
  const out: Record<string, unknown> = { ...input };
  const textFields = SLACK_SEND.test(bare) ? SLACK_FIELDS : EMAIL_TEXT_FIELDS;
  let touched = false;
  for (const field of textFields) {
    if (typeof out[field] === "string") {
      out[field] = withAiDisclosure(out[field] as string, employeeName);
      touched = true;
    }
  }
  for (const field of EMAIL_HTML_FIELDS) {
    if (typeof out[field] === "string") {
      out[field] = withHtmlDisclosure(out[field] as string, employeeName);
      touched = true;
    }
  }
  if (!touched) out[textFields[0]] = withAiDisclosure("", employeeName);
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
