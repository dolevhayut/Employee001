/**
 * In-process store for active Team Meetings.
 *
 * A "meeting" is the long-running conversation the CEO has with multiple
 * twins on the /council page. The transcript is the source of truth that
 * every twin sees on their turn — replacing the earlier model where each
 * CEO ask spawned a fresh isolated runCouncil with no memory of prior asks
 * and twins ran in parallel without seeing each other.
 *
 * Stored in memory only (Map<id, Meeting>). Survives within a single Next.js
 * process but resets on cold restart. Persisting to disk is a follow-up if
 * we need cross-restart durability.
 *
 * Shared files (the "meeting scratch") are written to disk under
 * `data/meetings/<id>/shared/` so a twin's pulled artifact (Drive doc,
 * Slack export, etc.) can be referenced by another twin without paying
 * the prompt cost twice. The disk dir is wiped on cold start since the
 * meeting state itself is in-memory.
 */

import fs from "fs";
import path from "path";

export type MeetingTurn =
  | { kind: "ceo"; text: string; ts: number }
  | {
      kind: "twin";
      employeeId: string;
      employeeName: string;
      text: string;
      ts: number;
      /** Set when this turn fired because another twin tagged @Name. */
      delegatedFromId?: string;
      delegatedFromName?: string;
    };

export type SharedFile = {
  /** Stable id used as the artifact reference in events. */
  id: string;
  /** Final on-disk filename, after sanitization + collision suffixing. */
  filename: string;
  /** One-line description shown to other twins in the prompt. */
  summary: string;
  /** Twin who pulled / produced the file. */
  sharedById: string;
  sharedByName: string;
  sharedAt: number;
  sizeBytes: number;
  /** MIME type — derived from upstream response for binaries, from extension for text. */
  contentType: string;
  /**
   * 'text' = readable by twins via read_meeting_file (CSV/JSON/MD/etc.).
   * 'image' = binary bytes; only previewable in the UI, not text-readable
   *   by other twins. They can still see filename + summary in the prompt
   *   and reference the image conceptually.
   */
  kind: "text" | "image";
};

export type Meeting = {
  id: string;
  /** Twins "in the room" — chips at the top of the council page. Other
   *  twins can still be tagged via @ for delegation but aren't default speakers. */
  participantIds: string[];
  transcript: MeetingTurn[];
  /** Files dropped into the meeting scratch by twins, in chronological order. */
  sharedFiles: SharedFile[];
  createdAt: number;
  updatedAt: number;
};

const meetings = new Map<string, Meeting>();

/** Hard upper bound for a single shared file. Approved by CEO at 25MB. */
export const SHARED_FILE_MAX_BYTES = 25 * 1024 * 1024;

const MEETINGS_ROOT = path.join(process.cwd(), "data", "meetings");

