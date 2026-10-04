import "server-only";
import fs from "fs";
import path from "path";
import { safeIso } from "./twin-versions";
import { dataDir } from "./app-home";

// Snapshots of text files in a twin's knowledge/ directory.
//
//   data/employees/{id}/.versions/knowledge/
//     _log.jsonl
//     notes.md/
//       2026-10-04T08-29-12-345Z.md
//
// Binaries (pdf, docx, …) are not snapshotted. Their extracted `.md`
// companions are ordinary text files and are. Each file keeps its last
// 50 snapshots; older ones are deleted. Profile versions under
// .versions/files stay on their own log and are not touched here.

/** Same set as KNOWLEDGE_TEXT_EXTS in knowledge-files.ts. */
const TEXT_EXTS: readonly string[] = [".md", ".markdown", ".txt", ".csv", ".json"];

const SNAPSHOTS_PER_FILE = 50;

const SNAPSHOT_TS = /^[0-9A-Za-z\-]+Z(-\d+)?$/;

export type KnowledgeSnapshotSource = "edit" | "delete" | "restore";

export type KnowledgeVersionEntry = {
  ts: string;
  name: string;
  sizeBytes: number;
  source: KnowledgeSnapshotSource;
};

/**
 * Sanitize one path segment: keep [a-zA-Z0-9._-]. Returns null for empty,
 * traversal, or separator-bearing input. Same rules the knowledge writer uses.
 */
export function sanitizeKnowledgeSegment(name: string): string | null {
  if (typeof name !== "string") return null;
  if (name.includes("/") || name.includes("\\")) return null;
  if (name.includes("..")) return null;
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  if (cleaned.includes("..")) return null;
  return cleaned;
}

/** Directory segment for an employee id. Invalid ids land in `_invalid`. */
export function knowledgeEmployeeSegment(employeeId: string): string {
  return sanitizeKnowledgeSegment(employeeId) ?? "_invalid";
}

/**
 * A knowledge filename that is already safe and is a text extension.
 * Names that would be rewritten (spaces, slashes, `..`) are rejected so a
 * request cannot alias onto a different file.
 */
export function canonicalKnowledgeTextName(name: string): string | null {
  const clean = sanitizeKnowledgeSegment(name);
  if (!clean || clean !== name) return null;
  if (!TEXT_EXTS.includes(path.extname(clean).toLowerCase())) return null;
  return clean;
}

function versionsRoot(employeeId: string): string {
  return path.join(
    dataDir("employees"),
    knowledgeEmployeeSegment(employeeId),
    ".versions",
    "knowledge",
  );
}

function logPath(employeeId: string): string {
  return path.join(versionsRoot(employeeId), "_log.jsonl");
}

function knowledgeFilePath(employeeId: string, name: string): string {
  return path.join(
    dataDir("employees"),
    knowledgeEmployeeSegment(employeeId),
    "knowledge",
    name,
  );
}

function snapshotFilePath(employeeId: string, name: string, ts: string): string | null {
  const clean = canonicalKnowledgeTextName(name);
  if (!clean || !SNAPSHOT_TS.test(ts)) return null;
  const ext = path.extname(clean).toLowerCase();
  return path.join(versionsRoot(employeeId), clean, `${ts}${ext}`);
}

function isSource(value: unknown): value is KnowledgeSnapshotSource {
  return value === "edit" || value === "delete" || value === "restore";
}

function readLog(employeeId: string): KnowledgeVersionEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(logPath(employeeId), "utf-8");
  } catch {
    return [];
  }
  const entries: KnowledgeVersionEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as {
        ts?: unknown;
        name?: unknown;
        sizeBytes?: unknown;
        source?: unknown;
      };
      if (
        typeof parsed.ts !== "string" ||
        typeof parsed.name !== "string" ||
        typeof parsed.sizeBytes !== "number" ||
        !isSource(parsed.source)
      ) {
        continue;
      }
      entries.push({
        ts: parsed.ts,
        name: parsed.name,
        sizeBytes: parsed.sizeBytes,
        source: parsed.source,
      });
    } catch {
      /* skip a torn line */
    }
  }
  return entries;
}

function writeLog(employeeId: string, entries: KnowledgeVersionEntry[]): void {
  const body = entries
    .map((entry) =>
      JSON.stringify({
        ts: entry.ts,
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        source: entry.source,
      }),
    )
    .join("\n");
  fs.mkdirSync(versionsRoot(employeeId), { recursive: true });
  fs.writeFileSync(logPath(employeeId), body.length > 0 ? `${body}\n` : "", "utf-8");
}

