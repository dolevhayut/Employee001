import { describe, expect, it } from "vitest";
import { Downsampler, base64ToBytes, bytesToBase64, floatToPcm16, pcm16ToFloat } from "./pcm";

describe("Downsampler", () => {
  it("turns 48 kHz into 16 kHz, one in three", () => {
    const d = new Downsampler(48_000, 16_000);
    const out = d.push(new Float32Array(4800).fill(0.5));
    expect(out.length).toBe(1600);
    expect(out[0]).toBeCloseTo(0.5);
  });

  it("keeps the count right across 128-sample frames at 44.1 kHz", () => {
    const d = new Downsampler(44_100, 16_000);
    let total = 0;
    for (let i = 0; i < 1000; i++) total += d.push(new Float32Array(128).fill(0.1)).length;
    // 128000 samples at 44.1k = 2.902s → 46440 samples at 16k (±1 for the carry)
    expect(Math.abs(total - Math.floor((128_000 * 16_000) / 44_100))).toBeLessThanOrEqual(1);
  });

  it("passes a matching rate through", () => {
    const frame = new Float32Array([0.1, 0.2]);
    expect(new Downsampler(16_000, 16_000).push(frame)).toBe(frame);
  });
});

describe("PCM 16", () => {
  it("round-trips samples through bytes and base64", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = base64ToBytes(bytesToBase64(floatToPcm16(samples)));
    const back = pcm16ToFloat(bytes);
    expect(back.rest.length).toBe(0);
    back.samples.forEach((v, i) => expect(v).toBeCloseTo(samples[i], 3));
  });

  it("clips out-of-range samples", () => {
    const back = pcm16ToFloat(floatToPcm16(new Float32Array([2, -2]))).samples;
    expect(back[0]).toBeCloseTo(1, 3);
    expect(back[1]).toBe(-1);
  });

  it("hands back an odd trailing byte", () => {
    const r = pcm16ToFloat(new Uint8Array([0, 64, 7]));
    expect(r.samples.length).toBe(1);
    expect(Array.from(r.rest)).toEqual([7]);
  });
});
