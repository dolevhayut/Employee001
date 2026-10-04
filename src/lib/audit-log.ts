import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";

// ─── Rotation ─────────────────────────────────────────────────────────────────

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * If audit.jsonl exceeds MAX_BYTES or its oldest entry is older than MAX_AGE_MS,
 * rotate: drop entries outside the window into audit.YYYY-MM.jsonl and rewrite
 * audit.jsonl with only the entries that fit within the window.
 */
function maybeRotate(filePath: string): void {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_BYTES) return; // fast path — no rotation needed

    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const cutoff = Date.now() - MAX_AGE_MS;

    const keep: string[] = [];
    const archive: Map<string, string[]> = new Map(); // "YYYY-MM" → lines

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts?: string };
        const ts = entry.ts ? new Date(entry.ts).getTime() : 0;
        if (ts >= cutoff) {
          keep.push(line);
        } else {
          const label = entry.ts
            ? entry.ts.slice(0, 7) // "YYYY-MM"
            : "unknown";
          if (!archive.has(label)) archive.set(label, []);
          archive.get(label)!.push(line);
        }
      } catch {
        keep.push(line); // unparseable line — keep it
      }
    }

    // Write archive files
    const dir = path.dirname(filePath);
    for (const [label, archiveLines] of archive) {
      const archivePath = path.join(dir, `audit.${label}.jsonl`);
      fs.appendFileSync(archivePath, archiveLines.join("\n") + "\n", "utf8");
    }

    // Rewrite active file
    fs.writeFileSync(filePath, keep.join("\n") + (keep.length ? "\n" : ""), "utf8");
  } catch {
    // Rotation must never crash the app.
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditVerdict =
  | "auto_allow"       // read-only Composio call, passed through without interruption
  | "ceo_approved"     // CEO clicked Approve (optionally with edited args)
  | "ceo_denied"       // CEO clicked Skip / Deny
  | "hard_blocked"     // matched the hard-block list — never reached the CEO
  | "executed"         // emitted from the SDK PostToolUse hook after the tool returned
  | "deferred_to_flow"; // shift mode: "ask" verdict deferred to /flow feed (Wave D)

export type AuditEntry = {
  id: string;
  ts: string;           // ISO-8601 wall-clock timestamp
  runId: string;
  employeeId: string;
  employeeName: string;
  toolName: string;     // full mcp__server__ACTION name
  bareName: string;     // ACTION only (prefix stripped)
  input: Record<string, unknown>;
  verdict: AuditVerdict;
  approvalId?: string;
  inputEdited?: boolean; // CEO changed the args before approving
  blockReason?: string;  // populated when verdict = hard_blocked
  durationMs?: number;   // populated when verdict = executed
  /** When the tool call originated inside a Task subagent, this is the
   *  subagent type (e.g. "web-researcher"). Absent for main-thread calls. */
  agentType?: string;
  /** Subagent instance id from the SDK hook input (parent_tool_use_id link). */
  agentId?: string;
  /** Hash of the preceding hashed row, or "genesis" for a new chain. */
  prevHash?: string;
  /** SHA-256 of prevHash plus the canonical row payload. */
  hash?: string;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const AUDIT_FILE = dataDir("audit.jsonl");

type LastHashCache = {
  filePath: string;
  hash: string | undefined;
  size: number;
  mtimeMs: number;
};

let lastHashCache: LastHashCache | undefined;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Match JSONL serialization first, then sort object keys recursively. */
function canonicalJson(value: unknown): string {
  return stableJson(JSON.parse(JSON.stringify(value)) as unknown);
}

function hashRow(prevHash: string, row: Omit<AuditEntry, "hash">): string {
  return createHash("sha256")
    .update(`${prevHash}\n${canonicalJson(row)}`)
    .digest("hex");
}

/** Read only the final line, even when the active log is large. */
function readLastLine(filePath: string): string | undefined {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return undefined;

  const fd = fs.openSync(filePath, "r");
  try {
    let end = stat.size;
    let suffix = "";
    while (end > 0) {
      const length = Math.min(8192, end);
      end -= length;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, end);
      suffix = buffer.toString("utf8") + suffix;
      const withoutTrailingNewlines = suffix.replace(/\n+$/, "");
      const priorLineBreak = withoutTrailingNewlines.lastIndexOf("\n");
      if (priorLineBreak >= 0) return withoutTrailingNewlines.slice(priorLineBreak + 1);
      if (end === 0) return withoutTrailingNewlines || undefined;
    }
    return undefined;
  } finally {
    fs.closeSync(fd);
  }
}

function lastHashInFile(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.statSync(filePath);
  if (lastHashCache && lastHashCache.filePath === filePath && lastHashCache.size === stat.size && lastHashCache.mtimeMs === stat.mtimeMs) {
    return lastHashCache.hash;
  }

  let hash: string | undefined;
  const line = readLastLine(filePath);
  if (line) {
    try {
      const row = JSON.parse(line) as AuditEntry;
      hash = typeof row.hash === "string" ? row.hash : undefined;
    } catch {
      // A malformed final line cannot contribute a predecessor; verification
      // will surface the malformed data separately.
    }
  }
  lastHashCache = { filePath, hash, size: stat.size, mtimeMs: stat.mtimeMs };
  return hash;
}

function ensureDir() {
  const dir = path.dirname(AUDIT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let _counter = 0;
function makeId(): string {
  _counter++;
  return `aud_${Date.now().toString(36)}_${_counter}`;
}

/** Append one entry to data/audit.jsonl (non-blocking). */
export function appendAuditEntry(
  entry: Omit<AuditEntry, "id" | "ts" | "prevHash" | "hash">
): void {
  try {
    ensureDir();
    maybeRotate(AUDIT_FILE);
    // The active tail is the normal predecessor. If rotation moved every
    // active row, continue from the newest archive so the chronological chain
    // remains intact.
    const previous = lastHashInFile(AUDIT_FILE) ?? lastHashFromNewestArchive();
    const unsignedRow: Omit<AuditEntry, "hash"> = {
      id: makeId(),
      ts: new Date().toISOString(),
      ...entry,
      prevHash: previous ?? "genesis",
    };
    const row: AuditEntry = {
      ...unsignedRow,
      hash: hashRow(unsignedRow.prevHash!, unsignedRow),
    };
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(row) + "\n", "utf8");
    const stat = fs.statSync(AUDIT_FILE);
    lastHashCache = { filePath: AUDIT_FILE, hash: row.hash, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    // Audit writes must never crash the agent run.
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export type AuditFilter = {
  employeeId?: string;
  toolName?: string;   // substring match on bareName
  verdict?: AuditVerdict;
  /** ISO timestamp — return entries with `ts >= since`. */
  since?: string;
  /** ISO timestamp — return entries with `ts <= until`. */
  until?: string;
  /** 1-based page; default 1. */
  page?: number;
  /** Rows per page; default 100, hard cap 500 so a buggy caller can't DoS. */
  pageSize?: number;
  /**
   * Optional monthly archive to read instead of the live audit.jsonl, in the
   * shape `"YYYY-MM"`. When set, we read `data/audit.YYYY-MM.jsonl` exclusively
   * (no fall-through to the live file). Returns `[]` if the archive is missing.
   */
  archive?: string;
};

export type AuditReadResult = {
  entries: AuditEntry[];
  /** Total rows after filtering, BEFORE pagination — drives UI pagination. */
  totalCount: number;
  page: number;
  pageSize: number;
  /** All archive months found under data/, newest-first. The UI uses this to
   *  populate a month-selector. Always returned so the client doesn't need a
   *  second round-trip. */
  archives: string[];
};

const ARCHIVE_RE = /^audit\.(\d{4}-\d{2})\.jsonl$/;

/**
 * List archived audit files under data/, newest-first, in the shape
 * `["2026-05", "2026-04", …]`. Pure listing — doesn't parse the files.
 */
function listArchives(): string[] {
  try {
    const dir = path.dirname(AUDIT_FILE);
    if (!fs.existsSync(dir)) return [];
    const months: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const m = name.match(ARCHIVE_RE);
      if (m) months.push(m[1]);
    }
    return months.sort().reverse();
  } catch {
    return [];
  }
}

function pathForArchive(month: string): string {
  return path.join(path.dirname(AUDIT_FILE), `audit.${month}.jsonl`);
}

function lastHashFromNewestArchive(): string | undefined {
  for (const month of listArchives()) {
    const hash = lastHashInFile(pathForArchive(month));
    if (hash) return hash;
  }
  return undefined;
}

export type AuditChainVerification = {
  ok: boolean;
  checked: number;
  legacy: number;
  firstBadId?: string;
  reason?: string;
};

/** Verify every archive (oldest first) followed by the active log. */
export function verifyAuditChain(): AuditChainVerification {
  let checked = 0;
  let legacy = 0;
  let previous = "genesis";
  let chainStarted = false;

  const files = [
    ...listArchives().sort().map(pathForArchive),
    AUDIT_FILE,
  ];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      let row: AuditEntry;
      try {
        row = JSON.parse(line) as AuditEntry;
      } catch {
        return { ok: false, checked, legacy, reason: "invalid JSON row" };
      }

      if (!row.hash || !row.prevHash) {
        if (!chainStarted) {
          legacy++;
          continue;
        }
        return {
          ok: false,
          checked,
          legacy,
          firstBadId: row.id,
          reason: "missing hash fields after chain start",
        };
      }

      const unsignedRow = { ...row };
      delete unsignedRow.hash;
      const expected = hashRow(row.prevHash, unsignedRow);
      if (row.prevHash !== previous) {
        return { ok: false, checked, legacy, firstBadId: row.id, reason: "previous hash mismatch" };
      }
      if (row.hash !== expected) {
        return { ok: false, checked, legacy, firstBadId: row.id, reason: "hash mismatch" };
      }
      chainStarted = true;
      previous = row.hash;
      checked++;
    }
  }

  return { ok: true, checked, legacy };
}

/**
 * Read and parse the audit log, newest-first, with optional filtering +
 * date-range + pagination + archive selection.
 *
 * Filtering happens before pagination, so `totalCount` is the size of the
 * filtered view (the UI uses it to render "page 1 of N").
 */
export function readAuditLog(filter: AuditFilter = {}): AuditReadResult {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, filter.pageSize ?? 100));
  const archives = listArchives();

  try {
    ensureDir();

    // Pick the source file: a named archive if requested, otherwise the live
    // audit.jsonl. We don't merge — querying an archive month gives you only
    // that month's archived rows, not anything that's been rotated since.
    const sourceFile = filter.archive
      ? pathForArchive(filter.archive)
      : AUDIT_FILE;

    if (!fs.existsSync(sourceFile)) {
      return { entries: [], totalCount: 0, page, pageSize, archives };
    }

    const raw = fs.readFileSync(sourceFile, "utf8");
    const entries: AuditEntry[] = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEntry => e !== null);

    // Filter window
    const sinceMs = filter.since ? Date.parse(filter.since) : Number.NEGATIVE_INFINITY;
    const untilMs = filter.until ? Date.parse(filter.until) : Number.POSITIVE_INFINITY;

    const filtered = entries.filter((e) => {
      if (filter.employeeId && e.employeeId !== filter.employeeId) return false;
      if (
        filter.toolName &&
        !e.bareName.toLowerCase().includes(filter.toolName.toLowerCase())
      )
        return false;
      if (filter.verdict && e.verdict !== filter.verdict) return false;
      // Date window — `ts` is ISO so Date.parse handles it; bad values get
      // NaN, which falls outside any comparison and drops the row.
      const t = Date.parse(e.ts);
      if (Number.isFinite(t)) {
        if (t < sinceMs) return false;
        if (t > untilMs) return false;
      }
      return true;
    });

    // Newest-first first, then page slice.
    const sorted = filtered.reverse();
    const start = (page - 1) * pageSize;
    const slice = sorted.slice(start, start + pageSize);

    return {
      entries: slice,
      totalCount: sorted.length,
      page,
      pageSize,
      archives,
    };
  } catch {
    return { entries: [], totalCount: 0, page, pageSize, archives };
  }
}
