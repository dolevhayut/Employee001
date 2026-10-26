/**
 * Store for Team Meetings.
 *
 * A "meeting" is the long-running conversation the CEO has with multiple
 * twins on the /council page. The transcript is the source of truth that
 * every twin sees on their turn — replacing the earlier model where each
 * CEO ask spawned a fresh isolated runCouncil with no memory of prior asks
 * and twins ran in parallel without seeing each other.
 *
 * Meetings are company records, so they persist: each one lives in
 * `data/meetings/<id>/meeting.json`, rewritten atomically (tmp file + rename)
 * on create, on every appended turn, when shared files change and when a
 * summary is stored. The in-memory Map is a cache that keeps one object per
 * meeting, because the council runner holds that object and re-reads its
 * transcript after every turn. Every lookup goes through `load()`, which
 * falls back to disk, so meetings survive restarts and can be continued.
 *
 * Shared files (the "meeting scratch") live next to the record under
 * `data/meetings/<id>/shared/` so a twin's pulled artifact (Drive doc,
 * Slack export, etc.) can be referenced by another twin without paying
 * the prompt cost twice.
 */

import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/app-home";
// Type-only: meeting-summary is server-only and imports this module's types.
import type { MeetingDecision } from "@/lib/meeting-summary";

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

/** A stored "Summarize & decide" result for the meeting's latest discussion. */
export type MeetingSummary = MeetingDecision & {
  generatedAt: number;
  /** Transcript length when it was generated; a longer transcript has turns it doesn't cover. */
  throughTurn: number;
};

export type Meeting = {
  id: string;
  /** First CEO question, trimmed. Empty until the CEO has spoken. */
  title: string;
  /** Twins "in the room" — chips at the top of the council page. Other
   *  twins can still be tagged via @ for delegation but aren't default speakers. */
  participantIds: string[];
  transcript: MeetingTurn[];
  /** Files dropped into the meeting scratch by twins, in chronological order. */
  sharedFiles: SharedFile[];
  summary?: MeetingSummary;
  createdAt: number;
  updatedAt: number;
};

const meetings = new Map<string, Meeting>();

/** Hard upper bound for a single shared file. Approved by CEO at 25MB. */
export const SHARED_FILE_MAX_BYTES = 25 * 1024 * 1024;

const TITLE_MAX = 80;

/** Ids are created as `mtg_<ms>_<rand>`; anything else never touches the disk. */
const MEETING_ID_RE = /^mtg_[A-Za-z0-9_]{1,64}$/;

export function isValidMeetingId(id: unknown): id is string {
  return typeof id === "string" && MEETING_ID_RE.test(id);
}

// Resolved per call: EMPLOYEE001_HOME may change after this module loads.
function meetingsRoot(): string {
  return dataDir("meetings");
}

function meetingDir(id: string): string {
  return path.join(meetingsRoot(), id);
}

function meetingFile(id: string): string {
  return path.join(meetingDir(id), "meeting.json");
}

