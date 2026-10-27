// Pure helpers for how old a profile file is. No fs, so client pages can use
// them; the disk side lives in employees-disk.ts (profileFileAges).

/** Files older than this are listed in the "still true?" nudge. */
export const STALE_AFTER_DAYS = 30;

export type ProfileFileAge = {
  file: string; // e.g. "DECISIONS.md"
  days: number; // whole days since the file was last written or confirmed
  /** What the age counts from: the owner's last "Still true", or the last write. */
  basis: "confirmed" | "written";
  at: string; // ISO time the age counts from
};

/** Whole days between two instants; never negative (clock skew). */
export function daysBetween(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / 86_400_000));
}

/** "41 days old", "1 day old", "updated today" (or "confirmed today" after a Still true). */
export function describeAge(days: number, basis: "confirmed" | "written" = "written"): string {
  if (days <= 0) return basis === "confirmed" ? "confirmed today" : "updated today";
  return `${days} ${days === 1 ? "day" : "days"} old`;
}

/** The files due for the monthly nudge, oldest first. */
export function staleProfileFiles<T extends { days: number }>(ages: T[], thresholdDays = STALE_AFTER_DAYS): T[] {
  return ages.filter((a) => a.days > thresholdDays).sort((a, b) => b.days - a.days);
}
