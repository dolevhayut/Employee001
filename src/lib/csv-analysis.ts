/**
 * CSV analysis primitives used by the meeting-scratch MCP tools.
 *
 * Two operations:
 *
 *   `analyzeCsv`  — parse a CSV string, infer column types, return a tight
 *                   schema overview with numeric stats and a 10-row preview.
 *                   Cheap; should always be called before query_csv.
 *
 *   `queryCsv`    — apply a JSON-DSL query (where / groupBy / aggregate /
 *                   orderBy / limit) and return the result rows as plain
 *                   JSON. Lets a twin compute aggregations over a 50k-row
 *                   CSV without paying the prompt cost of reading the body.
 *
 * Type inference is best-effort: numeric, boolean, ISO-date, otherwise
 * string. We sample up to TYPE_INFERENCE_SAMPLE rows for speed.
 */

import Papa from "papaparse";

export type ColumnType = "number" | "boolean" | "date" | "string";

export type CsvColumn = {
  name: string;
  type: ColumnType;
  nullCount: number;
  uniqueCount: number;
  /** Up to 5 representative non-null values, deduplicated, in encounter order. */
  sample: Array<string | number | boolean>;
  /** Only for numeric columns. */
  numericStats?: {
    min: number;
    max: number;
    avg: number;
    sum: number;
    nonNullCount: number;
  };
  /** Only for date columns — ISO strings. */
  dateStats?: { min: string; max: string };
};

export type CsvAnalysis = {
  rowCount: number;
  columns: CsvColumn[];
  /** First 10 raw rows as objects, with values coerced per column type. */
  previewRows: Array<Record<string, unknown>>;
  /** Bytes parsed (approximate; for the agent's situational awareness). */
  byteSize: number;
};

const TYPE_INFERENCE_SAMPLE = 200;
const PREVIEW_ROWS = 10;
const SAMPLE_PER_COLUMN = 5;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/;

function inferColumnType(values: string[]): ColumnType {
  let numeric = 0;
  let boolean = 0;
  let date = 0;
  let nonEmpty = 0;
  for (const raw of values) {
    if (raw === "" || raw == null) continue;
    nonEmpty++;
    const v = raw.trim();
    if (/^(true|false)$/i.test(v)) {
      boolean++;
      continue;
    }
    if (!Number.isNaN(Number(v)) && /[0-9]/.test(v)) {
      numeric++;
      continue;
    }
    if (ISO_DATE_RE.test(v)) {
      date++;
      continue;
    }
  }
  if (nonEmpty === 0) return "string";
  // Require ≥80% match for a typed column; otherwise fall back to string.
  const threshold = 0.8 * nonEmpty;
  if (numeric >= threshold) return "number";
  if (boolean >= threshold) return "boolean";
  if (date >= threshold) return "date";
  return "string";
}

function coerce(raw: string, type: ColumnType): string | number | boolean | null {
  if (raw === "" || raw == null) return null;
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "boolean") {
    const v = raw.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  }
  // date / string — keep as string; downstream comparisons handle dates as strings (ISO sorts correctly).
  return raw;
}

/** Parse CSV text → typed rows + analysis. */
export function analyzeCsv(csvText: string): {
  analysis: CsvAnalysis;
  /** Coerced rows; reused by queryCsv to avoid double parsing. */
  rows: Array<Record<string, string | number | boolean | null>>;
  columnTypes: Record<string, ColumnType>;
} {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const rawRows = parsed.data;
  const rowCount = rawRows.length;

  // Infer types from a sample window.
  const columnTypes: Record<string, ColumnType> = {};
  for (const header of headers) {
    const sampleValues = rawRows
      .slice(0, TYPE_INFERENCE_SAMPLE)
      .map((r) => r?.[header] ?? "");
    columnTypes[header] = inferColumnType(sampleValues);
  }

  // Coerce all rows to typed values for downstream query use.
  const rows = rawRows.map((r) => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const h of headers) {
      out[h] = coerce(r?.[h] ?? "", columnTypes[h]);
    }
    return out;
  });

  // Per-column stats.
  const columns: CsvColumn[] = headers.map((name) => {
    const type = columnTypes[name];
    let nullCount = 0;
    const seen = new Set<string>();
    const sample: Array<string | number | boolean> = [];
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let nonNullCount = 0;
    let dateMin: string | undefined;
    let dateMax: string | undefined;

    for (const row of rows) {
      const v = row[name];
      if (v === null) {
        nullCount++;
        continue;
      }
      const key = String(v);
      if (!seen.has(key)) {
        seen.add(key);
        if (sample.length < SAMPLE_PER_COLUMN) sample.push(v);
      }
      if (type === "number" && typeof v === "number") {
        nonNullCount++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (type === "date" && typeof v === "string") {
        if (!dateMin || v < dateMin) dateMin = v;
        if (!dateMax || v > dateMax) dateMax = v;
      }
    }

    const col: CsvColumn = {
      name,
      type,
      nullCount,
      uniqueCount: seen.size,
      sample,
    };
    if (type === "number" && nonNullCount > 0) {
      col.numericStats = {
        min,
        max,
        avg: sum / nonNullCount,
        sum,
        nonNullCount,
      };
    }
    if (type === "date" && dateMin && dateMax) {
      col.dateStats = { min: dateMin, max: dateMax };
    }
    return col;
  });

  const previewRows = rows.slice(0, PREVIEW_ROWS);

  return {
    analysis: {
      rowCount,
      columns,
      previewRows,
      byteSize: csvText.length,
    },
    rows,
    columnTypes,
  };
}

// ─── Query DSL ──────────────────────────────────────────────────────────────

