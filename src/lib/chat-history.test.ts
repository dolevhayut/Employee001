import { describe, expect, it } from "vitest";
import { latestAskConversation, visibleTo, type StoredMessage } from "./chat-history";

const m = (over: Partial<StoredMessage>): StoredMessage => ({ role: "user", id: "x", text: "t", ts: 0, ...over });

describe("chat history visibility", () => {
  const rows = [
    m({ text: "legacy, before askedBy" }),
    m({ text: "dana's", askedBy: "u-dana" }),
    m({ text: "omer's", askedBy: "u-omer" }),
  ];

  it("shows each person only what they asked; owners and admins also see legacy rows", () => {
    expect(visibleTo({ id: "u-dana", role: "member" }, rows).map((r) => r.text)).toEqual(["dana's"]);
    expect(visibleTo({ id: "u-boss", role: "owner" }, rows).map((r) => r.text)).toEqual(["legacy, before askedBy"]);
    expect(visibleTo({ id: "u-dana", role: "admin" }, rows).map((r) => r.text)).toEqual(["legacy, before askedBy", "dana's"]);
  });

  it("returns the viewer's latest Ask conversation only", () => {
    const ask = [
      m({ text: "old q", askedBy: "u1", surface: "ask", conversationId: "c1" }),
      m({ text: "flow msg", askedBy: "u1" }),
      m({ text: "new q", askedBy: "u1", surface: "ask", conversationId: "c2" }),
      m({ role: "twin", text: "new a", askedBy: "u1", surface: "ask", conversationId: "c2" }),
      m({ text: "someone else", askedBy: "u2", surface: "ask", conversationId: "c3" }),
    ];
    expect(latestAskConversation({ id: "u1", role: "member" }, ask).map((r) => r.text)).toEqual(["new q", "new a"]);
    expect(latestAskConversation({ id: "u9", role: "member" }, ask)).toEqual([]);
  });
});

describe("clearing chat-page history", () => {
  it("removes only the caller's chat-page rows, never Ask rows or a colleague's", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-chat-"));
    process.env.EMPLOYEE001_HOME = home;
    try {
      const { appendChatMessage, loadChatHistory, rewriteChatHistory, canSee } = await import("./chat-history");
      appendChatMessage("noa", m({ text: "my flow", askedBy: "u1" }));
      appendChatMessage("noa", m({ text: "my ask", askedBy: "u1", surface: "ask", conversationId: "c" }));
      appendChatMessage("noa", m({ text: "their flow", askedBy: "u2" }));
      const me = { id: "u1", role: "member" };
      rewriteChatHistory("noa", (row) => row.surface === "ask" || !canSee(me, row));
      expect(loadChatHistory("noa").map((r) => r.text)).toEqual(["my ask", "their flow"]);
    } finally {
      delete process.env.EMPLOYEE001_HOME;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
