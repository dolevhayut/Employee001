// Minimal 5-field cron parser. Supports: *, N, N-M, N,M,P, */N, N-M/S.
// Field order: minute (0-59) | hour (0-23) | day-of-month (1-31) | month (1-12) | day-of-week (0-6, Sun=0)
//
// Why hand-rolled: keeps Wave G dependency-free. Cabinet's cron-compute does
// the same. We're <100 lines and don't need DST quirks (server runs UTC; the
// schedule UI is local-time; we accept the standard 1-hour-skip on DST edges).

export type CronExpr = {
  minutes: number[];
  hours: number[];
  doms: number[];
  months: number[];
  dows: number[];
};

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(field: string, [min, max]: readonly [number, number]): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let step = 1;
    let range = part;
    if (part.includes("/")) {
      const [r, s] = part.split("/");
      range = r;
      step = parseInt(s, 10);
      if (!Number.isFinite(step) || step < 1) {
        throw new Error(`Invalid step in '${part}'`);
      }
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map((s) => parseInt(s, 10));
      lo = a;
      hi = b;
    } else {
      lo = parseInt(range, 10);
      hi = lo;
    }
    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      lo < min ||
      hi > max ||
      lo > hi
    ) {
      throw new Error(`Invalid range '${range}' for [${min},${max}]`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(expr: string): CronExpr {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length}: '${expr}'`);
  }
  return {
    minutes: parseField(fields[0], FIELD_RANGES[0]),
    hours: parseField(fields[1], FIELD_RANGES[1]),
    doms: parseField(fields[2], FIELD_RANGES[2]),
    months: parseField(fields[3], FIELD_RANGES[3]),
    dows: parseField(fields[4], FIELD_RANGES[4]),
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function domDowMatch(parsed: CronExpr, d: Date): boolean {
  // Cron quirk: when both DOM and DOW are restricted (not "*"), match if EITHER
  // matches (OR semantics). When only one is restricted, that one must match.
  const domStar = parsed.doms.length === 31;
  const dowStar = parsed.dows.length === 7;
  const domMatch = parsed.doms.includes(d.getDate());
  const dowMatch = parsed.dows.includes(d.getDay());

  if (!domStar && !dowStar) return domMatch || dowMatch;
  if (!domStar) return domMatch;
  if (!dowStar) return dowMatch;
  return true;
}

export function computeNextCron(expr: string, from: Date = new Date()): Date {
  const parsed = parseCron(expr);
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  const maxIter = 60 * 24 * 366;
  for (let i = 0; i < maxIter; i++) {
    if (
      parsed.minutes.includes(next.getMinutes()) &&
      parsed.hours.includes(next.getHours()) &&
      parsed.months.includes(next.getMonth() + 1) &&
      domDowMatch(parsed, next)
    ) {
      return new Date(next);
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(`Could not find next match for cron '${expr}' within 1 year`);
}