function pruneFile(employeeId: string, name: string): void {
  const all = readLog(employeeId);
  const indexes: number[] = [];
  all.forEach((entry, index) => {
    if (entry.name === name) indexes.push(index);
  });
  if (indexes.length <= SNAPSHOTS_PER_FILE) return;
  const drop = new Set(indexes.slice(0, indexes.length - SNAPSHOTS_PER_FILE));
  for (const index of drop) {
    const file = snapshotFilePath(employeeId, all[index].name, all[index].ts);
    if (file) fs.rmSync(file, { force: true });
  }
  writeLog(
    employeeId,
    all.filter((_, index) => !drop.has(index)),
  );
}

/**
 * Save `body` as a text snapshot. Returns the snapshot ts, or null when
 * `name` is not a safe text knowledge filename. No-ops for binaries.
 */
export function snapshotKnowledgeText(
  employeeId: string,
  name: string,
  body: string,
  source: KnowledgeSnapshotSource,
  at?: Date,
): string | null {
  const clean = canonicalKnowledgeTextName(name);
  if (!clean || typeof body !== "string") return null;
  const ext = path.extname(clean).toLowerCase();
  const dir = path.join(versionsRoot(employeeId), clean);
  fs.mkdirSync(dir, { recursive: true });

  const ts = safeIso(at ?? new Date());
  let finalTs = ts;
  let finalPath = path.join(dir, `${finalTs}${ext}`);
  let i = 0;
  while (fs.existsSync(finalPath)) {
    i += 1;
    finalTs = `${ts}-${i}`;
    finalPath = path.join(dir, `${finalTs}${ext}`);
  }
  fs.writeFileSync(finalPath, body, "utf-8");

  const entry: KnowledgeVersionEntry = {
    ts: finalTs,
    name: clean,
    sizeBytes: Buffer.byteLength(body, "utf-8"),
    source,
  };
  fs.mkdirSync(versionsRoot(employeeId), { recursive: true });
  fs.appendFileSync(logPath(employeeId), JSON.stringify(entry) + "\n");
  pruneFile(employeeId, clean);
  return finalTs;
}

/** Versions of one knowledge file, newest first. */
export function listKnowledgeVersions(
  employeeId: string,
  name: string,
): KnowledgeVersionEntry[] {
  const clean = canonicalKnowledgeTextName(name);
  if (!clean) return [];
  return readLog(employeeId)
    .filter((entry) => {
      if (entry.name !== clean) return false;
      const file = snapshotFilePath(employeeId, clean, entry.ts);
      return file !== null && fs.existsSync(file);
    })
    .reverse();
}

/** Snapshot body, or null when the name, ts, or file is missing. */
export function readKnowledgeVersion(
  employeeId: string,
  name: string,
  ts: string,
): string | null {
  const file = snapshotFilePath(employeeId, name, ts);
  if (!file) return null;
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Copy a snapshot back into knowledge/. The live body is snapshotted first
 * with source "restore" when the file still exists, so the restore itself
 * can be undone. A missing file is recreated.
 */
export function restoreKnowledgeVersion(
  employeeId: string,
  name: string,
  ts: string,
): { ok: boolean; error?: string } {
  const clean = canonicalKnowledgeTextName(name);
  if (!clean) return { ok: false, error: "invalid file name or unsupported extension" };
  const body = readKnowledgeVersion(employeeId, clean, ts);
  if (body === null) return { ok: false, error: "version not found" };

  const full = knowledgeFilePath(employeeId, clean);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    snapshotKnowledgeText(employeeId, clean, fs.readFileSync(full, "utf-8"), "restore");
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
  return { ok: true };
}

/**
 * Latest delete snapshot per name that is not currently in knowledge/.
 * Newest deletion first.
 */
export function listRecentlyDeletedKnowledge(employeeId: string): KnowledgeVersionEntry[] {
  let live = new Set<string>();
  const dir = path.join(
    dataDir("employees"),
    knowledgeEmployeeSegment(employeeId),
    "knowledge",
  );
  try {
    live = new Set(
      fs.readdirSync(dir).filter((entry) => {
        try {
          return fs.statSync(path.join(dir, entry)).isFile();
        } catch {
          return false;
        }
      }),
    );
  } catch {
    live = new Set();
  }

  const log = readLog(employeeId);
  const seen = new Set<string>();
  const result: KnowledgeVersionEntry[] = [];
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index];
    if (entry.source !== "delete" || seen.has(entry.name)) continue;
    if (live.has(entry.name)) {
      seen.add(entry.name);
      continue;
    }
    const file = snapshotFilePath(employeeId, entry.name, entry.ts);
    if (!file || !fs.existsSync(file)) continue;
    seen.add(entry.name);
    result.push(entry);
  }
  return result;
}
