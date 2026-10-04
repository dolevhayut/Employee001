// Locale-aware dates and relative times. UI calls these with the active
// `useT()` locale so Hebrew and English share one implementation.

import type { Locale } from "./messages";

const BCP47: Record<Locale, string> = {
  en: "en-US",
  he: "he-IL",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function bcp47(locale: Locale): string {
  return BCP47[locale];
}

/** First-strong isolate. Use in plain strings (tooltips, chart labels) where `<bdi>` cannot. */
export function isolate(value: string): string {
  return `\u2068${value}\u2069`;
}

export function formatRelativeTime(
  input: string | number | Date | null | undefined,
  locale: Locale,
  options?: { dateAfterMs?: number },
): string {
  if (input == null || input === "") return "—";
  const time = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(time)) return "—";

  const diff = time - Date.now();
  const abs = Math.abs(diff);
  const tag = BCP47[locale];

  if (options?.dateAfterMs != null && abs >= options.dateAfterMs) {
    return new Intl.DateTimeFormat(tag, { dateStyle: "medium" }).format(time);
  }

  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  if (abs < MINUTE) {
    if (diff > 0) return rtf.format(1, "minute");
    return rtf.format(0, "second");
  }

  const unit: Intl.RelativeTimeFormatUnit =
    abs < HOUR ? "minute" : abs < DAY ? "hour" : "day";
  const size = unit === "minute" ? MINUTE : unit === "hour" ? HOUR : DAY;
  let value = Math.round(diff / size);
  if (value === 0) value = diff < 0 ? -1 : 1;
  return rtf.format(value, unit);
}

export function formatDateTime(input: string | number | Date, locale: Locale): string {
  const time = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(time)) return "—";
  return new Intl.DateTimeFormat(BCP47[locale], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time);
}