/** The first CEO question as a one-line title of at most 80 characters. */
export function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…` : flat;
}

/** Write the record via a tmp file + rename, so a crash never leaves half a file. */
function persist(m: Meeting): void {
  fs.mkdirSync(meetingDir(m.id), { recursive: true });
  const target = meetingFile(m.id);
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Persist, but never let a disk error break a live meeting. */
function persistQuietly(m: Meeting): void {
  try {
    persist(m);
  } catch (err) {
    console.warn(`[meeting-store] could not save ${m.id}:`, err);
  }
}

function readFromDisk(id: string): Meeting | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(meetingFile(id), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Meeting>;
    if (parsed.id !== id || !Array.isArray(parsed.transcript)) return undefined;
    const transcript = parsed.transcript as MeetingTurn[];
    const firstCeo = transcript.find((t) => t.kind === "ceo");
    return {
      id,
      title:
        typeof parsed.title === "string" && parsed.title
          ? parsed.title
          : firstCeo
            ? titleFrom(firstCeo.text)
            : "",
      participantIds: Array.isArray(parsed.participantIds)
        ? parsed.participantIds.filter((p): p is string => typeof p === "string")
        : [],
      transcript,
      sharedFiles: Array.isArray(parsed.sharedFiles) ? parsed.sharedFiles : [],
      ...(parsed.summary && typeof parsed.summary === "object" ? { summary: parsed.summary } : {}),
      createdAt: Number(parsed.createdAt) || 0,
      updatedAt: Number(parsed.updatedAt) || Number(parsed.createdAt) || 0,
    };
  } catch (err) {
    console.warn(`[meeting-store] unreadable meeting ${id}:`, err);
    return undefined;
  }
}

/**
 * The one lookup every function uses: cache first, then disk, so a meeting
 * from before a restart is found and stays one shared object. Invalid ids
 * (anything a route passes from a query string) return undefined.
 */
function load(id: string | undefined | null): Meeting | undefined {
  if (!isValidMeetingId(id)) return undefined;
  const cached = meetings.get(id);
  if (cached) return cached;
  const fromDisk = readFromDisk(id);
  if (fromDisk) meetings.set(id, fromDisk);
  return fromDisk;
}

// Older versions kept meetings in memory only, so their `shared/` folders have
// no meeting.json and no owner: nothing can list, continue or redact them.
// createMeeting writes meeting.json before any file can be shared, so a folder
// without one is always such an orphan. Swept once, on the first disk scan.
let orphanSweepDone = false;
function sweepOrphansOnce(ids: string[]): void {
  if (orphanSweepDone) return;
  orphanSweepDone = true;
  for (const id of ids) {
    if (meetings.has(id) || fs.existsSync(meetingFile(id))) continue;
    try {
      fs.rmSync(meetingDir(id), { recursive: true, force: true });
    } catch (err) {
      console.warn(`[meeting-store] could not remove orphaned ${id}:`, err);
    }
  }
}

function idsOnDisk(): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(meetingsRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = entries.filter((e) => e.isDirectory() && isValidMeetingId(e.name)).map((e) => e.name);
  sweepOrphansOnce(ids);
  return ids;
}

export function createMeeting(participantIds: string[]): Meeting {
  const now = Date.now();
  const meeting: Meeting = {
    id: `mtg_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    participantIds,
    transcript: [],
    sharedFiles: [],
    createdAt: now,
    updatedAt: now,
  };
  meetings.set(meeting.id, meeting);
  persistQuietly(meeting);
  return meeting;
}

export function getMeeting(id: string): Meeting | undefined {
  return load(id);
}