// Cold-start wipe: meeting state is in-memory, so any on-disk shared files
// from a prior process are orphans. Clear them on module load to avoid
// confusion or unbounded disk growth across restarts.
let coldStartWipeDone = false;
function ensureColdStartWipe() {
  if (coldStartWipeDone) return;
  coldStartWipeDone = true;
  try {
    if (fs.existsSync(MEETINGS_ROOT)) {
      fs.rmSync(MEETINGS_ROOT, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn("[meeting-store] cold-start wipe failed:", err);
  }
}
ensureColdStartWipe();

export function createMeeting(participantIds: string[]): Meeting {
  const now = Date.now();
  const meeting: Meeting = {
    id: `mtg_${now}_${Math.random().toString(36).slice(2, 8)}`,
    participantIds,
    transcript: [],
    sharedFiles: [],
    createdAt: now,
    updatedAt: now,
  };
  meetings.set(meeting.id, meeting);
  return meeting;
}

export function getMeeting(id: string): Meeting | undefined {
  return meetings.get(id);
}

/**
 * Idempotent — returns the existing meeting if it exists, otherwise creates a
 * new one with the given participants. Used by the API route so the client
 * can pass `meetingId` blindly without first asking for one.
 */
export function getOrCreateMeeting(
  id: string | undefined,
  participantIds: string[]
): Meeting {
  if (id) {
    const existing = meetings.get(id);
    if (existing) return existing;
  }
  return createMeeting(participantIds);
}

export function appendTurn(meetingId: string, turn: MeetingTurn): void {
  const m = meetings.get(meetingId);
  if (!m) return;
  m.transcript.push(turn);
  m.updatedAt = Date.now();
}

/**
 * Render the transcript as a plain-text block suitable for prompt injection.
 * Each turn is on its own line with a clear speaker label. No truncation —
 * the whole point of the rewrite is that twins see *everything*.
 */
export function renderTranscriptForPrompt(transcript: MeetingTurn[]): string {
  if (transcript.length === 0) return "(meeting just started — no prior turns)";
  return transcript
    .map((t) =>
      t.kind === "ceo"
        ? `CEO: ${t.text}`
        : `${t.employeeName}${
            t.delegatedFromName ? ` (called in by ${t.delegatedFromName})` : ""
          }: ${t.text}`
    )
    .join("\n\n");
}

// ─── Shared files (meeting scratch) ────────────────────────────────────────

/** Reduce an agent-supplied filename to a path-safe basename. */
function sanitizeFilename(raw: string): string {
  const base = path.basename(raw || "").trim();
  // Strip anything that isn't [A-Za-z0-9._-]; collapse repeats; cap length.
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
  const trimmed = cleaned.replace(/^[._-]+|[._-]+$/g, "");
  if (!trimmed) return "file";
  return trimmed.slice(0, 120);
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".csv": "text/csv",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".html": "text/html",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".tsv": "text/tab-separated-values",
};

function guessContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? "text/plain";
}

function sharedDirFor(meetingId: string): string {
  return path.join(MEETINGS_ROOT, meetingId, "shared");
}

/** Resolve `desired` against existing files in the meeting; suffix with _2, _3 on collision. */
function resolveCollision(meetingId: string, desired: string): string {
  const m = meetings.get(meetingId);
  const taken = new Set((m?.sharedFiles ?? []).map((f) => f.filename));
  if (!taken.has(desired)) return desired;
  const ext = path.extname(desired);
  const base = desired.slice(0, desired.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Fallback — extremely unlikely
  return `${base}_${Date.now()}${ext}`;
}

/**
 * Persist a file dropped into the meeting scratch and append it to the
 * meeting record. Accepts either text content (`content` string) or raw
 * binary bytes (`bytes` Buffer + explicit `kind`/`contentType`).
 * Returns the stored SharedFile entry. Throws if the meeting doesn't
 * exist or size exceeds SHARED_FILE_MAX_BYTES.
 */
export function recordSharedFile(
  meetingId: string,
  args:
    | {
        kind?: "text";
        filename: string;
        content: string;
        summary: string;
        sharedById: string;
        sharedByName: string;
      }
    | {
        kind: "image";
        filename: string;
        bytes: Buffer;
        contentType: string;
        summary: string;
        sharedById: string;
        sharedByName: string;
      }
): SharedFile {
  const m = meetings.get(meetingId);
  if (!m) throw new Error(`meeting ${meetingId} not found`);

  const isImage = args.kind === "image";
  const sizeBytes = isImage
    ? args.bytes.length
    : Buffer.byteLength(args.content, "utf8");

  if (sizeBytes > SHARED_FILE_MAX_BYTES) {
    throw new Error(
      `file is ${sizeBytes} bytes, exceeds ${SHARED_FILE_MAX_BYTES}-byte limit`
    );
  }

  const safeName = sanitizeFilename(args.filename);
  const finalName = resolveCollision(meetingId, safeName);

  const dir = sharedDirFor(meetingId);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, finalName);
  if (isImage) {
    fs.writeFileSync(target, args.bytes);
  } else {
    fs.writeFileSync(target, args.content, "utf8");
  }

  const entry: SharedFile = {
    id: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    filename: finalName,
    summary: args.summary.trim(),
    sharedById: args.sharedById,
    sharedByName: args.sharedByName,
    sharedAt: Date.now(),
    sizeBytes,
    contentType: isImage ? args.contentType : guessContentType(finalName),
    kind: isImage ? "image" : "text",
  };

  m.sharedFiles.push(entry);
  m.updatedAt = Date.now();
  return entry;
}

/**
 * Read a previously-shared file by filename. Returns three discrete states
 * so the caller can distinguish "no such file" from "exists but binary" —
 * the agent's error message in those two cases should be very different.
 */
export type ReadSharedFileResult =
  | { status: "not_found" }
  | { status: "binary"; entry: SharedFile }
  | { status: "text"; content: string; entry: SharedFile };

export function readSharedFile(
  meetingId: string,
  filename: string
): ReadSharedFileResult {
  const m = meetings.get(meetingId);
  if (!m) return { status: "not_found" };

  const safeName = sanitizeFilename(filename);
  const entry = m.sharedFiles.find((f) => f.filename === safeName);
  if (!entry) return { status: "not_found" };
  if (entry.kind !== "text") return { status: "binary", entry };

  try {
    const fullPath = path.join(sharedDirFor(meetingId), entry.filename);
    const content = fs.readFileSync(fullPath, "utf8");
    return { status: "text", content, entry };
  } catch {
    return { status: "not_found" };
  }
}

/**
 * Read raw bytes of a shared file. Used by the file-content API route to
 * stream images (and to download text files). Found regardless of kind.
 */
export function readSharedFileBytes(
  meetingId: string,
  filename: string
): { found: false } | { found: true; bytes: Buffer; entry: SharedFile } {
  const m = meetings.get(meetingId);
  if (!m) return { found: false };

  const safeName = sanitizeFilename(filename);
  const entry = m.sharedFiles.find((f) => f.filename === safeName);
  if (!entry) return { found: false };

  try {
    const fullPath = path.join(sharedDirFor(meetingId), entry.filename);
    const bytes = fs.readFileSync(fullPath);
    return { found: true, bytes, entry };
  } catch {
    return { found: false };
  }
}

/** List all shared files for a meeting (in chronological order). */
export function listSharedFiles(meetingId: string): SharedFile[] {
  return meetings.get(meetingId)?.sharedFiles ?? [];
}

/**
 * Render the shared-files index as a prompt block. Twins see filename +
 * summary + author so they can decide whether to call read_meeting_file.
 * Image files are flagged so the agent knows not to attempt to read them.
 */
export function renderSharedFilesForPrompt(files: SharedFile[]): string {
  if (files.length === 0) return "";
  const lines = files.map((f) => {
    const ageSec = Math.max(0, Math.floor((Date.now() - f.sharedAt) / 1000));
    const age =
      ageSec < 60
        ? `${ageSec}s ago`
        : ageSec < 3600
        ? `${Math.floor(ageSec / 60)} min ago`
        : `${Math.floor(ageSec / 3600)} h ago`;
    const sizeKb = Math.max(1, Math.round(f.sizeBytes / 1024));
    const kindLabel =
      f.kind === "image"
        ? `image, ${f.contentType} — visible to the CEO in the chat; you cannot read its bytes`
        : `text — readable via read_meeting_file`;
    return `- \`${f.filename}\` — ${f.summary}\n  (shared by ${f.sharedByName}, ${age}, ${sizeKb} KB, ${kindLabel})`;
  });
  return lines.join("\n");
}
