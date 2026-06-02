import fs from "fs";
import path from "path";

const EMPLOYEES_DATA_DIR = path.join(process.cwd(), "data", "employees");

export type KnowledgeFile = {
  name: string;
  size: number;
  tokens: number;
  ext: string;
  mtime: string;
};

/** Text extensions that are both editable in-app and readable by the agent. */
export const KNOWLEDGE_TEXT_EXTS: readonly string[] = [
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".json",
];

/** Max upload size: 25 MB. */
export const KNOWLEDGE_MAX_BYTES: number = 25 * 1024 * 1024;

/**
 * Executable / script extensions that must never be written to the knowledge
 * directory regardless of how they arrive. Note: .json is a TEXT file (allowed),
 * but .js / .mjs / .cjs / .ts are treated as executable/script and blocked here.
 */
const KNOWLEDGE_EXEC_BLOCKLIST: readonly string[] = [
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".sh",
  ".ps1",
  ".psm1",
  ".app",
  ".dmg",
  ".pkg",
  ".jar",
  ".com",
  ".scr",
  ".vbs",
  ".vbe",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".bin",
  ".deb",
  ".rpm",
  ".apk",
];

/**
 * Sanitize a filename: keep only [a-zA-Z0-9._-], replacing any other character
 * with "-". Returns null if the result is unsafe (empty, traversal, or a path
 * segment). Never allows "/" or "..".
 */
function safeName(name: string): string | null {
  if (typeof name !== "string") return null;
  // Reject anything that contains a path separator before sanitizing so we
  // never silently flatten "a/b" into "a-b".
  if (name.includes("/") || name.includes("\\")) return null;
  if (name.includes("..")) return null;
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  if (cleaned.includes("..")) return null;
  return cleaned;
}

function extOf(name: string): string {
  return path.extname(name).toLowerCase();
}

function isTextExt(ext: string): boolean {
  return KNOWLEDGE_TEXT_EXTS.includes(ext);
}

function isBlockedExt(ext: string): boolean {
  return KNOWLEDGE_EXEC_BLOCKLIST.includes(ext);
}

function approxTokens(byteLength: number): number {
  return Math.round(byteLength / 4);
}

/** Absolute path to the knowledge dir for an employee. Creates it on demand. */
export function knowledgeDir(employeeId: string): string {
  const safeId = safeName(employeeId) ?? "_invalid";
  const dir = path.join(EMPLOYEES_DATA_DIR, safeId, "knowledge");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort; caller fs ops will surface real errors */
  }
  return dir;
}

function statToKnowledgeFile(dir: string, name: string): KnowledgeFile | null {
  try {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (!stat.isFile()) return null;
    const ext = extOf(name);
    return {
      name,
      size: stat.size,
      tokens: approxTokens(stat.size),
      ext,
      mtime: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

/** List all knowledge files for an employee, newest-first. */
export function listKnowledgeFiles(employeeId: string): KnowledgeFile[] {
  try {
    const dir = knowledgeDir(employeeId);
    const entries = fs.readdirSync(dir);
    const files: KnowledgeFile[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const kf = statToKnowledgeFile(dir, entry);
      if (kf) files.push(kf);
    }
    files.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return files;
  } catch {
    return [];
  }
}

/** Read a TEXT knowledge file. Returns null for missing/binary/invalid. */
export function readKnowledgeFile(
  employeeId: string,
  name: string
): { body: string; meta: KnowledgeFile } | null {
  const clean = safeName(name);
  if (!clean) return null;
  const ext = extOf(clean);
  if (!isTextExt(ext)) return null;
  try {
    const dir = knowledgeDir(employeeId);
    const full = path.join(dir, clean);
    const stat = fs.statSync(full);
    if (!stat.isFile()) return null;
    const body = fs.readFileSync(full, "utf-8");
    return {
      body,
      meta: {
        name: clean,
        size: stat.size,
        tokens: approxTokens(stat.size),
        ext,
        mtime: stat.mtime.toISOString(),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Create or update a TEXT knowledge file. Returns the resulting metadata, or
 * null on an invalid name/ext. Throws only on genuine disk errors so callers
 * can map EACCES/ENOSPC/EROFS to a structured response.
 */
export function writeKnowledgeFile(
  employeeId: string,
  name: string,
  body: string
): KnowledgeFile | null {
  const clean = safeName(name);
  if (!clean) return null;
  const ext = extOf(clean);
  if (!isTextExt(ext)) return null;
  if (isBlockedExt(ext)) return null;
  if (typeof body !== "string") return null;

  const dir = knowledgeDir(employeeId);
  const full = path.join(dir, clean);
  fs.writeFileSync(full, body, "utf-8");
  return statToKnowledgeFile(dir, clean);
}

/**
 * Persist an uploaded file. Validates size, extension (text OR any non-blocked
 * binary), and the executable blocklist. On a name collision, suffixes the
 * basename with -1, -2, … Returns the saved metadata or a structured error.
 * Never throws — disk errors are returned as { error }.
 */
export function saveUploadedKnowledgeFile(
  employeeId: string,
  name: string,
  data: Buffer
): KnowledgeFile | { error: string } {
  const clean = safeName(name);
  if (!clean) return { error: "Invalid file name." };

  const ext = extOf(clean);
  if (isBlockedExt(ext)) {
    return { error: `Files of type ${ext || "(none)"} are not allowed.` };
  }
  if (!Buffer.isBuffer(data)) {
    return { error: "Invalid file data." };
  }
  if (data.length > KNOWLEDGE_MAX_BYTES) {
    return {
      error: `File is too large (max ${Math.round(
        KNOWLEDGE_MAX_BYTES / (1024 * 1024)
      )} MB).`,
    };
  }

  try {
    const dir = knowledgeDir(employeeId);

    // Collision-suffix the basename: report.md -> report-1.md -> report-2.md
    const parsedExt = path.extname(clean);
    const base = parsedExt ? clean.slice(0, -parsedExt.length) : clean;
    let finalName = clean;
    let i = 0;
    while (fs.existsSync(path.join(dir, finalName))) {
      i += 1;
      finalName = `${base}-${i}${parsedExt}`;
    }

    fs.writeFileSync(path.join(dir, finalName), data);
    const kf = statToKnowledgeFile(dir, finalName);
    if (!kf) return { error: "Could not read back the saved file." };
    return kf;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown disk error";
    return { error: message };
  }
}

/** Delete a knowledge file. Returns true on success, false if missing/invalid. */
export function deleteKnowledgeFile(employeeId: string, name: string): boolean {
  const clean = safeName(name);
  if (!clean) return false;
  try {
    const dir = knowledgeDir(employeeId);
    const full = path.join(dir, clean);
    if (!fs.existsSync(full)) return false;
    const stat = fs.statSync(full);
    if (!stat.isFile()) return false;
    fs.unlinkSync(full);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compact markdown bullet list of knowledge files (name + tokens) suitable for
 * injection into the twin's system prompt. Returns "" when there are none.
 */
export function knowledgeIndexMarkdown(employeeId: string): string {
  const files = listKnowledgeFiles(employeeId);
  if (files.length === 0) return "";
  const lines = files.map(
    (f) => `- \`employees/${employeeId}/knowledge/${f.name}\` (~${f.tokens} tokens)`
  );
  return lines.join("\n");
}
