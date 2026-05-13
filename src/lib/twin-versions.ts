// Twin Versions — snapshots every change to the 9 profile files and records
// a manifest per Twin Builder run. The CEO can browse builds on a timeline,
// inspect any historical version of a file, and restore a single file or an
// entire build's state back to root.
//
// Storage layout (all gitignored under data/employees/{id}/.versions/):
//
//   data/employees/{id}/
//   ├── CONTEXT.md                                ← canonical "active" file
//   ├── ... (9 files)
//   └── .versions/
//       ├── _log.jsonl                            ← append-only file-snapshot log
//       ├── files/
//       │   └── CONTEXT.md/
//       │       ├── 2026-05-03T22-10-12-345Z.md
//       │       └── ...
//       └── builds/
//           └── 2026-05-03T22-10-09-001Z.json     ← one manifest per build
//
// The active twin = the files at the employee root. Restoring a version
// copies the historical body back into the root; the previous root state is
// snapshotted on the way (so restores are themselves reversible).

import path from "path";
import fs from "fs";
import { TWIN_FILE_NAMES, type TwinFileName } from "./twin-builder-types";

const ROOT = (id: string) =>
  path.join(process.cwd(), "data", "employees", id);
const VERSIONS_DIR = (id: string) => path.join(ROOT(id), ".versions");
const FILES_DIR = (id: string) => path.join(VERSIONS_DIR(id), "files");
const BUILDS_DIR = (id: string) => path.join(VERSIONS_DIR(id), "builds");
const LOG_FILE = (id: string) => path.join(VERSIONS_DIR(id), "_log.jsonl");
const EVENTS_FILE = (id: string, buildId: string) =>
  path.join(BUILDS_DIR(id), `${buildId}.events.jsonl`);
const ACTIVE_BUILDS_FILE = path.join(
  process.cwd(),
  "data",
  "active-builds.json"
);

function safeIso(d: Date = new Date()): string {
  // Filesystem-safe ISO: replace `:` and `.` with `-`. Sortable as string.
  return d.toISOString().replace(/[:.]/g, "-");
}

