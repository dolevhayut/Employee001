// Line-grained Myers diff for profile version comparisons. No dependencies.
// Inputs longer than MAX_DIFF_LINES on either side return a single marker
// instead of running the O(ND) search.

export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
};

/** Single-line marker when a side is too long to diff. The UI detects this. */
export const DIFF_TOO_LARGE_TEXT = "too large to diff";

const MAX_DIFF_LINES = 5000;
const CONTEXT_LINES = 3;

const UNCHANGED_LINE_RE = /^… \d+ unchanged lines …$/;

export function unchangedLinesLabel(count: number): string {
  return `… ${count} unchanged lines …`;
}

export function isCollapsedUnchanged(text: string): boolean {
  return UNCHANGED_LINE_RE.test(text);
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return [{ type: "same", text: DIFF_TOO_LARGE_TEXT }];
  }
  return collapseUnchanged(diffLineArrays(oldLines, newLines), CONTEXT_LINES);
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  // A trailing newline terminates the last line; it is not an extra blank line.
  if (normalized.endsWith("\n")) parts.pop();
  return parts;
}

function diffLineArrays(oldLines: string[], newLines: string[]): DiffLine[] {
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const prefix: DiffLine[] = oldLines
    .slice(0, start)
    .map((text) => ({ type: "same", text }));
  const middle = myers(
    oldLines.slice(start, oldEnd),
    newLines.slice(start, newEnd),
  );
  const suffix: DiffLine[] = oldLines
    .slice(oldEnd)
    .map((text) => ({ type: "same", text }));
  return prefix.concat(middle, suffix);
}

/**
 * Myers shortest-edit script on two line arrays.
 * Trace stores the diagonal frontier at the start of each edit-distance
 * iteration; backtracking walks that frontier to recover the script.
 */
function myers(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((text) => ({ type: "add", text }));
  if (m === 0) return a.map((text) => ({ type: "del", text }));

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, offset, a, b, d);
      }
    }
  }
  return [];
}

function backtrack(
  trace: Int32Array[],
  offset: number,
  a: string[],
  b: string[],
  dEnd: number,
): DiffLine[] {
  const out: DiffLine[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = dEnd; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
        ? k + 1
        : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      out.push({ type: "same", text: a[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        y -= 1;
        out.push({ type: "add", text: b[y] });
      } else {
        x -= 1;
        out.push({ type: "del", text: a[x] });
      }
    }
  }

  out.reverse();
  return out;
}

function collapseUnchanged(lines: DiffLine[], context: number): DiffLine[] {
  type Run = { kind: "same" | "change"; lines: DiffLine[] };
  const runs: Run[] = [];
  for (const line of lines) {
    const kind = line.type === "same" ? "same" : "change";
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.lines.push(line);
    else runs.push({ kind, lines: [line] });
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.kind === "change") {
      out.push(...run.lines);
      continue;
    }
    const keepStart = i > 0 && runs[i - 1].kind === "change" ? context : 0;
    const keepEnd =
      i + 1 < runs.length && runs[i + 1].kind === "change" ? context : 0;
    if (run.lines.length <= keepStart + keepEnd) {
      out.push(...run.lines);
      continue;
    }
    const omitted = run.lines.length - keepStart - keepEnd;
    if (keepStart > 0) out.push(...run.lines.slice(0, keepStart));
    out.push({ type: "same", text: unchangedLinesLabel(omitted) });
    if (keepEnd > 0) out.push(...run.lines.slice(run.lines.length - keepEnd));
  }
  return out;
}
