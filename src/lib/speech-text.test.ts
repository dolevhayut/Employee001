import { describe, expect, it } from "vitest";
import { ECHO_TAIL_MS, heardSpeech, looksLikeEcho, speakable, takeSentences, twinWordsInTheRoom } from "./speech-text";

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

  it("holds an unbroken run (a URL) until final", () => {
    const url = "https://example.com/" + "a".repeat(400);
    expect(takeSentences(url)).toEqual({ sentences: [], rest: url });
    expect(takeSentences(url, true).sentences).toEqual([url]);
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

describe("looksLikeEcho thresholds", () => {
  const spoken = "Dana owns the Q3 launch. The budget is forty thousand.";
  it("pins the 60% run", () => {
    expect(looksLikeEcho("the budget is something else", spoken)).toBe(true); // 3 of 5
    expect(looksLikeEcho("so the budget is not what i thought", spoken)).toBe(false); // 3 of 8
  });
  it("treats one overlapping word as echo (it never interrupts)", () => {
    expect(looksLikeEcho("budget", spoken)).toBe(true);
  });
  it("catches a Hebrew echo", () => {
    expect(looksLikeEcho("אחראית על ההשקה", "דנה אחראית על ההשקה")).toBe(true);
  });
});

describe("twinWordsInTheRoom", () => {
  const last = { text: "the budget is forty thousand", endedAt: 10_000 };
  it("prefers what the live speaker has said", () => {
    expect(twinWordsInTheRoom("live words", last, false, 99_999)).toBe("live words");
  });
  it("keeps the last answer while it plays and briefly after", () => {
    expect(twinWordsInTheRoom(null, { text: "x", endedAt: null }, true, 0)).toBe("x");
    expect(twinWordsInTheRoom(null, last, false, 10_000 + ECHO_TAIL_MS - 1)).toBe(last.text);
    expect(twinWordsInTheRoom(null, last, false, 10_000 + ECHO_TAIL_MS)).toBe("");
    expect(twinWordsInTheRoom(null, { text: "x", endedAt: null }, false, 0)).toBe("");
  });
});