function ensureDirs(employeeId: string): void {
  fs.mkdirSync(VERSIONS_DIR(employeeId), { recursive: true });
  fs.mkdirSync(FILES_DIR(employeeId), { recursive: true });
  fs.mkdirSync(BUILDS_DIR(employeeId), { recursive: true });
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type SnapshotSource = "builder" | "manual" | "restore";

export type FileSnapshotLogEntry = {
  ts: string; // safe-ISO of the snapshot file
  filename: TwinFileName;
  sizeBytes: number;
  source: SnapshotSource;
  /** When source==="builder", the buildId this snapshot is part of. */
  buildId?: string;
  /** When source==="restore", the ts the body was copied from. */
  restoredFromTs?: string;
};

export type BuildManifest = {
  /** Same as the manifest filename ts (filesystem-safe). */
  buildId: string;
  /** ISO of when the build started. */
  startedAt: string;
  /** ISO of when the build finished. */
  finishedAt: string;
  /** Wall-clock duration in ms. */
  durationMs: number;
  modelUsed: string;
  costUsd: number;
  turns: number;
  stoppedReason: "max_budget" | "max_turns" | "natural" | "no_connections";
  /** Free-form CEO context the run started with, if any. */
  ceoContext?: string;
  /** Composio toolkits that were ACTIVE at the start of this run. */
  activeToolkits: string[];
  /**
   * One entry per file present at the employee root at the END of this build.
   * Each points to the snapshot the manifest captured for that file.
   */
  files: Array<{
    filename: TwinFileName;
    snapshotTs: string;
    sizeBytes: number;
    /** Whether this build's runner actually wrote (or rewrote) this file. */
    written: boolean;
  }>;
};

// ─── File snapshots ──────────────────────────────────────────────────────────

/**
 * Snapshot the given body to .versions/files/{filename}/{ts}.md and append a
 * log entry. Returns the snapshot ts (filesystem-safe ISO). Idempotent only by
 * ts — call sites pass `at` to coalesce when they need to.
 */
export function snapshotFile(
  employeeId: string,
  filename: TwinFileName,
  body: string,
  source: SnapshotSource,
  extra: { buildId?: string; restoredFromTs?: string; at?: Date } = {}
): string {
  ensureDirs(employeeId);
  const ts = safeIso(extra.at ?? new Date());
  const dir = path.join(FILES_DIR(employeeId), filename);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ts}.md`);
  // If a snapshot for this exact ts already exists (rare — same-ms calls),
  // bump by one ms's worth of suffix to avoid clobbering.
  let finalTs = ts;
  let finalPath = file;
  let i = 0;
  while (fs.existsSync(finalPath)) {
    i += 1;
    finalTs = `${ts}-${i}`;
    finalPath = path.join(dir, `${finalTs}.md`);
  }
  fs.writeFileSync(finalPath, body, "utf-8");

  const entry: FileSnapshotLogEntry = {
    ts: finalTs,
    filename,
    sizeBytes: Buffer.byteLength(body, "utf-8"),
    source,
    ...(extra.buildId ? { buildId: extra.buildId } : {}),
    ...(extra.restoredFromTs ? { restoredFromTs: extra.restoredFromTs } : {}),
  };
  fs.appendFileSync(LOG_FILE(employeeId), JSON.stringify(entry) + "\n");

  return finalTs;
}

/**
 * Snapshot whatever is currently at the employee root for `filename`. No-ops
 * (returns null) if the file doesn't exist or is empty.
 */
export function snapshotRootFile(
  employeeId: string,
  filename: TwinFileName,
  source: SnapshotSource,
  extra: { buildId?: string; restoredFromTs?: string; at?: Date } = {}
): string | null {
  const rootFile = path.join(ROOT(employeeId), filename);
  let body = "";
  try {
    body = fs.readFileSync(rootFile, "utf-8");
  } catch {
    return null;
  }
  if (!body) return null;
  return snapshotFile(employeeId, filename, body, source, extra);
}

export function listFileVersions(
  employeeId: string,
  filename: TwinFileName
): Array<{ ts: string; sizeBytes: number; source: SnapshotSource; buildId?: string }> {
  const log = readLog(employeeId);
  return log
    .filter((e) => e.filename === filename)
    .map((e) => ({
      ts: e.ts,
      sizeBytes: e.sizeBytes,
      source: e.source,
      buildId: e.buildId,
    }))
    .reverse(); // newest first
}

export function readFileVersion(
  employeeId: string,
  filename: TwinFileName,
  ts: string
): string | null {
  // Hard-allowlist filename and ts pattern so query params can't traverse.
  if (!(TWIN_FILE_NAMES as readonly string[]).includes(filename)) return null;
  if (!/^[0-9A-Za-z\-]+Z(-\d+)?$/.test(ts)) return null;
  const file = path.join(FILES_DIR(employeeId), filename, `${ts}.md`);
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function readLog(employeeId: string): FileSnapshotLogEntry[] {
  try {
    const raw = fs.readFileSync(LOG_FILE(employeeId), "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as FileSnapshotLogEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is FileSnapshotLogEntry => x !== null);
  } catch {
    return [];
  }
}

// ─── Build manifests ─────────────────────────────────────────────────────────

export function newBuildId(at: Date = new Date()): string {
  return safeIso(at);
}

/**
 * Capture every file currently at the employee root as part of this build's
 * manifest, then write the manifest. Files marked `written: true` if they
 * appear in `writtenFiles` (the set the builder actually rewrote this run).
 */
export function recordBuild(args: {
  employeeId: string;
  buildId: string;
  startedAt: Date;
  finishedAt: Date;
  modelUsed: string;
  costUsd: number;
  turns: number;
  stoppedReason: BuildManifest["stoppedReason"];
  ceoContext?: string;
  activeToolkits: string[];
  /** Subset of the 9 files that were rewritten in this run. */
  writtenFiles: TwinFileName[];
}): BuildManifest {
  ensureDirs(args.employeeId);
  const written = new Set(args.writtenFiles);

  const files: BuildManifest["files"] = [];
  for (const name of TWIN_FILE_NAMES) {
    const root = path.join(ROOT(args.employeeId), name);
    let body = "";
    try {
      body = fs.readFileSync(root, "utf-8");
    } catch {
      continue; // file doesn't exist at root — skip
    }
    if (!body) continue;
    // Always snapshot end-of-build state. Even files not touched this run get
    // their own snapshot in this manifest so "restore build v3" produces a
    // self-contained state without cross-build pointer chasing.
    const snapshotTs = snapshotFile(args.employeeId, name, body, "builder", {
      buildId: args.buildId,
    });
    files.push({
      filename: name,
      snapshotTs,
      sizeBytes: Buffer.byteLength(body, "utf-8"),
      written: written.has(name),
    });
  }

  const manifest: BuildManifest = {
    buildId: args.buildId,
    startedAt: args.startedAt.toISOString(),
    finishedAt: args.finishedAt.toISOString(),
    durationMs: args.finishedAt.getTime() - args.startedAt.getTime(),
    modelUsed: args.modelUsed,
    costUsd: args.costUsd,
    turns: args.turns,
    stoppedReason: args.stoppedReason,
    ...(args.ceoContext ? { ceoContext: args.ceoContext } : {}),
    activeToolkits: args.activeToolkits,
    files,
  };
  const manifestPath = path.join(BUILDS_DIR(args.employeeId), `${args.buildId}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

/** All build manifests for an employee, oldest → newest with a 1-indexed `version` label. */
export function listBuilds(
  employeeId: string
): Array<BuildManifest & { version: number }> {
  let entries: string[];
  try {
    entries = fs.readdirSync(BUILDS_DIR(employeeId));
  } catch {
    return [];
  }
  const manifests = entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const raw = fs.readFileSync(
          path.join(BUILDS_DIR(employeeId), f),
          "utf-8"
        );
        return JSON.parse(raw) as BuildManifest;
      } catch {
        return null;
      }
    })
    .filter((x): x is BuildManifest => x !== null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return manifests.map((m, i) => ({ ...m, version: i + 1 }));
}

