import { describe, expect, it } from "vitest";
import { clearStoredVoice, voiceFallbackNote } from "./voice-storage";

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("clearStoredVoice", () => {
  it("removes only that person's entry", () => {
    const s = fakeStorage({ "twin.ttsVoices": JSON.stringify({ a: "v1", b: "v2" }) });
    clearStoredVoice("a", s);
    expect(JSON.parse(s.getItem("twin.ttsVoices")!)).toEqual({ b: "v2" });
  });
  it("removes the key when it was the last entry", () => {
    const s = fakeStorage({ "twin.ttsVoices": JSON.stringify({ a: "v1" }) });
    clearStoredVoice("a", s);
    expect(s.getItem("twin.ttsVoices")).toBeNull();
  });
  it("ignores missing or corrupt storage", () => {
    expect(() => clearStoredVoice("a", fakeStorage())).not.toThrow();
    const bad = fakeStorage({ "twin.ttsVoices": "{nope" });
    expect(() => clearStoredVoice("a", bad)).not.toThrow();
  });
});

describe("voiceFallbackNote", () => {
  it("reads the stream header", () => {
    expect(voiceFallbackNote(new Headers({ "X-Voice-Fallback-Message": "No consent" }))).toBe("No consent");
    expect(voiceFallbackNote(new Headers())).toBeNull();
  });
});
