import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSpeaker } from "./live-speaker";

// Fakes for the browser pieces LiveSpeaker drives: one WebSocket, one
// AudioContext, and the token route.

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeSocket | null = null;
  readyState = FakeSocket.CONNECTING;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(m: string) {
    this.sent.push(JSON.parse(m));
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

class FakeSource {
  onended: (() => void) | null = null;
  buffer: unknown = null;
  connect() {}
  start() {}
  stop() {}
}
const sources: FakeSource[] = [];
class FakeContext {
  state = "running";
  currentTime = 0;
  destination = {};
  createBuffer(_ch: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const s = new FakeSource();
    sources.push(s);
    return s;
  }
  resume() {
    return Promise.resolve();
  }
}

/** 100 samples of 16-bit silence, base64. */
const AUDIO = Buffer.alloc(200).toString("base64");
const flush = () => new Promise((r) => setTimeout(r, 0));

function tokenRoute(ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (ok ? new Response(JSON.stringify({ url: "wss://x/tts", voiceId: "v1" })) : new Response("{}", { status: 502 }))),
  );
}

beforeEach(() => {
  FakeSocket.last = null;
  sources.length = 0;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { AudioContext: FakeContext });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LiveSpeaker", () => {
  it("registers the voice, then sends queued sentences flushed one by one", async () => {
    tokenRoute();
    const sp = new LiveSpeaker("v1");
    sp.say("First sentence.");
    await flush();
    const ws = FakeSocket.last!;
    sp.say("Second one.");
    ws.open();
    expect(ws.sent[0]).toEqual({ voices: ["v1"] });
    expect(ws.sent.slice(1)).toEqual([
      { inputs: [{ text: "First sentence. ", voice_id: "v1" }], flush: true },
      { inputs: [{ text: "Second one. ", voice_id: "v1" }], flush: true },
    ]);
    sp.finish();
    expect(ws.sent.at(-1)).toEqual({ close_socket: true });
    expect(sp.spoken).toBe("First sentence. Second one.");
  });

  it("fails once, without ending, when the token route refuses", async () => {
    tokenRoute(false);
    const failed = vi.fn();
    const ended = vi.fn();
    new LiveSpeaker("v1", { failed, ended }).say("Hi there, this is a test.");
    await flush();
    await flush();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
  });

  it("fails when the socket doesn't open in time", async () => {
    vi.useFakeTimers();
    tokenRoute();
    const failed = vi.fn();
    new LiveSpeaker("v1", { failed });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("fails on an error before any audio; plays, then ends once after is_final and playback", async () => {
    tokenRoute();
    const failed = vi.fn();
    const sp1 = new LiveSpeaker("v1", { failed });
    await flush();
    FakeSocket.last!.open();
    FakeSocket.last!.receive({ error: "invalid_token_type", message: "x" });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(sp1.playing).toBe(false);

    const playing = vi.fn();
    const ended = vi.fn();
    const sp2 = new LiveSpeaker("v1", { playing, ended });
    sp2.say("A sentence long enough.");
    await flush();
    const ws = FakeSocket.last!;
    ws.open();
    ws.receive({ audio: AUDIO });
    expect(playing).toHaveBeenCalledTimes(1);
    expect(sp2.playing).toBe(true);
    sp2.finish();
    ws.receive({ is_final: true });
    expect(ended).not.toHaveBeenCalled(); // still playing
    for (const s of sources) s.onended?.();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("stop() silences it and ends once, never failing", async () => {
    tokenRoute();
    const failed = vi.fn();
    const ended = vi.fn();
    const sp = new LiveSpeaker("v1", { failed, ended });
    sp.say("A sentence long enough.");
    await flush();
    FakeSocket.last!.open();
    FakeSocket.last!.receive({ audio: AUDIO });
    sp.stop();
    sp.stop();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(FakeSocket.last!.readyState).toBe(FakeSocket.CLOSED);
  });

  it("a malformed audio chunk before any audio fails cleanly", async () => {
    tokenRoute();
    const failed = vi.fn();
    new LiveSpeaker("v1", { failed });
    await flush();
    FakeSocket.last!.open();
    FakeSocket.last!.receive({ audio: "!!!not base64!!!" });
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("after() delays it behind the acknowledgment and counts that as said", async () => {
    tokenRoute();
    const ended = vi.fn();
    const sp = new LiveSpeaker("v1", { ended });
    sp.after(5, "Let me check.");
    sp.say("The answer.");
    expect(sp.spoken).toBe("Let me check. The answer.");
    const only = new LiveSpeaker("v1", { ended });
    only.after(5, "Let me check.");
    only.finish(); // no sentences: just ends
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("finish() with nothing said just ends", async () => {
    tokenRoute();
    const ended = vi.fn();
    new LiveSpeaker("v1", { ended }).finish();
    expect(ended).toHaveBeenCalledTimes(1);
  });
});

describe("LiveSpeaker voice consent", () => {
  it("sends employeeId with the voice and speaks the voice the server returned", async () => {
    const fetchMock = vi.fn<(url: string, init: { body: string }) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ url: "wss://x/tts", voiceId: "default", voiceFallback: { error: "voice_consent_required", message: "No recorded consent, so the default voice speaks." } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const notice = vi.fn();
    const sp = new LiveSpeaker("cloned", { notice }, "emp1");
    sp.say("A sentence long enough.");
    await flush();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ voiceId: "cloned", employeeId: "emp1" });
    expect(notice).toHaveBeenCalledWith("No recorded consent, so the default voice speaks.");
    const ws = FakeSocket.last!;
    ws.open();
    expect(ws.sent[0]).toEqual({ voices: ["default"] });
    expect(ws.sent[1]).toEqual({ inputs: [{ text: "A sentence long enough. ", voice_id: "default" }], flush: true });
  });

  it("hands a consented cloned voice (409) to the server-side stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "voice_server_only" }), { status: 409 })));
    const failed = vi.fn();
    new LiveSpeaker("cloned", { failed }, "emp1");
    await flush();
    await flush();
    expect(failed).toHaveBeenCalledWith("server_only");
  });
});
