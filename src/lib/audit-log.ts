import fs from "fs";
import path from "path";
import { appendOneLake } from "@/lib/storage/onelake-client";
import { getStorageBackend } from "@/lib/storage";

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
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const AUDIT_FILE = path.join(process.cwd(), "data", "audit.jsonl");

function ensureDir() {
  const dir = path.dirname(AUDIT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let _counter = 0;
function makeId(): string {
  _counter++;
  return `aud_${Date.now().toString(36)}_${_counter}`;
}

/** Append one entry to data/audit.jsonl (non-blocking). When
 *  STORAGE_BACKEND=fabric, also mirror the same line to the Microsoft Fabric
 *  lakehouse under Files/audit/<YYYY-MM-DD>.jsonl. The Fabric write is
 *  fire-and-forget so the agent run is never blocked on lakehouse latency. */
export function appendAuditEntry(
  entry: Omit<AuditEntry, "id" | "ts">
): void {
  try {
    ensureDir();
    maybeRotate(AUDIT_FILE);
    const row: AuditEntry = {
      id: makeId(),
      ts: new Date().toISOString(),
      ...entry,
    };
    const line = JSON.stringify(row) + "\n";
    fs.appendFileSync(AUDIT_FILE, line, "utf8");
    if (getStorageBackend() === "fabric") {
      const dayFile = `audit-${row.ts.slice(0, 10)}.jsonl`;
      void appendOneLake({ table: "audit", filename: dayFile, data: line }).catch(
        (err) => {
          console.warn(
            `[audit] Fabric mirror failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      );
    }
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
