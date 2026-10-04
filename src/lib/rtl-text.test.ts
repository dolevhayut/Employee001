import { describe, expect, it } from "vitest";

import {
  restoreHebrewLogicalOrder,
  textFromPositionedPdfItems,
  type PositionedTextItem,
} from "./rtl-text";

describe("restoreHebrewLogicalOrder", () => {
  it("turns a visually ordered Hebrew line into logical order", () => {
    expect(restoreHebrewLogicalOrder("עולם שלום", true)).toBe("שלום עולם");
  });

  it("keeps English runs intact while reversing the Hebrew run", () => {
    expect(restoreHebrewLogicalOrder("Hebrew line — עולם שלום", true)).toBe(
      "שלום עולם — Hebrew line"
    );
  });

  it.each([
    ["10:30-ב", "ב-10:30"],
    [",מוכן", "מוכן,"],
    ['ל"צה', 'צה"ל'],
  ])("restores mixed visual token %s", (visual, logical) => {
    expect(restoreHebrewLogicalOrder(visual, true)).toBe(logical);
  });

  it("leaves an English-only line unchanged", () => {
    expect(restoreHebrewLogicalOrder("Ready at 10:30")).toBe("Ready at 10:30");
  });
});

describe("textFromPositionedPdfItems", () => {
  it("groups items by baseline, ignores empty items, and orders lines top-to-bottom", () => {
    const items: PositionedTextItem[] = [
      { str: "", x: 0, y: 100, height: 12, dir: "rtl" },
      { str: "עולם", x: 0, y: 100, height: 12, dir: "rtl" },
      { str: " שלום", x: 30, y: 100, height: 12, dir: "rtl" },
      { str: "Second line", x: 0, y: 75, height: 12, dir: "ltr" },
    ];

    expect(textFromPositionedPdfItems(items)).toBe("שלום עולם\nSecond line");
  });
});
