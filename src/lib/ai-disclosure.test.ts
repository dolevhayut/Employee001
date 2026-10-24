import { describe, expect, it } from "vitest";
import { discloseOutbound, isOutboundMessageTool, withAiDisclosure, withOutboundDisclosure } from "./ai-disclosure";

describe("AI disclosure on outbound messages", () => {
  it("prefixes text once", () => {
    const once = withAiDisclosure("On it.", "Noa Friedman");
    expect(once).toBe("🤖 AI twin of Noa Friedman: On it.");
    expect(withAiDisclosure(once, "Noa Friedman")).toBe(once);
  });

  it("recognises Slack and email sends, not reads", () => {
    for (const t of ["mcp__composio__SLACK_SEND_MESSAGE", "SLACK_CHAT_POST_MESSAGE", "GMAIL_SEND_EMAIL", "GMAIL_REPLY_TO_THREAD", "OUTLOOK_SEND_EMAIL", "GMAIL_CREATE_EMAIL_DRAFT"]) {
      expect(isOutboundMessageTool(t), t).toBe(true);
    }
    for (const t of ["SLACK_LIST_CHANNELS", "GMAIL_FETCH_EMAILS", "Read", "GITHUB_CREATE_AN_ISSUE"]) {
      expect(isOutboundMessageTool(t), t).toBe(false);
    }
  });

  it("discloses Slack text and email bodies, plain and HTML", () => {
    expect(discloseOutbound("SLACK_SEND_MESSAGE", { channel: "C1", text: "hi" }, "Noa").text).toBe("🤖 AI twin of Noa: hi");
    const mail = discloseOutbound("GMAIL_SEND_EMAIL", { to: "a@b.co", body: "Hello", html_body: "<p>Hello</p>" }, "Noa");
    expect(mail.body).toBe("🤖 AI twin of Noa: Hello");
    expect(mail.html_body).toBe("<p><strong>🤖 AI twin of Noa</strong></p><p>Hello</p>");
    expect(mail.to).toBe("a@b.co");
  });

  it("recognises every chat and email send, and never a read", () => {
    for (const t of ["MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE", "MICROSOFT_TEAMS_CHATS_POST_MESSAGE", "OUTLOOK_REPLY_EMAIL", "OUTLOOK_CREATE_DRAFT_REPLY", "GMAIL_FORWARD_MESSAGE", "GMAIL_CREATE_EMAIL_DRAFT", "SLACK_UPDATE_A_MESSAGE", "SLACK_SCHEDULE_MESSAGE", "DISCORD_SEND_MESSAGE"]) {
      expect(isOutboundMessageTool(t), t).toBe(true);
    }
    for (const t of ["GMAIL_LIST_DRAFTS", "GMAIL_DELETE_DRAFT", "SLACK_GET_SCHEDULED_MESSAGES", "OUTLOOK_QUERY_EMAILS", "MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS", "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION", "SLACK_SEARCH_MESSAGES"]) {
      expect(isOutboundMessageTool(t), t).toBe(false);
    }
  });

  it("discloses an Outlook reply's comment and a Teams post's content, as HTML when marked HTML", () => {
    expect(discloseOutbound("OUTLOOK_REPLY_EMAIL", { message_id: "m1", comment: "Thanks" }, "Noa").comment).toBe("🤖 AI twin of Noa: Thanks");
    expect(discloseOutbound("OUTLOOK_REPLY_EMAIL", { comment: "<p>Thanks</p>", is_html: true }, "Noa").comment).toBe("<p><strong>🤖 AI twin of Noa</strong></p><p>Thanks</p>");
    const teams = discloseOutbound("MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE", { team_id: "t", channel_id: "c", content: "<b>Done</b>", content_type: "html" }, "Noa");
    expect(teams.content).toBe("<p><strong>🤖 AI twin of Noa</strong></p><b>Done</b>");
    expect(discloseOutbound("MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE", { team_id: "t", channel_id: "c" }, "Noa").content).toBe("🤖 AI twin of Noa: ");
  });

  it("adds a text field when a send carries no recognisable body", () => {
    expect(discloseOutbound("SLACK_SEND_MESSAGE", { channel: "C1", blocks: [] }, "Noa").text).toBe("🤖 AI twin of Noa: ");
  });

  it("re-applies the disclosure to input an approver edited", async () => {
    const gate = withOutboundDisclosure(async () => ({ behavior: "allow", updatedInput: { channel: "C1", text: "edited, no label" } }), "Noa");
    const result = await gate("mcp__composio__SLACK_SEND_MESSAGE", { channel: "C1", text: "x" }, { signal: new AbortController().signal, toolUseID: "t" } as never);
    expect(result?.behavior === "allow" && result.updatedInput?.text).toBe("🤖 AI twin of Noa: edited, no label");
  });

  it("leaves denials and other tools alone", async () => {
    const deny = withOutboundDisclosure(async () => ({ behavior: "deny", message: "no" }), "Noa");
    expect((await deny("SLACK_SEND_MESSAGE", { text: "x" }, {} as never))?.behavior).toBe("deny");
    const read = withOutboundDisclosure(async (_n, input) => ({ behavior: "allow", updatedInput: input }), "Noa");
    const r = await read("Read", { file_path: "a" }, {} as never);
    expect(r?.behavior === "allow" && r.updatedInput).toEqual({ file_path: "a" });
  });
});
