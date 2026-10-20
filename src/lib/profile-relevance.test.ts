import { describe, expect, it } from "vitest";
import { pickRelevantProfileFiles } from "./profile-relevance";

const FILES: Record<string, string> = {
  "EXPERTISE.md": "Backend architecture, Postgres tuning, incident response.",
  "TONE.md": "Direct, short sentences. Signs off with thanks.",
  "CONTEXT.md": "Leads the platform team at Northstar.",
  "DECISIONS.md": "Chose Postgres over Mongo in 2025 for consistency.",
  "PREFERENCES.md": "Prefers async updates over meetings.",
  "PEOPLE.md": "Works closely with Noa (product) and Riley (support).",
  "PROJECTS.md": "Beacon migration, due December. Atlas billing revamp.",
  "BOUNDARIES.md": "Never discusses compensation or legal matters.",
  "EMPLOYMENT.md": "Senior engineer since 2022.",
};
const read = (f: string) => {
  if (!(f in FILES)) throw new Error("missing");
  return FILES[f];
};
const pick = (q: string) => pickRelevantProfileFiles("/x", q, 3, read);

describe("pickRelevantProfileFiles", () => {
  it("recalls nothing for small talk", () => {
    expect(pick("good morning!")).toEqual([]);
    expect(pick("thanks, have a nice day")).toEqual([]);
  });

  it("recalls the file that holds a rare term", () => {
    expect(pick("When is the Beacon migration due?")[0]).toBe("PROJECTS.md");
    expect(pick("Why Postgres and not Mongo?")).toContain("DECISIONS.md");
  });

  it("uses question hints when the file text doesn't repeat the words", () => {
    expect(pick("Who should I talk to about this?")).toContain("PEOPLE.md");
    expect(pick("מי אחראי על זה?")).toContain("PEOPLE.md");
  });

  it("caps the result and skips missing files", () => {
    const some = pickRelevantProfileFiles("/x", "Beacon Postgres Noa compensation async", 2, (f) =>
      f === "TONE.md" ? (() => { throw new Error("missing"); })() : read(f),
    );
    expect(some.length).toBeLessThanOrEqual(2);
    expect(some).not.toContain("TONE.md");
  });
});
