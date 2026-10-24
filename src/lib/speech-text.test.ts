import { describe, expect, it } from "vitest";
import { heardSpeech, looksLikeEcho, speakable, takeSentences } from "./speech-text";

describe("takeSentences", () => {
  it("splits finished sentences off and keeps the unfinished tail", () => {
    const r = takeSentences("Dana owns the Q3 launch [[profile]]. The budget is 40k [[brain]]. It ships in");
    expect(r.sentences).toEqual(["Dana owns the Q3 launch [[profile]].", "The budget is 40k [[brain]]."]);
    expect(r.rest).toBe("It ships in");
  });

  it("waits for the whitespace after the period, so 3.5 and v4.1 stay whole", () => {
    expect(takeSentences("Revenue grew by 3.5").sentences).toEqual([]);
    expect(takeSentences("Revenue grew by 3.5 percent this quarter. Next").sentences).toEqual(["Revenue grew by 3.5 percent this quarter."]);
  });

  it("handles Hebrew and question marks", () => {
    const r = takeSentences("דנה אחראית על ההשקה של הרבעון. מה עוד תרצה לדעת? ");
    expect(r.sentences).toEqual(["דנה אחראית על ההשקה של הרבעון.", "מה עוד תרצה לדעת?"]);
    expect(r.rest).toBe("");
  });

  it("folds very short pieces into the next sentence", () => {
    const r = takeSentences("Yes. Dana owns it and ships Friday. ");
    expect(r.sentences).toEqual(["Yes. Dana owns it and ships Friday."]);
  });

  it("flushes the tail when final", () => {
    expect(takeSentences("It ships Friday", true)).toEqual({ sentences: ["It ships Friday"], rest: "" });
    expect(takeSentences("  ", true)).toEqual({ sentences: [], rest: "" });
  });

  it("cuts a long run without punctuation at a comma", () => {
    const long = "We looked at the numbers for the north region, ".repeat(5);
    const r = takeSentences(long);
    expect(r.sentences.length).toBeGreaterThan(0);
    for (const s of r.sentences) expect(s.length).toBeLessThanOrEqual(180);
    expect(r.sentences.join(" ") + " " + r.rest).toContain("north region");
  });

  it("adds up to the whole text across stream chunks", () => {
    const text = "First one is here. Second one comes now! Third? Fourth and last.";
    let buf = "";
    const out: string[] = [];
    for (const ch of text.match(/[\s\S]{1,5}/g) ?? []) {
      buf += ch;
      const r = takeSentences(buf);
      out.push(...r.sentences);
      buf = r.rest;
    }
    out.push(...takeSentences(buf, true).sentences);
    expect(out.join(" ")).toBe(text);
  });
});

describe("speakable", () => {
  it("drops cites and markdown", () => {
    expect(speakable("**Dana** owns [the launch](http://x) [[profile,brain]].")).toBe("Dana owns the launch.");
    expect(speakable("- item one [[companysim]]")).toBe("item one");
    expect(speakable("Half a marker [[prof")).toBe("Half a marker");
  });
});

describe("heardSpeech", () => {
  it("ignores tagged sounds and empty partials", () => {
    expect(heardSpeech("")).toBe(false);
    expect(heardSpeech("(background noise)")).toBe(false);
    expect(heardSpeech("[music]")).toBe(false);
    expect(heardSpeech("wait")).toBe(true);
    expect(heardSpeech("רגע")).toBe(true);
  });
});

describe("looksLikeEcho", () => {
  const spoken = "Dana owns the Q3 launch. The budget is forty thousand.";
  it("recognises the twin's own words coming back", () => {
    expect(looksLikeEcho("the budget is forty", spoken)).toBe(true);
    expect(looksLikeEcho("Dana owns the", spoken)).toBe(true);
  });
  it("lets the person interrupt", () => {
    expect(looksLikeEcho("stop", spoken)).toBe(false);
    expect(looksLikeEcho("wait who approved that", spoken)).toBe(false);
    expect(looksLikeEcho("רגע, מי אישר את זה", "דנה אחראית על ההשקה")).toBe(false);
    expect(looksLikeEcho("what is the budget", spoken)).toBe(false);
  });
  it("still catches an echo with a number transcribed differently", () => {
    expect(looksLikeEcho("the budget is 40,000", spoken)).toBe(true);
  });
  it("treats nothing spoken yet as no echo", () => {
    expect(looksLikeEcho("hello", "")).toBe(false);
  });
});