/** Every stored meeting, newest activity first. Callers must not mutate the result. */
export function listMeetings(): Meeting[] {
  const ids = new Set([...idsOnDisk(), ...meetings.keys()]);
  const out: Meeting[] = [];
  for (const id of ids) {
    const m = load(id);
    if (m) out.push(m);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** Delete a meeting record and its shared files. True if it existed. */
export function deleteMeeting(id: string): boolean {
  const m = load(id);
  if (!m) return false;
  meetings.delete(m.id);
  fs.rmSync(meetingDir(m.id), { recursive: true, force: true });
  return true;
}

/** Store the latest "Summarize & decide" result on the meeting. */
export function setMeetingSummary(id: string, decision: MeetingDecision): MeetingSummary | undefined {
  const m = load(id);
  if (!m) return undefined;
  // "Summarize again" must not reset what was already sent to Roomate: an
  // action with the same owner and text keeps its sent state.
  const sent = new Map(
    (m.summary?.actions ?? []).filter((a) => a.sentAt).map((a) => [`${a.employeeId}\n${a.action}`, a] as const),
  );
  const summary: MeetingSummary = {
    decision: decision.decision,
    actions: decision.actions.map((a) => {
      const prev = sent.get(`${a.employeeId}\n${a.action}`);
      return prev ? { ...a, sentAt: prev.sentAt, ...(prev.taskId ? { taskId: prev.taskId } : {}) } : a;
    }),
    open: decision.open,
    generatedAt: Date.now(),
    throughTurn: m.transcript.length,
  };
  m.summary = summary;
  persistQuietly(m);
  return summary;
}

export type ActionSendResult =
  | { ok: true; summary: MeetingSummary }
  | {
      ok: false;
      /** not_found: no meeting, summary or action; changed: the action at
       *  that index isn't the one the caller saw (re-summarized in between);
       *  already_sent: claimed before, pass `force` to send again. */
      error: "not_found" | "changed" | "already_sent";
      summary?: MeetingSummary;
    };

type ActionLookup =
  | { ok: true; m: Meeting; summary: MeetingSummary; action: MeetingSummary["actions"][number] }
  | { ok: false; error: "not_found" | "changed"; summary?: MeetingSummary };

function actionAt(id: string, index: number, expectedAction: string): ActionLookup {
  const m = load(id);
  const summary = m?.summary;
  if (!m || !summary || !Number.isInteger(index) || index < 0) return { ok: false, error: "not_found", summary };
  const action = summary.actions[index];
  if (!action) return { ok: false, error: "not_found", summary };
  if (action.action !== expectedAction) return { ok: false, error: "changed", summary };
  return { ok: true, m, summary, action };
}

/**
 * Claim a summary action for "Send to Roomate" before the owner's twin runs,
 * so a reload mid-run still shows it as sent and nobody files it twice by
 * accident. `expectedAction` is the text the caller saw: a summary
 * regenerated in between can shift indexes. A new claim clears an old task id.
 */
export function markActionSent(
  id: string,
  index: number,
  expectedAction: string,
  opts: { force?: boolean; now?: number } = {},
): ActionSendResult {
  const found = actionAt(id, index, expectedAction);
  if (!found.ok) return found;
  const { m, summary, action } = found;
  if (action.sentAt && !opts.force) return { ok: false, error: "already_sent", summary };
  const { taskId: _previous, ...rest } = action;
  void _previous;
  summary.actions[index] = { ...rest, sentAt: opts.now ?? Date.now() };
  persistQuietly(m);
  return { ok: true, summary };
}

/** Store the Roomate task id the owner's twin reported for a sent action. */
export function recordActionTaskId(id: string, index: number, expectedAction: string, taskId: string): ActionSendResult {
  const found = actionAt(id, index, expectedAction);
  if (!found.ok) return found;
  const { m, summary, action } = found;
  summary.actions[index] = { ...action, sentAt: action.sentAt ?? Date.now(), taskId };
  persistQuietly(m);
  return { ok: true, summary };
}

/** Undo a claim whose twin run never started (it can be sent again freely). */
export function releaseActionSent(id: string, index: number, expectedAction: string): ActionSendResult {
  const found = actionAt(id, index, expectedAction);
  if (!found.ok) return found;
  const { m, summary, action } = found;
  if (action.taskId) return { ok: true, summary };
  const { sentAt: _sentAt, ...rest } = action;
  void _sentAt;
  summary.actions[index] = rest;
  persistQuietly(m);
  return { ok: true, summary };
}

/**
 * Idempotent — returns the existing meeting if it exists (in memory or on
 * disk), otherwise creates a new one with the given participants. Used by
 * the API route so the client can pass `meetingId` blindly without first
 * asking for one, and to continue a meeting from history.
 */
export function getOrCreateMeeting(
  id: string | undefined,
  participantIds: string[]
): Meeting {
  const existing = load(id);
  if (existing) return existing;
  return createMeeting(participantIds);
}

export function appendTurn(meetingId: string, turn: MeetingTurn): void {
  // By id, not by object: a meeting deleted mid-run must stay deleted.
  const m = load(meetingId);
  if (!m) return;
  m.transcript.push(turn);
  if (!m.title && turn.kind === "ceo") m.title = titleFrom(turn.text);
  m.updatedAt = Date.now();
  persistQuietly(m);
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
  return path.join(meetingDir(meetingId), "shared");
}

/** Resolve `desired` against existing files in the meeting; suffix with _2, _3 on collision. */
function resolveCollision(meetingId: string, desired: string): string {
  const m = load(meetingId);
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
  const m = load(meetingId);
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
  const finalName = resolveCollision(m.id, safeName);

  const dir = sharedDirFor(m.id);
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
  persistQuietly(m);
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
  const m = load(meetingId);
  if (!m) return { status: "not_found" };

  const safeName = sanitizeFilename(filename);
  const entry = m.sharedFiles.find((f) => f.filename === safeName);
  if (!entry) return { status: "not_found" };
  if (entry.kind !== "text") return { status: "binary", entry };

  try {
    const fullPath = path.join(sharedDirFor(m.id), entry.filename);
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
  const m = load(meetingId);
  if (!m) return { found: false };

  const safeName = sanitizeFilename(filename);
  const entry = m.sharedFiles.find((f) => f.filename === safeName);
  if (!entry) return { found: false };

  try {
    const fullPath = path.join(sharedDirFor(m.id), entry.filename);
    const bytes = fs.readFileSync(fullPath);
    return { found: true, bytes, entry };
  } catch {
    return { found: false };
  }
}

/** List all shared files for a meeting (in chronological order). */
export function listSharedFiles(meetingId: string): SharedFile[] {
  return load(meetingId)?.sharedFiles ?? [];
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

const FORMER = "[former employee]";

/**
 * Remove a deleted employee from every stored meeting (in memory and on
 * disk): their turns are blanked (the meeting belongs to the company, so
 * others' turns stay), they leave the participant list, files they shared
 * are deleted, and the stored summary is dropped, since it can name them or
 * assign them actions (it is regenerated on demand). `mentions`, when given,
 * also replaces their name or id in the remaining text with
 * "[former employee]", the rule the purge applies to memory and the org
 * brain. Every changed meeting is rewritten on disk.
 */
export function redactEmployeeFromMeetings(
  employeeId: string,
  opts: { mentions?: RegExp } = {}
): { turns: number; files: number; meetings: number } {
  let turns = 0;
  let files = 0;
  let touched = 0;
  const flags = (opts.mentions?.flags ?? "").replace("g", "");
  const finds = opts.mentions ? new RegExp(opts.mentions.source, flags) : undefined;
  const replaces = opts.mentions ? new RegExp(opts.mentions.source, `${flags}g`) : undefined;
  const scrub = (text: string) => (replaces ? text.replace(replaces, FORMER) : text);

  for (const m of listMeetings()) {
    const before = JSON.stringify(m);
    const involved =
      m.participantIds.includes(employeeId) ||
      before.includes(JSON.stringify(employeeId)) ||
      Boolean(finds?.test(before));
    if (!involved) continue;

    m.participantIds = m.participantIds.filter((id) => id !== employeeId);
    m.transcript = m.transcript.map((t): MeetingTurn => {
      if (t.kind === "ceo") return { ...t, text: scrub(t.text) };
      if (t.employeeId === employeeId) {
        turns++;
        return {
          kind: "twin",
          employeeId: "[deleted]",
          employeeName: "[deleted]",
          text: "[removed: this employee's data was deleted]",
          ts: t.ts,
        };
      }
      const next: MeetingTurn = { ...t, text: scrub(t.text) };
      if (t.delegatedFromId === employeeId) {
        delete next.delegatedFromId;
        next.delegatedFromName = "[deleted]";
      }
      return next;
    });
    m.sharedFiles = m.sharedFiles
      .filter((f) => {
        if (f.sharedById !== employeeId) return true;
        try {
          fs.rmSync(path.join(sharedDirFor(m.id), f.filename), { force: true });
        } catch {
          /* already gone */
        }
        files++;
        return false;
      })
      .map((f) => ({ ...f, summary: scrub(f.summary) }));
    m.title = scrub(m.title);
    delete m.summary;

    if (JSON.stringify(m) !== before) {
      touched++;
      persist(m);
    }
  }
  return { turns, files, meetings: touched };
}