export function getBuild(
  employeeId: string,
  buildId: string
): (BuildManifest & { version: number }) | null {
  const all = listBuilds(employeeId);
  return all.find((b) => b.buildId === buildId) ?? null;
}

// ─── Restores ────────────────────────────────────────────────────────────────

/**
 * Copy a historical version back into the employee root. The current root
 * body is snapshotted as a "restore" entry first so the restore is itself
 * reversible.
 */
export function restoreFile(
  employeeId: string,
  filename: TwinFileName,
  ts: string
): { ok: boolean; error?: string } {
  const body = readFileVersion(employeeId, filename, ts);
  if (body === null) return { ok: false, error: "version not found" };

  // Snapshot whatever's currently at root, marked as "restore" so the user
  // can undo by restoring the previous live version.
  snapshotRootFile(employeeId, filename, "restore", { restoredFromTs: ts });

  const rootFile = path.join(ROOT(employeeId), filename);
  fs.mkdirSync(ROOT(employeeId), { recursive: true });
  fs.writeFileSync(rootFile, body, "utf-8");
  return { ok: true };
}

export function restoreBuild(
  employeeId: string,
  buildId: string
): { ok: boolean; error?: string; restored: TwinFileName[] } {
  const manifest = getBuild(employeeId, buildId);
  if (!manifest) return { ok: false, error: "build not found", restored: [] };

  const restored: TwinFileName[] = [];
  for (const f of manifest.files) {
    const result = restoreFile(employeeId, f.filename, f.snapshotTs);
    if (result.ok) restored.push(f.filename);
  }
  return { ok: true, restored };
}

