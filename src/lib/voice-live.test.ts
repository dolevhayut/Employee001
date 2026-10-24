import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE_ID, mintSingleUseToken, elevenLabsWsBase, liveTokenRefusal, liveVoiceEnabled, liveVoiceId, sttRealtimeUrl, ttsLiveUrl } from "./voice-live";

const key = { ELEVENLABS_API_KEY: "k" };

describe("liveVoiceEnabled", () => {
  it("is on with a key", () => expect(liveVoiceEnabled(key)).toBe(true));
  it("is off without a key", () => expect(liveVoiceEnabled({})).toBe(false));
  it("is off with EMPLOYEE001_VOICE=off", () => expect(liveVoiceEnabled({ ...key, EMPLOYEE001_VOICE: "off" })).toBe(false));
  it("is off with EMPLOYEE001_VOICE_LIVE=off", () => expect(liveVoiceEnabled({ ...key, EMPLOYEE001_VOICE_LIVE: "OFF" })).toBe(false));
  it("is off in EU mode, even with an EU ElevenLabs endpoint", () => {
    expect(liveVoiceEnabled({ ...key, EMPLOYEE001_REGION: "eu" })).toBe(false);
    expect(liveVoiceEnabled({ ...key, EMPLOYEE001_REGION: "eu", ELEVENLABS_BASE_URL: "https://api.eu.residency.elevenlabs.io" })).toBe(false);
  });
  it("refuses tokens when off, and without a key (no key reads as off)", () => {
    expect(liveTokenRefusal({ ...key, EMPLOYEE001_REGION: "eu" })?.status).toBe(403);
    expect(liveTokenRefusal({})?.status).toBe(403);
    expect(liveTokenRefusal(key)).toBeNull();
  });
});

describe("live URLs", () => {
  it("follows the REST base to its WebSocket origin", () => {
    expect(elevenLabsWsBase({})).toBe("wss://api.elevenlabs.io");
    expect(elevenLabsWsBase({ ELEVENLABS_BASE_URL: "http://localhost:9999/" })).toBe("ws://localhost:9999");
  });

  it("opens Scribe v2 Realtime with VAD commits on 16 kHz PCM", () => {
    const u = new URL(sttRealtimeUrl("sutkn_abc", {}, {}));
    expect(u.origin + u.pathname).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    expect(u.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(u.searchParams.get("token")).toBe("sutkn_abc");
    expect(u.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(u.searchParams.get("commit_strategy")).toBe("vad");
    expect(u.searchParams.has("language_code")).toBe(false);
    expect(new URL(sttRealtimeUrl("t", { language: "he" }, {})).searchParams.get("language_code")).toBe("he");
    expect(new URL(sttRealtimeUrl("t", { language: "he&x=1" }, {})).searchParams.has("language_code")).toBe(false);
  });

  it("opens Eleven v4 Turbo on the Text to Dialogue socket", () => {
    const u = new URL(ttsLiveUrl("sutkn_x", {}));
    expect(u.pathname).toBe("/v1/text-to-dialogue/stream-input");
    expect(u.searchParams.get("model_id")).toBe("eleven_v4_turbo");
    expect(u.searchParams.get("output_format")).toBe("pcm_24000");
    expect(u.searchParams.get("single_use_token")).toBe("sutkn_x");
    expect(new URL(ttsLiveUrl("t", { ELEVENLABS_LIVE_TTS_MODEL: "eleven_v4" })).searchParams.get("model_id")).toBe("eleven_v4");
  });
});

describe("liveVoiceId", () => {
  it("keeps the twin's voice, else the install default, else Sarah", () => {
    expect(liveVoiceId("abcDEF123", {})).toBe("abcDEF123");
    expect(liveVoiceId(undefined, { ELEVENLABS_VOICE_ID: "Inst4ll" })).toBe("Inst4ll");
    expect(liveVoiceId(undefined, {})).toBe(DEFAULT_VOICE_ID);
    expect(liveVoiceId("../evil", {})).toBe(DEFAULT_VOICE_ID);
  });
});

describe("mintSingleUseToken", () => {
  const env = { ELEVENLABS_API_KEY: "k" };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the token, asked with the server's key", async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ token: "sutkn_1" })));
    vi.stubGlobal("fetch", f);
    expect(await mintSingleUseToken("realtime_scribe", undefined, env)).toBe("sutkn_1");
    expect(String(f.mock.calls[0][0])).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)["xi-api-key"]).toBe("k");
  });

  it("returns null on a refusal or an empty token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    expect(await mintSingleUseToken("ttd_websocket", undefined, env)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "" }))));
    expect(await mintSingleUseToken("ttd_websocket", undefined, env)).toBeNull();
  });

  it("throws when ElevenLabs is unreachable (the routes answer 502)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await expect(mintSingleUseToken("realtime_scribe", undefined, env)).rejects.toThrow();
  });
});
