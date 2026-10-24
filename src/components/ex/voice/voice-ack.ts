"use client";

// The twin's "Let me check." the moment a spoken question is sent, so there is
// sound while it works. The few phrases are synthesized once per voice, ahead
// of time (POST /api/tts, the twin's own voice), and kept decoded: playing one
// is instant, with no model call and no network on the spot.

import { ACK_PHRASES } from "@/lib/voice-lane";
import { playbackContext } from "./live-speaker";

const cache = new Map<string, Promise<AudioBuffer | null>>();
const key = (voiceId: string | undefined, phrase: string) => `${voiceId ?? ""}\u0000${phrase}`;
const ready = new Map<string, AudioBuffer>();

async function synthesize(voiceId: string | undefined, phrase: string): Promise<AudioBuffer | null> {
  const ctx = playbackContext();
  if (!ctx) return null;
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: phrase, voiceId }),
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

/** Synthesizes the acknowledgments for this voice in the background. */
export function prepareAcks(voiceId: string | undefined) {
  for (const phrase of ACK_PHRASES) {
    const k = key(voiceId, phrase);
    if (cache.has(k)) continue;
    const pending = synthesize(voiceId, phrase).then((buf) => {
      if (buf) ready.set(k, buf);
      else cache.delete(k); // try again next time
      return buf;
    });
    cache.set(k, pending);
  }
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
