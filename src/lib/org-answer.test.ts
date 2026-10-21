import { describe, expect, it } from "vitest";
import { parseCitedAnswer } from "./org-answer";

const known = new Set(["daniel", "noa"]);

describe("parseCitedAnswer", () => {
  it("attaches the ids that follow a claim", () => {
    expect(parseCitedAnswer("Two renewals are at risk [[daniel]]. The fix ships Friday [[noa, daniel]].", known)).toEqual([
      { text: "Two renewals are at risk.", cite: ["daniel"] },
      { text: " The fix ships Friday.", cite: ["noa", "daniel"] },
    ]);
  });

  it("drops unknown ids and keeps plain text", () => {
    expect(parseCitedAnswer("Hello [[ghost]] world", known)).toEqual([{ text: "Hello" }, { text: " world" }]);
  });

  it("merges back-to-back markers into the previous claim", () => {
    expect(parseCitedAnswer("Churn is up [[daniel]][[noa]].", known)[0]).toEqual({ text: "Churn is up.", cite: ["daniel", "noa"] });
  });

  it("hides a marker that is still streaming", () => {
    expect(parseCitedAnswer("Churn is up [[dan", known)).toEqual([{ text: "Churn is up" }]);
  });
});
