"use client";

// The twin's answer, spoken while it's still being written. Each sentence goes
// to ElevenLabs Eleven v4 Turbo over the Text to Dialogue WebSocket (opened
// with a single-use token from POST /api/tts/token) and is flushed at once, so
// speech starts with the first sentence instead of after the whole answer. The
// audio comes back as 24 kHz PCM and is queued gap-free on one AudioContext;
// stop() silences it at once (barge-in).

import { TTS_SAMPLE_RATE as SAMPLE_RATE, base64ToBytes, pcm16ToFloat } from "@/lib/pcm";

/** The socket closes after 20s without a message; the twin may think longer. */
const KEEP_ALIVE_MS = 10_000;
/** Give up on a socket that hasn't opened by then (whole-answer playback takes over). */
const CONNECT_TIMEOUT_MS = 8_000;
/** After the last sentence, the end of speech is due well within this. */
const FINISH_TIMEOUT_MS = 30_000;

let shared: AudioContext | null = null;

/** The context answers play on. Call it from a click or key press once, so
 *  autoplay rules (Safari's above all) let it play later without one. */
export function playbackContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!shared || shared.state === "closed") {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      shared = new Ctx();
    } catch {
      return null;
    }
  }
  if (shared.state === "suspended") void shared.resume().catch(() => {});
  return shared;
}

export type LiveSpeakerEvents = {
  /** The first audio of this answer is playing. */
  playing?: () => void;
  /** Everything was said (or stop() was called). */
  ended?: () => void;
  /** Couldn't speak at all (no token, socket refused): nothing was played. */
  failed?: () => void;
};

type TtdMessage = { audio?: string; is_final?: boolean; error?: string; message?: string };

export class LiveSpeaker {
  /** Everything sent to be spoken so far, to recognise it coming back through the mic. */
  spoken = "";
  private ws: WebSocket | null = null;
  private voiceId = "";
  private queue: string[] = [];
  private finished = false;
  private gotFinal = false;
  private stopped = false;
  private started = false;
  private sources = new Set<AudioBufferSourceNode>();
  private nextAt = 0;
  private rest: Uint8Array = new Uint8Array(0);
  private keepAlive: ReturnType<typeof setInterval> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private readonly ctx: AudioContext | null;

  constructor(
    voiceId: string | undefined,
    private readonly on: LiveSpeakerEvents = {},
  ) {
    this.ctx = playbackContext();
    void this.open(voiceId);
  }

  /** One sentence (already cleaned for speech). */
  say(sentence: string) {
    const text = sentence.trim();
    if (!text || this.stopped || this.finished) return;
    this.spoken += (this.spoken ? " " : "") + text;
    if (this.ws?.readyState === WebSocket.OPEN) this.sendText(text);
    else this.queue.push(text);
  }

  /** No more sentences: say what's left, then end. */
  finish() {
    if (this.finished || this.stopped) return;
    this.finished = true;
    if (!this.spoken) return this.stop();
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => this.stop(), FINISH_TIMEOUT_MS);
    if (this.ws?.readyState === WebSocket.OPEN && this.queue.length === 0) this.ws.send(JSON.stringify({ close_socket: true }));
  }

  /** Silence now, drop the rest. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // not started yet
      }
    }
    this.sources.clear();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
    this.on.ended?.();
  }

  /** Its voice is coming out of the speakers now (not still connecting). */
  get playing() {
    return this.started && !this.stopped;
  }

  private async open(requested?: string) {
    let url: string;
    try {
      const res = await fetch("/api/tts/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: requested }),
      });
      if (!res.ok) throw new Error(`tts token ${res.status}`);
      const body = (await res.json()) as { url: string; voiceId: string };
      url = body.url;
      this.voiceId = body.voiceId;
    } catch {
      return this.fail();
    }
    if (this.stopped) return;
    if (!this.ctx) return this.fail();
    const ws = new WebSocket(url);
    this.ws = ws;
    this.deadline = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) this.fail();
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.stopped) return ws.close(1000);
      clearTimeout(this.deadline);
      ws.send(JSON.stringify({ voices: [this.voiceId] }));
      for (const text of this.queue.splice(0)) this.sendText(text);
      if (this.finished) ws.send(JSON.stringify({ close_socket: true }));
      this.keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ keep_alive: true }));
      }, KEEP_ALIVE_MS);
    };
    ws.onmessage = (e) => {
      let msg: TtdMessage;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.error) {
        console.warn("[voice] Text to Dialogue:", msg.error, msg.message ?? "");
        if (!this.started) this.fail();
        else this.stop();
        return;
      }
      if (msg.audio) {
        try {
          this.play(msg.audio);
        } catch {
          // a malformed chunk: stop cleanly rather than leave the turn hanging
          if (!this.started) this.fail();
          else this.stop();
          return;
        }
      }
      if (msg.is_final) {
        this.gotFinal = true;
        this.endIfDone();
      }
    };
    ws.onerror = () => {
      if (!this.started) this.fail();
    };
    ws.onclose = () => {
      clearInterval(this.keepAlive);
      if (this.stopped) return;
      if (!this.started) return this.fail();
      // Closed early: let what's queued finish, then end.
      this.gotFinal = true;
      this.endIfDone();
    };
  }

  private sendText(text: string) {
    // Flushed per sentence: speech starts without waiting for more text.
    this.ws?.send(JSON.stringify({ inputs: [{ text: text + " ", voice_id: this.voiceId }], flush: true }));
  }

  private play(b64: string) {
    const ctx = this.ctx;
    if (!ctx || this.stopped) return;
    const bytes = base64ToBytes(b64);
    const joined = new Uint8Array(this.rest.length + bytes.length);
    joined.set(this.rest);
    joined.set(bytes, this.rest.length);
    const { samples, rest } = pcm16ToFloat(joined);
    this.rest = rest;
    if (samples.length === 0) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, this.nextAt);
    src.start(at);
    this.nextAt = at + buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      this.endIfDone();
    };
    if (!this.started) {
      this.started = true;
      this.on.playing?.();
    }
  }

  private endIfDone() {
    if (this.stopped || !this.gotFinal || this.sources.size > 0) return;
    this.stopped = true;
    this.clearTimers();
    this.on.ended?.();
  }

  private clearTimers() {
    clearInterval(this.keepAlive);
    clearTimeout(this.deadline);
  }

  private fail() {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
    this.on.failed?.();
  }
}
