"use client";

// Voice input: press to talk, press again (or pause) to stop, get the words.
// With an ElevenLabs key on the server the clip is recorded here and
// transcribed by POST /api/stt (Scribe); without one it falls back to the
// browser's own Web Speech recognition. Either way a live input level is
// exposed as a MotionValue, so the meter animates without re-rendering.
//
// Ported from "Speech Input" (vercel-crawled, 21st.dev id 28387), with the
// order flipped (server STT first) and end-of-speech detection added.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMotionValue, type MotionValue } from "framer-motion";
import { silenceStart, silenceStep, MAX_RECORD_MS, STT_MIN_BYTES, type SilenceState } from "@/lib/stt";

export type VoiceInputState = "idle" | "listening" | "transcribing";
export type VoiceEngine = "elevenlabs" | "browser" | "none";
export type VoiceInputError = "denied" | "unsupported" | "stt" | "no_speech";

/* Web Speech types, local so they never clash with other declarations. */
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; length: number; [i: number]: RecognitionAlternative };
type RecognitionEvent = Event & { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } };
type Recognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const canRecord = () =>
  typeof window !== "undefined" && "MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia);

// Browser support is a constant client fact: read it through a store so SSR
// renders "none" and the client resolves it on hydration.
const noop = () => () => {};
const supportSnapshot = () => `${canRecord() ? "r" : ""}${recognitionCtor() ? "s" : ""}`;

const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const pickRecorderType = () => RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";

type Meter = { stop: () => void };

/** The client gives up on a transcription after this long (the route's own
 *  upstream timeout is 30s, so this only catches a stalled connection). */
const STT_CLIENT_TIMEOUT_MS = 35_000;

/** An AudioContext made (and resumed) inside the click gesture, so autoplay
 *  policy (Safari above all) doesn't leave it suspended and the meter at zero. */
function openAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Feeds the mic's level (0..1) into `level` every frame; `onLevel` sees each
 *  reading, but only while the context is running (a suspended one reads zeros,
 *  which would look like silence). The meter owns `ctx` and closes it on stop. */
function startMeter(
  stream: MediaStream,
  level: MotionValue<number>,
  ctx: AudioContext | null,
  onLevel?: (v: number, now: number) => void,
): Meter {
  if (!ctx) return { stop: () => level.set(0) };
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  let smooth = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    // RMS of speech sits around 0.02–0.2; stretch it to 0..1.
    const v = Math.min(1, Math.sqrt(sum / buf.length) * 5);
    smooth = v > smooth ? v : smooth * 0.85 + v * 0.15;
    level.set(smooth);
    if (ctx.state === "running") onLevel?.(smooth, performance.now());
    if (!stopped) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => {});
      level.set(0);
    },
  };
}

