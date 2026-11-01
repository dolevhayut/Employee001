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

describe("plural strings", () => {
  // Writes a temporary English string for a key, so the parser can be tested
  // on shapes the catalogs don't use yet.
  function withEnglish(key: "nav.chat", text: string, run: () => void) {
    const en = messages.en as Record<string, string>;
    const saved = en[key];
    en[key] = text;
    try {
      run();
    } finally {
      en[key] = saved;
    }
  }

  it("picks singular or plural in English", () => {
    expect(t("en", "ask.trace.steps", { count: 0 })).toBe("0 steps");
    expect(t("en", "ask.trace.steps", { count: 1 })).toBe("1 step");
    expect(t("en", "ask.trace.steps", { count: 2 })).toBe("2 steps");
    expect(t("en", "handover.answersSaved", { count: 1 })).toBe("1 answer saved");
    expect(t("en", "handover.answers", { count: 3 })).toBe("3 answers");
    expect(t("en", "handover.items", { count: 1 })).toBe("1 item");
  });

  it("picks singular or plural in Hebrew, where 2 (`two`) uses the plural", () => {
    expect(t("he", "ask.trace.steps", { count: 1 })).toBe("צעד אחד");
    expect(t("he", "ask.trace.steps", { count: 2 })).toBe("2 צעדים");
    expect(t("he", "ask.trace.steps", { count: 5 })).toBe("5 צעדים");
    expect(t("he", "ask.task.words", { count: 1 })).toBe("מילה אחת");
  });

  it("falls back to `other`, matches exact `=N`, and keeps other variables", () => {
    withEnglish("nav.chat", "{name}: {count, plural, =0 {nothing} other {# left of {total}}}", () => {
      expect(t("en", "nav.chat", { name: "Dana", count: 0, total: 9 })).toBe("Dana: nothing");
      expect(t("en", "nav.chat", { name: "Dana", count: 1, total: 9 })).toBe("Dana: 1 left of 9");
      expect(t("en", "nav.chat", { name: "Dana", count: 4, total: 9 })).toBe("Dana: 4 left of 9");
    });
  });

  it("leaves a plural block alone when its count is missing, and plain strings unchanged", () => {
    expect(t("en", "ask.trace.steps", {})).toBe("{count, plural, one {# step} other {# steps}}");
    expect(t("en", "nav.pendingBadge", { label: "Tasks", count: 1 })).toBe("Tasks (1 pending)");
  });

  it("gives every plural block an `other` branch", () => {
    for (const locale of ["en", "he"] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (value?.includes(", plural,")) expect(value, `${locale}.${key}`).toMatch(/\bother \{/);
      }
    }
  });
});
