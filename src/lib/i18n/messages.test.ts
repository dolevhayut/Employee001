import { describe, expect, it } from "vitest";

import { messages, t } from "./messages";
import { onboardingEn, onboardingHe } from "./catalog/onboarding";

describe("message catalogs", () => {
  const heKeys = Object.keys(messages.he).sort();

  // Hebrew is optional (English fallback), but the onboarding catalog holds
  // the consent flow and must stay fully translated.
  it("has every onboarding/consent key in Hebrew", () => {
    expect(Object.keys(onboardingEn).filter((key) => !(key in onboardingHe))).toEqual([]);
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

  it("falls back to English when a Hebrew string is missing", () => {
    const he = messages.he as Record<string, string | undefined>;
    const saved = he["nav.chat"];
    delete he["nav.chat"];
    try {
      expect(t("he", "nav.chat")).toBe(messages.en["nav.chat"]);
    } finally {
      if (saved !== undefined) he["nav.chat"] = saved;
    }
  });
});
