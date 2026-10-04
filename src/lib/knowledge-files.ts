import "server-only";
import fs from "fs";
import path from "path";
import { Worker } from "node:worker_threads";
import {
  knowledgeEmployeeSegment,
  snapshotKnowledgeText,
  sanitizeKnowledgeSegment,
} from "./knowledge-versions";

function employeesDataDir(): string {
  return path.join(process.cwd(), "data", "employees");
}

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

/** Max extracted text written beside a PDF or DOCX upload: 2 MB. */
export const KNOWLEDGE_EXTRACTED_TEXT_MAX_BYTES: number = 2 * 1024 * 1024;

/** Extraction happens off the request thread and is stopped after this long. */
const KNOWLEDGE_EXTRACTION_TIMEOUT_MS = 30_000;

/** DOCX ZIP declarations are checked before a decompressor sees the archive. */
const DOCX_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const DOCX_MAX_COMPRESSION_RATIO = 200;
const UNSAFE_DOCX_WARNING =
  "This Word file looks unsafe to extract (it expands too much). The original was kept.";

/** First line of every generated `${name}.md` companion; delete checks for it. */
const EXTRACTED_COMPANION_MARKER = "<!-- employee001:extracted -->";

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
  return sanitizeKnowledgeSegment(name);
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
  const safeId = knowledgeEmployeeSegment(employeeId);
  const dir = path.join(employeesDataDir(), safeId, "knowledge");
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
  // Keep the previous text so an edit can be undone. The new body stays
  // only in the live file.
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    const prev = fs.readFileSync(full, "utf-8");
    snapshotKnowledgeText(employeeId, clean, prev, "edit");
  }
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

type ExtractedKnowledgeFile = {
  file: KnowledgeFile;
  truncated: boolean;
};

type ExtractedKnowledgeFileResult =
  | ExtractedKnowledgeFile
  | { warning: string };

type WorkerExtractionResult = { body: string; truncated: boolean };

/**
 * Read ZIP central-directory metadata without inflating any ZIP member. ZIP64
 * archives are rejected conservatively: their 32-bit declarations are not
 * enough to prove they stay inside our limits.
 */
export function isSafeDocxZip(data: Buffer): boolean {
  if (data.length < 22) return false;
  // EOCD is at the end, preceded by at most a 65,535-byte comment.
  const minEocdOffset = Math.max(0, data.length - 65_557);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > data.length) return false;

  const entries = data.readUInt16LE(eocd + 10);
  const centralDirectorySize = data.readUInt32LE(eocd + 12);
  let offset = data.readUInt32LE(eocd + 16);
  if (
    entries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    offset === 0xffffffff ||
    offset + centralDirectorySize > data.length
  ) {
    return false;
  }

  let totalUncompressed = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      return false;
    }
    const compressed = data.readUInt32LE(offset + 20);
    const uncompressed = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      nextOffset > data.length ||
      uncompressed > DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES ||
      (uncompressed > 0 &&
        (compressed === 0 || uncompressed / compressed > DOCX_MAX_COMPRESSION_RATIO))
    ) {
      return false;
    }
    totalUncompressed += uncompressed;
    if (totalUncompressed > DOCX_MAX_UNCOMPRESSED_BYTES) return false;
    offset = nextOffset;
  }
  return true;
}

function extractInWorker(ext: ".pdf" | ".docx", data: Buffer): Promise<WorkerExtractionResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./knowledge-extract.worker.ts", import.meta.url), {
      workerData: { ext, data, maxTextBytes: KNOWLEDGE_EXTRACTED_TEXT_MAX_BYTES },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new Error("Text extraction timed out after 30 seconds."));
      });
    }, KNOWLEDGE_EXTRACTION_TIMEOUT_MS);

    worker.once("message", (result: WorkerExtractionResult) => {
      finish(() => {
        void worker.terminate();
        resolve(result);
      });
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`Text extraction worker exited with code ${code}.`)));
      }
    });
  });
}

/**
 * next dev only: Turbopack's dev bundle can't boot the worker (no
 * __dirname), so extract on the request thread. The DOCX zip-bomb check
 * still runs first; the timeout only stops waiting, it can't stop the work.
 * Production (`employee001 start`) always uses the worker.
 */
async function extractInline(ext: ".pdf" | ".docx", data: Buffer): Promise<WorkerExtractionResult> {
  const { extractKnowledgeText } = await import("@/lib/knowledge-extract-core");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      extractKnowledgeText({ ext, data, maxTextBytes: KNOWLEDGE_EXTRACTED_TEXT_MAX_BYTES }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Text extraction timed out after 30 seconds.")),
          KNOWLEDGE_EXTRACTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort PDF/DOCX extraction. The original upload is retained even if
 * conversion or writing its `${name}.md` companion fails.
 */
export async function extractUploadedKnowledgeFile(
  employeeId: string,
  savedName: string,
  data: Buffer
): Promise<ExtractedKnowledgeFileResult> {
  const ext = extOf(savedName);
  if (ext !== ".pdf" && ext !== ".docx") {
    return { warning: "This file type does not support text extraction." };
  }
  if (ext === ".docx" && !isSafeDocxZip(data)) {
    return { warning: UNSAFE_DOCX_WARNING };
  }

  try {
    const { body, truncated } = await (process.env.NODE_ENV === "production"
      ? extractInWorker(ext, data)
      : extractInline(ext, data));
    const header =
      `${EXTRACTED_COMPANION_MARKER}\n_Text extracted from \`${savedName}\`._\n\n` +
      (truncated ? "> **Note:** Extracted text was truncated to 2 MB.\n\n" : "");
    const markdown = header + body;
    const dir = knowledgeDir(employeeId);
    const companionName = `${savedName}.md`;
    fs.writeFileSync(path.join(dir, companionName), markdown, {
      encoding: "utf-8",
      flag: "wx",
    });
    const file = statToKnowledgeFile(dir, companionName);
    if (!file) {
      return { warning: "Text was extracted but the Markdown companion could not be read." };
    }
    return { file, truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown extraction error";
    console.warn(`[knowledge-extract] ${employeeId}/${savedName}: ${message}`);
    return {
      warning: `The original file was uploaded, but text extraction failed: ${message}`,
    };
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
    const ext = extOf(clean);
    if (isTextExt(ext)) {
      snapshotKnowledgeText(employeeId, clean, fs.readFileSync(full, "utf-8"), "delete");
    }
    // Snapshot an extracted companion before either unlink. Only a file we
    // generated (marker on line 1) goes; a user's own .md stays.
    let companionToDelete: string | null = null;
    if (ext === ".pdf" || ext === ".docx") {
      const companionName = `${clean}.md`;
      const companion = path.join(dir, companionName);
      if (fs.existsSync(companion) && fs.statSync(companion).isFile()) {
        const text = fs.readFileSync(companion, "utf-8");
        if (text.startsWith(EXTRACTED_COMPANION_MARKER)) {
          snapshotKnowledgeText(employeeId, companionName, text, "delete");
          companionToDelete = companion;
        }
      }
    }
    fs.unlinkSync(full);
    if (companionToDelete) fs.unlinkSync(companionToDelete);
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