export function useVoiceInput(opts: {
  /** True when the server has an ElevenLabs key (POST /api/stt works). */
  serverStt: boolean;
  /** False when voice is off on this install: no browser fallback either. */
  allowBrowser?: boolean;
  /** BCP-47 tag for the browser fallback (e.g. "he-IL"). */
  lang: string;
  onTranscript: (text: string) => void;
  onError?: (err: VoiceInputError) => void;
}) {
  const support = useSyncExternalStore(noop, supportSnapshot, () => "");
  const engine: VoiceEngine =
    opts.serverStt && support.includes("r")
      ? "elevenlabs"
      : opts.allowBrowser !== false && support.includes("s")
        ? "browser"
        : "none";

  const [state, setState] = useState<VoiceInputState>("idle");
  const [interim, setInterim] = useState("");
  const level = useMotionValue(0);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<Meter | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const discardRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Made in the click gesture by start(), handed to the meter once the mic is open.
  const ctxRef = useRef<AudioContext | null>(null);
  // The length cap runs on a timer, not the meter's frame loop: frames pause
  // in a background tab, timers keep going.
  const capRef = useRef<number | undefined>(undefined);

  const release = useCallback(() => {
    window.clearTimeout(capRef.current);
    capRef.current = undefined;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    meterRef.current?.stop();
    meterRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /** Stop listening; the clip (or recognized words) is still used. */
  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recognitionRef.current?.stop();
  }, []);

  /** Stop listening and throw away whatever was heard. */
  const cancel = useCallback(() => {
    discardRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    release();
    setInterim("");
    setState("idle");
  }, [release]);

  const transcribe = useCallback(async (blob: Blob) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setState("transcribing");
    try {
      const body = new FormData();
      body.append("audio", blob, "question");
      const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(STT_CLIENT_TIMEOUT_MS)]);
      const res = await fetch("/api/stt", { method: "POST", body, signal });
      if (!res.ok) throw new Error(`stt ${res.status}`);
      const { text } = (await res.json()) as { text?: string };
      if (ac.signal.aborted) return;
      if (text?.trim()) optsRef.current.onTranscript(text.trim());
      else optsRef.current.onError?.("no_speech");
    } catch {
      // A cancel is silent; a timeout or a failed request is reported.
      if (!ac.signal.aborted) optsRef.current.onError?.("stt");
    } finally {
      // After a cancel the state is already idle, and may since have moved on
      // to a new recording: leave it alone then.
      if (abortRef.current === ac) {
        abortRef.current = null;
        setState("idle");
      }
    }
  }, []);

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      release();
      setState("idle");
      optsRef.current.onError?.("denied");
      return;
    }
    if (discardRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const mimeType = pickRecorderType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      recorderRef.current = null;
      release();
      if (discardRef.current) return;
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      if (blob.size < STT_MIN_BYTES) {
        setState("idle");
        optsRef.current.onError?.("no_speech");
        return;
      }
      void transcribe(blob);
    };
    // End the question on a pause, give up on silence. The clock starts on the
    // first live reading, so a context that resumes late doesn't eat into it.
    let silence: SilenceState | null = null;
    let ended = false;
    const ctx = ctxRef.current;
    ctxRef.current = null; // the meter owns it now
    meterRef.current = startMeter(stream, level, ctx, (v, now) => {
      if (ended) return;
      const step = silenceStep(silence ?? silenceStart(now), v, now);
      if (step.action !== "none") ended = true;
      silence = step.state;
      if (step.action === "stop") stop();
      else if (step.action === "cancel") {
        cancel();
        optsRef.current.onError?.("no_speech");
      }
    });
    rec.start(250);
    setState("listening");
    // Cap the length on a timer: it fires even with the tab in the background,
    // where the meter is paused. The clip is sent; an empty one comes back as
    // "no speech".
    capRef.current = window.setTimeout(() => {
      if (ended || recorderRef.current !== rec) return;
      ended = true;
      stop();
    }, MAX_RECORD_MS);
  }, [cancel, level, release, stop, transcribe]);

  const startRecognition = useCallback(async () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = false; // ends on a pause by itself
    rec.interimResults = true;
    rec.lang = optsRef.current.lang;
    recognitionRef.current = rec;
    let finalText = "";
    let failed = false;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0]?.transcript ?? "";
        else live += r[0]?.transcript ?? "";
      }
      setInterim((finalText + live).trim());
    };
    rec.onerror = (e) => {
      failed = true;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") optsRef.current.onError?.("denied");
      else if (e.error === "no-speech") optsRef.current.onError?.("no_speech");
    };
    rec.onend = () => {
      recognitionRef.current = null;
      release();
      setInterim("");
      setState("idle");
      if (discardRef.current || failed) return;
      const text = finalText.trim();
      if (text) optsRef.current.onTranscript(text);
      else optsRef.current.onError?.("no_speech");
    };
    try {
      rec.start();
    } catch {
      recognitionRef.current = null;
      optsRef.current.onError?.("unsupported");
      return;
    }
    setState("listening");
    // The meter is a bonus here: recognition works without it.
    if (canRecord()) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (recognitionRef.current !== rec) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = ctxRef.current;
        ctxRef.current = null;
        meterRef.current = startMeter(stream, level, ctx);
      } catch {
        // no meter
      }
    }
    // Recognition has its own end-pointing; this only bounds a stuck session.
    window.setTimeout(() => {
      if (recognitionRef.current === rec) rec.stop();
    }, MAX_RECORD_MS);
  }, [level, release]);

  const start = useCallback(() => {
    if (state !== "idle") return;
    discardRef.current = false;
    setInterim("");
    if (engine !== "none") {
      // Still inside the click: open the meter's audio context now.
      if (ctxRef.current) void ctxRef.current.close().catch(() => {});
      ctxRef.current = openAudioContext();
    }
    if (engine === "elevenlabs") {
      setState("listening");
      void startRecording();
    } else if (engine === "browser") void startRecognition();
    else optsRef.current.onError?.("unsupported");
  }, [engine, state, startRecognition, startRecording]);

  const toggle = useCallback(() => {
    if (state === "listening") stop();
    else if (state === "transcribing") cancel();
    else start();
  }, [cancel, start, state, stop]);

  // Never leave the mic open behind the page.
  useEffect(
    () => () => {
      discardRef.current = true;
      abortRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recognitionRef.current?.abort();
      window.clearTimeout(capRef.current);
      void ctxRef.current?.close().catch(() => {});
      meterRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { engine, state, interim, level, start, stop, cancel, toggle };
}
