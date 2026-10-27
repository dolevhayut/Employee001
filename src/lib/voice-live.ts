// Live voice on Ask: the server's side of it. The browser streams the mic to
// ElevenLabs Scribe v2 Realtime and plays Eleven v4 Turbo speech straight from
// ElevenLabs over WebSockets; the server only mints the single-use tokens those
// sockets open with, so the API key never reaches the browser. The twin itself
// keeps running here (runSingleTwin via /api/twin/chat): ElevenLabs does speech
// in and speech out, nothing else.
//
// Off with the rest of voice (EMPLOYEE001_VOICE=off), and in EU mode even when
// ELEVENLABS_BASE_URL points at the EU residency endpoint: the batch voice
// routes keep working there, live voice stays off until it's been checked
// against wss://api.eu.residency.elevenlabs.io. EMPLOYEE001_VOICE_LIVE=off
// falls back to record-then-transcribe everywhere.

import { elevenLabsBase, euRegion, voiceEnabled } from "@/lib/data-residency";
import { STT_SAMPLE_RATE, TTS_SAMPLE_RATE } from "@/lib/pcm";
import { isStockVoice } from "@/lib/employees";
import { loadVoiceConsent } from "@/lib/employees-disk";

type Env = Record<string, string | undefined>;

/** ElevenLabs' realtime STT model (the only one the realtime endpoint takes). */
export const STT_REALTIME_MODEL = "scribe_v2_realtime";
/** Eleven v4 Turbo: the v4 family for interactive use, ~100ms inference. */
export const TTS_LIVE_DEFAULT_MODEL = "eleven_v4_turbo";
/** Quiet this long ends the question (ElevenLabs' default is 1.5s). */
export const VAD_SILENCE_SECS = 1.2;
/** Voice used when the twin has none of its own: Sarah, soft and conversational. */
export const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export type TokenType = "realtime_scribe" | "ttd_websocket";

export function liveVoiceEnabled(env: Env = process.env): boolean {
  if (!voiceEnabled(env) || euRegion(env)) return false;
  return env.EMPLOYEE001_VOICE_LIVE?.trim().toLowerCase() !== "off";
}

export function liveTtsModel(env: Env = process.env): string {
  return env.ELEVENLABS_LIVE_TTS_MODEL?.trim() || TTS_LIVE_DEFAULT_MODEL;
}

/** The WebSocket origin matching the REST base (https → wss). */
export function elevenLabsWsBase(env: Env = process.env): string {
  return elevenLabsBase(env).replace(/^http/i, "ws");
}

const VOICE_ID = /^[A-Za-z0-9]{1,64}$/;
const LANG = /^[a-z]{2,3}$/;

/** The twin's voice, the install's default, or Sarah. Anything that isn't an
 *  ElevenLabs voice id is ignored. */
export function liveVoiceId(requested: unknown, env: Env = process.env): string {
  if (typeof requested === "string" && VOICE_ID.test(requested)) return requested;
  const configured = env.ELEVENLABS_VOICE_ID?.trim();
  return configured && VOICE_ID.test(configured) ? configured : DEFAULT_VOICE_ID;
}

export const VOICE_CONSENT_REQUIRED_MESSAGE =
  "This voice isn't cleared for use: no recorded consent from the person it belongs to. Using the default voice instead.";

/** Employee ids come from the request; keep them to a safe directory name. */
export const EMPLOYEE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ResolvedVoice =
  | { voiceId: string; fallback?: undefined }
  | { voiceId: string; fallback: { error: "voice_consent_required"; message: string } };

/**
 * The voice TTS may use for this request. A stock catalogue voice, or the
 * install's configured default, needs no one's consent. Any other voice id
 * (a clone or custom voice) is used only for the person who recorded consent
 * for exactly that voice id; otherwise the default voice is returned together
 * with the reason, so the caller can tell the user.
 */
export async function resolveTtsVoice(requested: unknown, employeeId: unknown, env: Env = process.env): Promise<ResolvedVoice> {
  const wanted = liveVoiceId(requested, env);
  const fallbackVoice = liveVoiceId(undefined, env);
  if (wanted === fallbackVoice || typeof requested !== "string" || isStockVoice(wanted)) return { voiceId: wanted };
  const consent = typeof employeeId === "string" && EMPLOYEE_ID.test(employeeId) ? await loadVoiceConsent(employeeId) : null;
  if (consent && consent.voiceId === wanted) return { voiceId: wanted };
  return { voiceId: fallbackVoice, fallback: { error: "voice_consent_required", message: VOICE_CONSENT_REQUIRED_MESSAGE } };
}

/** Scribe v2 Realtime, VAD-committed: one committed transcript per pause. */
export function sttRealtimeUrl(token: string, opts: { language?: unknown } = {}, env: Env = process.env): string {
  const q = new URLSearchParams({
    model_id: STT_REALTIME_MODEL,
    token,
    audio_format: `pcm_${STT_SAMPLE_RATE}`,
    commit_strategy: "vad",
    vad_silence_threshold_secs: String(VAD_SILENCE_SECS),
  });
  if (typeof opts.language === "string" && LANG.test(opts.language)) q.set("language_code", opts.language);
  return `${elevenLabsWsBase(env)}/v1/speech-to-text/realtime?${q}`;
}

/** The Text to Dialogue WebSocket, which is where Eleven v4 Turbo runs. */
export function ttsLiveUrl(token: string, env: Env = process.env): string {
  const q = new URLSearchParams({
    model_id: liveTtsModel(env),
    output_format: `pcm_${TTS_SAMPLE_RATE}`,
    single_use_token: token,
  });
  return `${elevenLabsWsBase(env)}/v1/text-to-dialogue/stream-input?${q}`;
}

/** Why a token can't be minted on this install, as an HTTP answer; null when it can. */
export function liveTokenRefusal(env: Env = process.env): { status: number; error: string } | null {
  // No key reads as off too: voiceEnabled() needs one.
  return liveVoiceEnabled(env) ? null : { status: 403, error: "live_voice_disabled" };
}

/** A single-use token (valid 15 minutes, one connection) from ElevenLabs. */
export async function mintSingleUseToken(type: TokenType, signal?: AbortSignal, env: Env = process.env): Promise<string | null> {
  const res = await fetch(`${elevenLabsBase(env)}/v1/single-use-token/${type}`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY ?? "" },
    signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[voice-live] ${type} token refused`, res.status, detail.slice(0, 300));
    return null;
  }
  const json = (await res.json().catch(() => null)) as { token?: unknown } | null;
  return typeof json?.token === "string" && json.token ? json.token : null;
}