// ─── Active builds + event log persistence ───────────────────────────────────
//
// These exist so a CEO can leave the /twin-build page (or the whole app)
// while a build is in flight, and reattach later. Events are append-only on
// disk per build; the active-builds index points at the in-flight one per
// employee. Both are removed on completion.

export type ActiveBuildEntry = {
  employeeId: string;
  buildId: string;
  startedAt: string;
  /** Set when the runner starts; bumped on every persisted event. */
  lastEventTs: number;
  /** Cumulative event count for this build. */
  eventCount: number;
  /** Snapshot of fields the UI banner wants without parsing the events file. */
  filesWritten: number;
  filesTotal: number;
  costUsd: number;
  /** Optional CEO context that triggered the build. */
  ceoContext?: string;
};

function readActiveBuilds(): Record<string, ActiveBuildEntry> {
  try {
    const raw = fs.readFileSync(ACTIVE_BUILDS_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, ActiveBuildEntry>;
  } catch {
    return {};
  }
}

function writeActiveBuilds(map: Record<string, ActiveBuildEntry>): void {
  fs.mkdirSync(path.dirname(ACTIVE_BUILDS_FILE), { recursive: true });
  fs.writeFileSync(ACTIVE_BUILDS_FILE, JSON.stringify(map, null, 2));
}

export function listActiveBuilds(): ActiveBuildEntry[] {
  return Object.values(readActiveBuilds());
}

export function getActiveBuild(employeeId: string): ActiveBuildEntry | null {
  return readActiveBuilds()[employeeId] ?? null;
}

export function markBuildActive(entry: ActiveBuildEntry): void {
  const map = readActiveBuilds();
  map[entry.employeeId] = entry;
  writeActiveBuilds(map);
}

export function bumpBuildActivity(
  employeeId: string,
  patch: Partial<
    Pick<
      ActiveBuildEntry,
      "lastEventTs" | "eventCount" | "filesWritten" | "filesTotal" | "costUsd"
    >
  >
): void {
  const map = readActiveBuilds();
  const cur = map[employeeId];
  if (!cur) return;
  map[employeeId] = { ...cur, ...patch };
  writeActiveBuilds(map);
}

export function clearBuildActive(employeeId: string): void {
  const map = readActiveBuilds();
  delete map[employeeId];
  writeActiveBuilds(map);
}

/** Append one event (any JSON-serializable shape) to the per-build log. */
export function appendBuildEvent(
  employeeId: string,
  buildId: string,
  event: unknown
): void {
  ensureDirs(employeeId);
  fs.mkdirSync(BUILDS_DIR(employeeId), { recursive: true });
  fs.appendFileSync(
    EVENTS_FILE(employeeId, buildId),
    JSON.stringify(event) + "\n"
  );
}

/**
 * Read events from a build's log file starting at byte offset `fromOffset`.
 * Returns the events parsed up to the last newline boundary plus the new
 * offset so the caller can resume tailing without re-parsing earlier lines.
 */
export function readBuildEvents(
  employeeId: string,
  buildId: string,
  fromOffset = 0
): { events: unknown[]; nextOffset: number; sizeBytes: number } {
  const file = EVENTS_FILE(employeeId, buildId);
  let raw: Buffer;
  try {
    raw = fs.readFileSync(file);
  } catch {
    return { events: [], nextOffset: 0, sizeBytes: 0 };
  }
  const sizeBytes = raw.byteLength;
  if (fromOffset >= sizeBytes) {
    return { events: [], nextOffset: sizeBytes, sizeBytes };
  }
  const slice = raw.subarray(fromOffset);
  const text = slice.toString("utf-8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    // No complete line yet; don't advance the offset.
    return { events: [], nextOffset: fromOffset, sizeBytes };
  }
  const consumed = lastNewline + 1;
  const lines = text.slice(0, consumed).split("\n").filter(Boolean);
  const events = lines
    .map((l) => {
      try {
        return JSON.parse(l) as unknown;
      } catch {
        return null;
      }
    })
    .filter((x): x is unknown => x !== null);
  return { events, nextOffset: fromOffset + consumed, sizeBytes };
}
