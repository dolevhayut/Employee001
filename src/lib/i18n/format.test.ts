import { describe, expect, it } from "vitest";

import { formatDateTime, formatRelativeTime } from "./format";

describe("formatRelativeTime", () => {
  const now = Date.now();

  it("uses an em dash for a missing timestamp", () => {
    expect(formatRelativeTime(undefined, "en")).toBe("—");
    expect(formatRelativeTime("", "he")).toBe("—");
  });

  it("formats a recent past time in the active locale", () => {
    const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo, "en")).toMatch(/minute/);
    expect(formatRelativeTime(fiveMinAgo, "he")).toMatch(/דק/);
  });

  it("formats a future time in the active locale", () => {
    const inTwoHours = new Date(now + 2 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(inTwoHours, "en").toLowerCase()).toMatch(/hour/);
    expect(formatRelativeTime(inTwoHours, "he")).toMatch(/שע/);
  });

  it("falls back to a calendar date past the cutoff", () => {
    const old = new Date(now - 10 * 24 * 60 * 60_000).toISOString();
    const en = formatRelativeTime(old, "en", { dateAfterMs: 7 * 24 * 60 * 60_000 });
    const he = formatRelativeTime(old, "he", { dateAfterMs: 7 * 24 * 60 * 60_000 });
    expect(en).not.toMatch(/ago|day/i);
    expect(he).not.toMatch(/לפני|יום/);
    expect(formatDateTime(old, "en")).toMatch(/\d/);
    expect(formatDateTime(old, "he")).toMatch(/\d/);
  });
});
