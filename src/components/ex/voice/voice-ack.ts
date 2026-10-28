"use client";

// The twin's "Let me check." the moment a spoken question is sent, so there is
// sound while it works. The few phrases are synthesized once per voice, ahead
// of time (POST /api/tts, the twin's own voice), and kept decoded: playing one
// is instant, with no model call and no network on the spot.

import { ACK_PHRASES } from "@/lib/voice-lane";
import { playbackContext } from "./live-speaker";

const key = (voiceId: string | undefined, phrase: string) => `${voiceId ?? ""}\u0000${phrase}`;
const ready = new Map<string, AudioBuffer>();
/** Voices being prepared, or that failed recently (retried after a minute). */
const preparing = new Map<string, number>();
const RETRY_MS = 60_000;

async function synthesize(voiceId: string | undefined, phrase: string, employeeId?: string): Promise<AudioBuffer | null> {
  const ctx = playbackContext();
  if (!ctx) return null;
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: phrase, voiceId, employeeId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const { audioContent } = (await res.json()) as { audioContent?: string };
    if (!audioContent) return null;
    const bytes = Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0));
    return await ctx.decodeAudioData(bytes.buffer);
  } catch {
    return null;
  }
}

/** Synthesizes the acknowledgments for this voice in the background, one at
 *  a time (no burst against ElevenLabs' concurrency limit next to the live
 *  sockets). A failure is retried no sooner than a minute later. */
export function prepareAcks(voiceId: string | undefined, employeeId?: string) {
  const v = voiceId ?? "";
  const since = preparing.get(v);
  if (since !== undefined && (since === Infinity || Date.now() - since < RETRY_MS)) return;
  preparing.set(v, Infinity);
  void (async () => {
    let failed = false;
    for (const phrase of ACK_PHRASES) {
      const k = key(voiceId, phrase);
      if (ready.has(k)) continue;
      const buf = await synthesize(voiceId, phrase, employeeId);
      if (buf) ready.set(k, buf);
      else failed = true;
    }
    if (failed) preparing.set(v, Date.now());
  })();
}

export type PlayingAck = { stop: () => void; endsAt: number };

/** Plays the phrase now if it's ready; null when it isn't (nothing is said). */
export function playAck(voiceId: string | undefined, phrase: string, onEnded: () => void): PlayingAck | null {
  const buf = ready.get(key(voiceId, phrase));
  const ctx = playbackContext();
  if (!buf || !ctx) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const at = ctx.currentTime + 0.02;
  src.start(at);
  let done = false;
  src.onended = () => {
    if (done) return;
    done = true;
    onEnded();
  };
  return {
    endsAt: at + buf.duration,
    stop: () => {
      if (done) return;
      done = true;
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already ended
      }
    },
  };
}
