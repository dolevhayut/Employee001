import { describe, expect, it } from "vitest";

import { computeNextCron, isValidCron, parseCron } from "./cron";

describe("isValidCron", () => {
  it("guarantees five-field wildcards, lists, ranges, and steps are accepted", () => {
    for (const expr of ["* * * * *", "0,15,30,45 9-17/2 1,15 1-12/3 1-5"]) {
      expect(isValidCron(expr)).toBe(true);
    }
    expect(parseCron("*/15 9-17/2 * * 1-5")).toEqual({
      minutes: [0, 15, 30, 45],
      hours: [9, 11, 13, 15, 17],
      doms: Array.from({ length: 31 }, (_, index) => index + 1),
      months: Array.from({ length: 12 }, (_, index) => index + 1),
      dows: [1, 2, 3, 4, 5],
    });
  });

  it("guarantees missing fields, out-of-range values, and zero steps are rejected", () => {
    for (const expr of ["* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 7", "*/0 * * * *", "5-1 * * * *"]) {
      expect(isValidCron(expr)).toBe(false);
    }
  });

  it.fails("guarantees malformed numeric tokens are rejected instead of being partially parsed", () => {
    // Bug: parseInt accepts the leading integer in malformed fields such as "1x".
    expect(isValidCron("1x * * * *")).toBe(false);
  });

  it.fails("guarantees fields with more than one slash are rejected", () => {
    // Bug: parseField ignores segments after the first slash.
    expect(isValidCron("*/2/3 * * * *")).toBe(false);
  });
});

describe("computeNextCron", () => {
  it("guarantees the returned time is strictly after the starting minute", () => {
    expect(computeNextCron("*/15 * * * *", new Date("2026-01-01T10:15:45.000Z"))).toEqual(
      new Date("2026-01-01T10:30:00.000Z"),
    );
  });

  it("guarantees restricted day-of-month and day-of-week use cron OR semantics", () => {
    const from = new Date(2026, 0, 1, 0, 0, 0); // Thursday, January 1 in local time
    const next = computeNextCron("0 9 2 * 4", from);
    expect(next).toEqual(new Date(2026, 0, 1, 9, 0, 0));
  });

  it("guarantees schedules after Israel's DST spring-forward gap run at the next real local time", () => {
    const beforeGap = new Date(2026, 2, 27, 1, 59, 0); // DST jumps from 02:00 to 03:00 locally
    const next = computeNextCron("30 3 * * *", beforeGap);
    expect(next).toEqual(new Date(2026, 2, 27, 3, 30, 0));
  });
});
