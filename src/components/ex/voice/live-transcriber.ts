"use client";

// The mic, live, into ElevenLabs Scribe v2 Realtime. An AudioWorklet taps the
// mic every ~100ms; the frames go down to 16 kHz PCM and over the WebSocket
// the server's single-use token opened (POST /api/stt/token). Scribe answers
// with partial transcripts while the person talks and commits one transcript
// at each pause (VAD). The session stays open across questions, so the person
// can just keep talking, and so they can talk over the twin to stop it.

import { Downsampler, bytesToBase64, floatToPcm16 } from "@/lib/pcm";

const SAMPLE_RATE = 16_000;
const PROCESSOR = "e001-pcm-tap";

// Batches the render quantum (128 samples) into ~100ms frames for the socket.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.parts = []; this.size = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.parts.push(ch.slice(0));
      this.size += ch.length;
      if (this.size >= sampleRate / 10) {
        const out = new Float32Array(this.size);
        let at = 0;
        for (const p of this.parts) { out.set(p, at); at += p.length; }
        this.port.postMessage(out, [out.buffer]);
        this.parts = [];
        this.size = 0;
      }
    }
    return true;
  }
}
registerProcessor("${PROCESSOR}", Tap);
`;

const loaded = new WeakSet<BaseAudioContext>();
async function loadWorklet(ctx: AudioContext) {
  if (loaded.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
    loaded.add(ctx);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const canStreamMic = () =>
  typeof window !== "undefined" &&
  typeof WebSocket !== "undefined" &&
  typeof AudioWorkletNode !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

export type LiveTranscriberEvents = {
  /** Scribe is listening (session_started). */
  ready: () => void;
  /** What's been said so far in the current utterance; may still change. */
  partial: (text: string) => void;
  /** The utterance is over (a pause, or finish()): the final words. */
  commit: (text: string) => void;
  /** The session failed or closed on its own. */
  closed: (failed: boolean) => void;
};

type ScribeMessage = { message_type?: string; text?: string; error?: string; message?: string };

export type LiveTranscriber = {
  /** Commit whatever is being said now, then close. */
  finish: () => void;
  /** Close now and drop what's in flight. */
  close: () => void;
};

/** Opens the socket and starts streaming `stream` through `ctx`. */
export async function startLiveTranscriber(url: string, ctx: AudioContext, stream: MediaStream, on: LiveTranscriberEvents): Promise<LiveTranscriber> {
  await loadWorklet(ctx);
  const ws = new WebSocket(url);
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
  // The node only runs when something pulls on it: a muted path to the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(tap);
  tap.connect(mute);
  mute.connect(ctx.destination);

  const down = new Downsampler(ctx.sampleRate, SAMPLE_RATE);
  let started = false;
  let done = false;
  let finishing = false;
  let partial = "";
  // Audio from before the session opened (up to ~3s), sent once it has.
  const early: string[] = [];
  let finishTimer: number | undefined;

  const send = (audio: string, commit = false) =>
    ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: audio, commit, sample_rate: SAMPLE_RATE }));

  const teardown = () => {
    window.clearTimeout(finishTimer);
    tap.port.onmessage = null;
    try {
      source.disconnect();
      tap.disconnect();
      mute.disconnect();
    } catch {
      // already gone with the context
    }
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close(1000);
  };
  const end = (failed: boolean) => {
    if (done) return;
    done = true;
    teardown();
    on.closed(failed);
  };

  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (done || finishing) return;
    const audio = bytesToBase64(floatToPcm16(down.push(e.data)));
    if (!audio) return;
    if (started && ws.readyState === WebSocket.OPEN) send(audio);
    else if (early.length < 30) early.push(audio);
  };

  ws.onmessage = (e) => {
    let msg: ScribeMessage;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    const type = msg.message_type ?? "";
    if (type === "session_started") {
      started = true;
      for (const a of early.splice(0)) send(a);
      on.ready();
    } else if (type === "partial_transcript") {
      partial = msg.text ?? "";
      if (!done) on.partial(partial);
    } else if (type === "committed_transcript") {
      partial = "";
      on.commit(msg.text ?? "");
      if (finishing) end(false);
    } else if (/error/i.test(type) || msg.error) {
      console.warn("[voice] Scribe:", type || msg.error, msg.message ?? msg.error ?? "");
      end(true);
    }
  };
  ws.onerror = () => end(true);
  ws.onclose = () => end(!finishing);

  return {
    finish: () => {
      if (done) return;
      if (!started || ws.readyState !== WebSocket.OPEN || !partial.trim()) return end(false);
      finishing = true;
      send("", true);
      // Don't wait on Scribe forever: whatever arrived by then is it.
      finishTimer = window.setTimeout(() => end(false), 2500);
    },
    close: () => end(false),
  };
}
