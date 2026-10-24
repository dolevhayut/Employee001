import { describe, expect, it } from "vitest";
import { ACK_PHRASES, ackPhrase, voiceLane } from "./voice-lane";

describe("voiceLane", () => {
  it("answers knowledge questions on the fast lane", () => {
    for (const q of [
      "Who decided to go enterprise first?",
      "What is the company focus right now?",
      "מי החליט ללכת קודם על אנטרפרייז?",
      "על מה אתה עובד השבוע?",
      "What did we decide about pricing?",
    ]) expect(voiceLane(q), q).toEqual({ fast: true });
  });

  it("keeps the tools when a connected system is named", () => {
    expect(voiceLane("What's new in Slack today?")).toEqual({ fast: false, system: "Slack" });
    expect(voiceLane("מה חדש בסלאק?")).toEqual({ fast: false, system: "Slack" });
    expect(voiceLane("Any open tickets for the onboarding flow?")).toMatchObject({ fast: false });
    expect(voiceLane("Do I have unread emails?")).toMatchObject({ fast: false, system: "email" });
    expect(voiceLane("מה יש לי ביומן מחר?")).toMatchObject({ fast: false, system: "the calendar" });
  });

  it("keeps the tools for actions", () => {
    expect(voiceLane("Send Dana the Q3 numbers")).toMatchObject({ fast: false });
    expect(voiceLane("תשלח לדנה את המספרים")).toMatchObject({ fast: false });
    expect(voiceLane("Schedule a review with Yotam")).toMatchObject({ fast: false });
  });
});

describe("ackPhrase", () => {
  it("matches the question's language and lane", () => {
    expect(ackPhrase("Who owns it?", { fast: true })).toBe("Let me check.");
    expect(ackPhrase("מי אחראי?", { fast: true })).toBe("רק רגע.");
    expect(ackPhrase("Check Slack", { fast: false, system: "Slack" })).toMatch(/look that up/);
  });
  it("has every phrase ready to synthesize ahead of time", () => {
    expect(new Set(ACK_PHRASES).size).toBe(4);
  });
});
