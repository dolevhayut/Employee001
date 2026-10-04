import { describe, expect, it } from "vitest";
import { mappedTwinForMessage, mentionUserIds, normalizeSlackMessage, shouldIgnoreSlackMessage, isActionRequest, isWithinSlackReplyRate, slackReplyNeedsApproval } from "./slack-intake";

describe("Slack intake", () => {
  const message = normalizeSlackMessage({ channel: "C1", ts: "123.4", text: "hi <@U999>", user: "U111", team: "T1" })!;
  it("parses explicit Slack mentions and maps only the connected user id", () => {
    expect(mentionUserIds("<@U1> hi <@U2|Dana>")).toEqual(["U1", "U2"]);
    expect(mappedTwinForMessage(message, [{ employeeId: "dana", slackUserId: "U999", workspaceId: "T1" }])).toBe("dana");
    expect(mappedTwinForMessage(message, [{ employeeId: "dana", slackUserId: "U_OTHER", workspaceId: "T1" }])).toBeNull();
  });
  it("ignores bots and the twin itself", () => {
    expect(shouldIgnoreSlackMessage({ ...message, isBot: true }, "U999")).toBe(true);
    expect(shouldIgnoreSlackMessage({ ...message, userId: "U999" }, "U999")).toBe(true);
  });
  it("identifies action requests that cannot auto-post", () => {
    expect(isActionRequest("Please deploy this now")).toBe(true);
    expect(isActionRequest("מה הסטטוס של הפרויקט?")).toBe(false);
  });
  it("uses approval by default and never auto-posts external or action requests", () => {
    expect(slackReplyNeedsApproval({ autoReplyEnabled: false, text: "What is the status?" })).toBe(true);
    expect(slackReplyNeedsApproval({ autoReplyEnabled: true, text: "What is the status?" })).toBe(false);
    expect(slackReplyNeedsApproval({ autoReplyEnabled: true, externalWorkspace: true, text: "What is the status?" })).toBe(true);
    expect(slackReplyNeedsApproval({ autoReplyEnabled: true, text: "Please deploy now" })).toBe(true);
  });
  it("limits replies to ten per channel per rolling hour", () => {
    const now = 1_000_000;
    expect(isWithinSlackReplyRate(Array.from({ length: 9 }, () => now - 100), now)).toBe(true);
    expect(isWithinSlackReplyRate(Array.from({ length: 10 }, () => now - 100), now)).toBe(false);
  });
});
