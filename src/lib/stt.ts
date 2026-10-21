// Speech to text: the pure parts of POST /api/stt and of the voice input on
// Ask. The route forwards one recorded clip to ElevenLabs Speech to Text
// (Scribe); these helpers decide what it accepts, so they stay testable
// without a key, a network or a microphone.

/** Scribe v2 is ElevenLabs' current batch STT model (scribe_v1 is deprecated).
 *  Set ELEVENLABS_STT_MODEL to override. */
export const STT_DEFAULT_MODEL = "scribe_v2";

export function sttModel(): string {
  return process.env.ELEVENLABS_STT_MODEL?.trim() || STT_DEFAULT_MODEL;
}

/** A spoken question, not a meeting: 10 MB is minutes of Opus audio. */
export const STT_MAX_BYTES = 10 * 1024 * 1024;
/** Under this there is no speech worth sending (Scribe needs at least 100ms). */
export const STT_MIN_BYTES = 1024;
/** Multipart framing around the clip (boundaries, headers, the language field). */
export const STT_FORM_OVERHEAD = 16 * 1024;

/** What browsers' MediaRecorder produces (webm/ogg Opus, mp4/AAC) plus the
 *  common audio files. Parameters such as `;codecs=opus` are ignored. */
export const STT_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/flac",
] as const;

/** `audio/webm;codecs=opus` → `audio/webm`. */
export function baseMime(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

/** A file name for the upstream upload, so the format is unambiguous. */
export function sttFileName(type: string): string {
  return `question.${EXT[baseMime(type)] ?? "webm"}`;
}

export type SttUploadError = "missing" | "too_small" | "too_large" | "bad_type" | "bad_language";

export type SttUpload = { size: number; type: string; language?: string | null };

/** ISO-639-1 or ISO-639-3, as Scribe takes it. */
const LANG = /^[a-z]{2,3}$/;

/** Checks one uploaded clip. Returns null when it may be forwarded. */
export function validateSttUpload(upload: SttUpload | null | undefined): SttUploadError | null {
  if (!upload) return "missing";
  if (!(STT_MIME_TYPES as readonly string[]).includes(baseMime(upload.type))) return "bad_type";
  if (upload.size < STT_MIN_BYTES) return "too_small";
  if (upload.size > STT_MAX_BYTES) return "too_large";
  if (upload.language != null && upload.language !== "" && !LANG.test(upload.language)) return "bad_language";
  return null;
}

export const STT_ERROR_STATUS: Record<SttUploadError, number> = {
  missing: 400,
  too_small: 400,
  too_large: 413,
  bad_type: 415,
  bad_language: 400,
};

/** Rejects a body by its declared length before reading any of it. */
export function declaredTooLarge(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const n = Number(contentLength);
  return Number.isFinite(n) && n > STT_MAX_BYTES + STT_FORM_OVERHEAD;
}

/** Reads a request body up to `cap` bytes; null when it is longer (the
 *  declared length can be absent or wrong, so the cap is enforced here too). */
export async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The transcript out of a Scribe response, trimmed; "" when there is none. */
export function transcriptOf(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const text = (json as { text?: unknown }).text;
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

/* ── end of speech, for the recorder on the client ── */

/** Input level (0..1) above which the CEO is talking, and below which it is quiet. */
export const SPEECH_LEVEL = 0.08;
export const QUIET_LEVEL = 0.04;
/** Quiet this long after speech ends the question. */
export const SILENCE_MS = 1600;
/** No speech at all this long: give up without sending anything. */
export const NO_SPEECH_MS = 8000;
/** A question is never longer than this. */
export const MAX_RECORD_MS = 60_000;

export type SilenceState = { startedAt: number; heardAt: number | null; quietSince: number | null };
export type SilenceAction = "none" | "stop" | "cancel";

export function silenceStart(now: number): SilenceState {
  return { startedAt: now, heardAt: null, quietSince: null };
}

/** One meter reading: decides whether to keep listening, stop and send, or cancel. */
export function silenceStep(s: SilenceState, level: number, now: number): { state: SilenceState; action: SilenceAction } {
  if (now - s.startedAt >= MAX_RECORD_MS) return { state: s, action: s.heardAt === null ? "cancel" : "stop" };
  if (level >= SPEECH_LEVEL) return { state: { ...s, heardAt: now, quietSince: null }, action: "none" };
  if (s.heardAt === null) return { state: s, action: now - s.startedAt >= NO_SPEECH_MS ? "cancel" : "none" };
  if (level < QUIET_LEVEL) {
    const quietSince = s.quietSince ?? now;
    return { state: { ...s, quietSince }, action: now - quietSince >= SILENCE_MS ? "stop" : "none" };
  }
  return { state: { ...s, quietSince: null }, action: "none" };
}
