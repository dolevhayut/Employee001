import { describe, expect, it } from "vitest";

import { DIFF_TOO_LARGE_TEXT, diffLines, isCollapsedUnchanged } from "./text-diff";

const kinds = (lines: ReturnType<typeof diffLines>) => lines.map((l) => `${l.type}:${l.text}`);

describe("diffLines", () => {
  it("collapses identical text to one unchanged marker", () => {
    const out = diffLines("alpha\nbeta\n", "alpha\nbeta\n");
    expect(out).toHaveLength(1);
    expect(isCollapsedUnchanged(out[0].text)).toBe(true);
  });

  it("marks pure additions and deletions", () => {
    expect(kinds(diffLines("alpha", "alpha\nbeta"))).toEqual(["same:alpha", "add:beta"]);
    expect(kinds(diffLines("alpha\nbeta", "alpha"))).toEqual(["same:alpha", "del:beta"]);
  });

  it("shows a change in the middle as del + add with context", () => {
    expect(kinds(diffLines("one\ntwo\nthree\nfour\nfive", "one\ntwo\nTHREE\nfour\nfive"))).toEqual([
      "same:one",
      "same:two",
      "del:three",
      "add:THREE",
      "same:four",
      "same:five",
    ]);
  });

  it("keeps three lines of context and collapses the rest", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "LINE 10");
    const out = diffLines(before, after);
    expect(out.filter((l) => l.type !== "same").map((l) => l.text)).toEqual(["line 10", "LINE 10"]);
    expect(out.filter((l) => isCollapsedUnchanged(l.text))).toHaveLength(2);
    expect(out.filter((l) => l.type === "same" && !isCollapsedUnchanged(l.text))).toHaveLength(6);
  });

  it("diffs Hebrew lines like any other text", () => {
    expect(kinds(diffLines("שלום\nעולם", "שלום\nעולם חדש"))).toEqual([
      "same:שלום",
      "del:עולם",
      "add:עולם חדש",
    ]);
  });

  it("treats CRLF and LF the same and ignores a trailing newline", () => {
    expect(kinds(diffLines("a\r\nb\r\n", "a\nb"))).toHaveLength(1);
  });

  it("refuses inputs over the size guard", () => {
    const huge = Array.from({ length: 5001 }, (_, i) => String(i)).join("\n");
    expect(diffLines(huge, "x")).toEqual([{ type: "same", text: DIFF_TOO_LARGE_TEXT }]);
  });
});
