import { describe, expect, it } from "vitest";

import { messages } from "./messages";

describe("message catalogs", () => {
  const enKeys = Object.keys(messages.en).sort();
  const heKeys = Object.keys(messages.he).sort();

  it("has every English key in Hebrew", () => {
    expect(enKeys.filter((key) => !(key in messages.he))).toEqual([]);
  });

  it("has every Hebrew key in English", () => {
    expect(heKeys.filter((key) => !(key in messages.en))).toEqual([]);
  });

  it("has no empty strings", () => {
    for (const locale of ["en", "he"] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value, `${locale}.${key}`).not.toBe("");
      }
    }
  });
});
