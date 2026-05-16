import fs from "fs";
import path from "path";

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

/** Append one entry to data/audit.jsonl (non-blocking). */
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
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(row) + "\n", "utf8");
  } catch {
    // Audit writes must never crash the agent run.
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export type AuditFilter = {
  employeeId?: string;
  toolName?: string;   // substring match on bareName
  verdict?: AuditVerdict;
};

/** Read and parse the full audit log, newest-first, with optional filtering. */
export function readAuditLog(filter: AuditFilter = {}): AuditEntry[] {
  try {
    ensureDir();
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const raw = fs.readFileSync(AUDIT_FILE, "utf8");
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

    const filtered = entries.filter((e) => {
      if (filter.employeeId && e.employeeId !== filter.employeeId) return false;
      if (
        filter.toolName &&
        !e.bareName.toLowerCase().includes(filter.toolName.toLowerCase())
      )
        return false;
      if (filter.verdict && e.verdict !== filter.verdict) return false;
      return true;
    });

    return filtered.reverse(); // newest-first
  } catch {
    return [];
  }
}