export type WhereClause = Record<
  string,
  | string
  | number
  | boolean
  | null
  | {
      eq?: string | number | boolean | null;
      ne?: string | number | boolean | null;
      gt?: number | string;
      gte?: number | string;
      lt?: number | string;
      lte?: number | string;
      in?: Array<string | number | boolean>;
      contains?: string;
    }
>;

export type AggregateOp =
  | { sum: string }
  | { avg: string }
  | { min: string }
  | { max: string }
  | { count: "*" | string };

export type QuerySpec = {
  where?: WhereClause;
  groupBy?: string[];
  aggregate?: Record<string, AggregateOp>;
  orderBy?: Array<{ column: string; dir?: "asc" | "desc" }>;
  limit?: number;
  /** When neither groupBy nor aggregate are given, narrow output to these columns. */
  select?: string[];
};

export type QueryResult = {
  rows: Array<Record<string, unknown>>;
  totalMatched: number;
  truncated: boolean;
};

const MAX_QUERY_RESULT_ROWS = 500;

function rowMatchesWhere(
  row: Record<string, unknown>,
  where: WhereClause
): boolean {
  for (const [col, cond] of Object.entries(where)) {
    const v = row[col];
    if (
      cond === null ||
      typeof cond === "string" ||
      typeof cond === "number" ||
      typeof cond === "boolean"
    ) {
      if (v !== cond) return false;
      continue;
    }
    if (cond.eq !== undefined && v !== cond.eq) return false;
    if (cond.ne !== undefined && v === cond.ne) return false;
    if (cond.gt !== undefined && !(typeof v === typeof cond.gt && (v as number) > (cond.gt as number))) return false;
    if (cond.gte !== undefined && !(typeof v === typeof cond.gte && (v as number) >= (cond.gte as number))) return false;
    if (cond.lt !== undefined && !(typeof v === typeof cond.lt && (v as number) < (cond.lt as number))) return false;
    if (cond.lte !== undefined && !(typeof v === typeof cond.lte && (v as number) <= (cond.lte as number))) return false;
    if (cond.in !== undefined && !cond.in.includes(v as string | number | boolean)) return false;
    if (cond.contains !== undefined && (typeof v !== "string" || !v.toLowerCase().includes(cond.contains.toLowerCase()))) return false;
  }
  return true;
}

function aggregateValue(
  rows: Array<Record<string, unknown>>,
  op: AggregateOp
): number {
  if ("count" in op) {
    if (op.count === "*") return rows.length;
    return rows.reduce(
      (acc, r) => acc + (r[op.count as string] !== null && r[op.count as string] !== undefined ? 1 : 0),
      0
    );
  }
  const col =
    "sum" in op ? op.sum : "avg" in op ? op.avg : "min" in op ? op.min : op.max;
  const nums: number[] = [];
  for (const r of rows) {
    const v = r[col];
    if (typeof v === "number") nums.push(v);
  }
  if (nums.length === 0) return 0;
  if ("sum" in op) return nums.reduce((a, b) => a + b, 0);
  if ("avg" in op) return nums.reduce((a, b) => a + b, 0) / nums.length;
  if ("min" in op) return Math.min(...nums);
  return Math.max(...nums);
}

export function queryCsv(
  rows: Array<Record<string, unknown>>,
  spec: QuerySpec
): QueryResult {
  // 1. Filter
  let filtered = spec.where
    ? rows.filter((r) => rowMatchesWhere(r, spec.where!))
    : rows;
  const totalMatched = filtered.length;

  // 2. Group + aggregate
  if (spec.groupBy && spec.groupBy.length > 0) {
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const r of filtered) {
      const key = spec.groupBy.map((g) => String(r[g] ?? "")).join(" ");
      const bucket = groups.get(key);
      if (bucket) bucket.push(r);
      else groups.set(key, [r]);
    }
    const grouped: Array<Record<string, unknown>> = [];
    for (const [, bucketRows] of groups) {
      const out: Record<string, unknown> = {};
      // Carry group columns
      for (const g of spec.groupBy) out[g] = bucketRows[0][g];
      // Compute aggregates
      if (spec.aggregate) {
        for (const [alias, op] of Object.entries(spec.aggregate)) {
          out[alias] = aggregateValue(bucketRows, op);
        }
      } else {
        out.count = bucketRows.length;
      }
      grouped.push(out);
    }
    filtered = grouped;
  } else if (spec.aggregate && Object.keys(spec.aggregate).length > 0) {
    // Aggregate without group → single-row result
    const out: Record<string, unknown> = {};
    for (const [alias, op] of Object.entries(spec.aggregate)) {
      out[alias] = aggregateValue(filtered, op);
    }
    filtered = [out];
  } else if (spec.select && spec.select.length > 0) {
    filtered = filtered.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of spec.select!) out[c] = r[c];
      return out;
    });
  }

  // 3. Order
  if (spec.orderBy && spec.orderBy.length > 0) {
    filtered = [...filtered].sort((a, b) => {
      for (const { column, dir } of spec.orderBy!) {
        const av = a[column];
        const bv = b[column];
        let cmp = 0;
        if (av === bv) cmp = 0;
        else if (av === null || av === undefined) cmp = -1;
        else if (bv === null || bv === undefined) cmp = 1;
        else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  // 4. Limit
  const limit = Math.min(spec.limit ?? MAX_QUERY_RESULT_ROWS, MAX_QUERY_RESULT_ROWS);
  const truncated = filtered.length > limit;
  const rowsOut = filtered.slice(0, limit);

  return {
    rows: rowsOut,
    totalMatched,
    truncated,
  };
}
