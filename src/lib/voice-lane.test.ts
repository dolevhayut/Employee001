import { describe, expect, it } from "vitest";
import { ACK_PHRASES, VOICE_ANSWER_STYLE, ackPhrase, spokenWords, voiceLane, voiceLaneInContext } from "./voice-lane";

/** The question exactly as the Ask page sends it. */
const asSent = (q: string) => `${q}\n\n(${VOICE_ANSWER_STYLE} Reply in ${/[֐-׿]/.test(q) ? "Hebrew" : "English"}.)`;

describe("voiceLane", () => {
  it.each([
    "Who decided to go enterprise first?",
    "What is the company focus right now?",
    "מי החליט ללכת קודם על אנטרפרייז?",
    "על מה אתה עובד השבוע?",
    "What did we decide about pricing?",
    "מי קבע את המחיר?",
    "יש צורך בזה?",
    "מה הגירה של הלקוחות?",
    "Tell me about the onboarding project",
    "תגיד לי מי אחראי על ההשקה",
    "Who created the pricing deck?",
  ])("answers %s on the fast lane", (q) => {
    expect(voiceLane(q)).toEqual({ fast: true });
  });

  it("classifies the person's words, not the page's style note (which says 'Reply')", () => {
    for (const q of ["Who decided to go enterprise first?", "מי החליט ללכת קודם על אנטרפרייז?"]) {
      expect(spokenWords(asSent(q))).toBe(q);
      expect(voiceLane(asSent(q))).toEqual({ fast: true });
    }
    expect(voiceLane(asSent("What's new in Slack?"))).toMatchObject({ fast: false, system: "Slack" });
  });

  it.each([
    ["What's new in Slack today?", "Slack"],
    ["מה חדש בסלאק?", "Slack"],
    ["Do I have unread emails?", "email"],
    ["מה יש לי ביומן מחר?", "the calendar"],
    ["What's my next meeting?", "the calendar"],
    ["Do I have a meeting on Thursday?", "the calendar"],
    ["יש לי פגישה מחר?", "the calendar"],
    ["Any open tickets for onboarding?", "your systems"],
    ["What's on the Jira board?", "Jira"],
    ["מה בג'ירה?", "Jira"],
    ["Anything new on WhatsApp?", "WhatsApp"],
  ])("keeps the tools when %s names a system", (q, system) => {
    expect(voiceLane(q)).toEqual({ fast: false, system });
  });

  it.each([
    "Send Dana the Q3 numbers",
    "Can you remind Dana about the review?",
    "Tell Dana the numbers are ready",
    "Reschedule my review with Yotam",
    "Cancel tomorrow's review",
    "Add a task for Dana",
    "Create a summary doc for the board",
    "תשלח לדנה את המספרים",
    "אתה יכול לשלוח לדנה את המספרים?",
    "תוכל לקבוע סקירה עם יותם?",
    "ותשלח לדנה",
    "אפשר לעדכן את הסטטוס?",
    "תבטל את הסקירה של מחר",
  ])("keeps the tools for the action %s", (q) => {
    expect(voiceLane(q)).toMatchObject({ fast: false });
  });

  it("counts the org's own MCP servers as systems", () => {
    expect(voiceLane("What's the stock level in Priority?", ["Priority"])).toEqual({ fast: false, system: "Priority" });
    expect(voiceLane("What's our priority this quarter?", [])).toEqual({ fast: true });
  });

  it("keeps a follow-up in the lane of the question before it", () => {
    expect(voiceLaneInContext("and which ones are still open?", "What's on the Jira board?")).toMatchObject({ fast: false });
    expect(voiceLaneInContext("and who owns it?", "What is the company focus?")).toEqual({ fast: true });
    expect(voiceLaneInContext("and who owns it?", undefined)).toEqual({ fast: true });
  });
});

describe("ackPhrase", () => {
  it("matches the question's language and lane", () => {
    expect(ackPhrase("Who owns it?", { fast: true })).toBe("Let me check.");
    expect(ackPhrase("מי אחראי?", { fast: true })).toBe("רק רגע.");
    expect(ackPhrase("Check Slack", { fast: false, system: "Slack" })).toMatch(/look that up/);
  });
  it.each(["Who owns it?", "מי אחראי?", "Check my Slack", "מה חדש בסלאק?"])("has the ack for %s synthesized ahead", (q) => {
    expect(ACK_PHRASES).toContain(ackPhrase(q, voiceLane(q)));
  });
});
