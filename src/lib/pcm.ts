// 16-bit PCM in and out of the browser for live voice: the mic is cut down to
// 16 kHz for Scribe, and the twin's speech arrives as base64 PCM to play.

/** Turns a stream of Float32 frames at `inRate` into frames at `outRate`
 *  (lower), averaging each output sample's window so speech stays clean.
 *  Keeps the remainder between calls, so frame edges don't click. */
export class Downsampler {
  private carry = new Float32Array(0);
  private pos = 0;
  private readonly ratio: number;

  constructor(inRate: number, outRate: number) {
    this.ratio = inRate / outRate;
  }

  push(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input;
    const buf = new Float32Array(this.carry.length + input.length);
    buf.set(this.carry);
    buf.set(input, this.carry.length);
    const out = new Float32Array(Math.max(0, Math.floor((buf.length - this.pos) / this.ratio)));
    let n = 0;
    let pos = this.pos;
    while (n < out.length && pos + this.ratio <= buf.length) {
      const from = Math.floor(pos);
      const to = Math.max(from + 1, Math.floor(pos + this.ratio));
      let sum = 0;
      for (let k = from; k < to; k++) sum += buf[k];
      out[n++] = sum / (to - from);
      pos += this.ratio;
    }
    const keep = Math.floor(pos);
    this.carry = buf.slice(keep);
    this.pos = pos - keep;
    return n === out.length ? out : out.slice(0, n);
  }
}

/** Float32 samples (-1..1) as little-endian 16-bit PCM bytes. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

/** Little-endian 16-bit PCM bytes as Float32 samples. An odd last byte is
 *  returned as `rest`, to go in front of the next chunk. */
export function pcm16ToFloat(bytes: Uint8Array): { samples: Float32Array; rest: Uint8Array } {
  const even = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, even);
  const samples = new Float32Array(even / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000;
  return { samples, rest: bytes.slice(even) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
