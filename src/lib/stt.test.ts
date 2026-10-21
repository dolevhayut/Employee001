import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_RECORD_MS,
  NO_SPEECH_MS,
  SILENCE_MS,
  STT_DEFAULT_MODEL,
  STT_FORM_OVERHEAD,
  STT_MAX_BYTES,
  baseMime,
  declaredTooLarge,
  readCapped,
  silenceStart,
  silenceStep,
  sttFileName,
  sttModel,
  transcriptOf,
  validateSttUpload,
} from "./stt";

const ok = { size: 40_000, type: "audio/webm;codecs=opus" };

describe("validateSttUpload", () => {
  it("accepts what browsers record", () => {
    expect(validateSttUpload(ok)).toBeNull();
    expect(validateSttUpload({ size: 40_000, type: "audio/mp4" })).toBeNull();
    expect(validateSttUpload({ size: 40_000, type: "audio/ogg; codecs=opus" })).toBeNull();
    expect(validateSttUpload({ size: 40_000, type: "AUDIO/WAV" })).toBeNull();
  });

  it("rejects a missing clip", () => {
    expect(validateSttUpload(null)).toBe("missing");
    expect(validateSttUpload(undefined)).toBe("missing");
  });

  it("rejects anything that is not audio", () => {
    expect(validateSttUpload({ size: 40_000, type: "" })).toBe("bad_type");
    expect(validateSttUpload({ size: 40_000, type: "text/plain" })).toBe("bad_type");
    expect(validateSttUpload({ size: 40_000, type: "video/webm" })).toBe("bad_type");
    expect(validateSttUpload({ size: 40_000, type: "application/octet-stream" })).toBe("bad_type");
  });

  it("enforces the size window", () => {
    expect(validateSttUpload({ ...ok, size: 10 })).toBe("too_small");
    expect(validateSttUpload({ ...ok, size: STT_MAX_BYTES })).toBeNull();
    expect(validateSttUpload({ ...ok, size: STT_MAX_BYTES + 1 })).toBe("too_large");
  });

  it("only passes ISO language codes through", () => {
    expect(validateSttUpload({ ...ok, language: "he" })).toBeNull();
    expect(validateSttUpload({ ...ok, language: "heb" })).toBeNull();
    expect(validateSttUpload({ ...ok, language: "" })).toBeNull();
    expect(validateSttUpload({ ...ok, language: null })).toBeNull();
    expect(validateSttUpload({ ...ok, language: "he-IL" })).toBe("bad_language");
    expect(validateSttUpload({ ...ok, language: "x&model_id=y" })).toBe("bad_language");
  });
});

describe("helpers", () => {
  afterEach(() => {
    delete process.env.ELEVENLABS_STT_MODEL;
  });

  it("strips mime parameters and names the upload", () => {
    expect(baseMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(sttFileName("audio/webm;codecs=opus")).toBe("question.webm");
    expect(sttFileName("audio/mp4")).toBe("question.m4a");
    expect(sttFileName("audio/mpeg")).toBe("question.mp3");
  });

  it("uses Scribe v2 unless overridden", () => {
    expect(STT_DEFAULT_MODEL).toBe("scribe_v2");
    expect(sttModel()).toBe("scribe_v2");
    process.env.ELEVENLABS_STT_MODEL = "  scribe_v3 ";
    expect(sttModel()).toBe("scribe_v3");
  });

  it("rejects an oversized declared length", () => {
    expect(declaredTooLarge(null)).toBe(false);
    expect(declaredTooLarge("1000")).toBe(false);
    expect(declaredTooLarge(String(STT_MAX_BYTES + STT_FORM_OVERHEAD + 1))).toBe(true);
    expect(declaredTooLarge("not a number")).toBe(false);
  });

  it("reads a body up to the cap", async () => {
    const stream = (parts: number[]) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const n of parts) c.enqueue(new Uint8Array(n));
          c.close();
        },
      });
    expect((await readCapped(stream([3, 4]), 10))?.byteLength).toBe(7);
    expect(await readCapped(stream([6, 6]), 10)).toBeNull();
    expect((await readCapped(null, 10))?.byteLength).toBe(0);
  });

  it("pulls the transcript out of a Scribe response", () => {
    expect(transcriptOf({ text: "  What did we   ship last week? " })).toBe("What did we ship last week?");
    expect(transcriptOf({ text: 3 })).toBe("");
    expect(transcriptOf(null)).toBe("");
    expect(transcriptOf("nope")).toBe("");
  });
});

describe("silenceStep", () => {
  it("keeps listening while the CEO talks, stops after a pause", () => {
    let s = silenceStart(0);
    let r = silenceStep(s, 0.3, 500);
    expect(r.action).toBe("none");
    s = r.state;
    r = silenceStep(s, 0.01, 1000);
    expect(r.action).toBe("none");
    s = r.state;
    r = silenceStep(s, 0.01, 1000 + SILENCE_MS - 1);
    expect(r.action).toBe("none");
    r = silenceStep(r.state, 0.01, 1000 + SILENCE_MS);
    expect(r.action).toBe("stop");
  });

  it("a word in the pause resets the silence clock", () => {
    let r = silenceStep(silenceStart(0), 0.3, 100);
    r = silenceStep(r.state, 0.01, 200);
    r = silenceStep(r.state, 0.3, 200 + SILENCE_MS - 10);
    r = silenceStep(r.state, 0.01, 200 + SILENCE_MS + 10);
    expect(r.action).toBe("none");
  });

  it("cancels when nothing was said", () => {
    const r = silenceStep(silenceStart(0), 0.01, NO_SPEECH_MS);
    expect(r.action).toBe("cancel");
  });

  it("stops at the hard limit", () => {
    const heard = silenceStep(silenceStart(0), 0.3, 10).state;
    expect(silenceStep(heard, 0.3, MAX_RECORD_MS).action).toBe("stop");
  });
});
