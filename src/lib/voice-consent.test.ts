import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const sidecar = (id: string) => path.join(home, "data", "employees", id, "employee.json");
const read = (id: string) => JSON.parse(fs.readFileSync(sidecar(id), "utf8"));
const auditRows = () =>
  fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const CLONE = "CloneVoice123";
const SARAH = "EXAVITQu4vr4xnSDxMaL";
const headers = () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "TestBrowser/1" });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-voice-"));
  process.env.EMPLOYEE001_HOME = home;
  fs.mkdirSync(path.dirname(sidecar("noa")), { recursive: true });
  fs.writeFileSync(sidecar("noa"), JSON.stringify({ id: "noa", name: "Noa", role: "Frontend" }));
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("voice consent", () => {
  it("refuses a custom voice without consent and falls back to the default", async () => {
    const { resolveTtsVoice, DEFAULT_VOICE_ID } = await import("./voice-live");
    for (const employeeId of [undefined, "noa", "ghost", "../noa"]) {
      const r = await resolveTtsVoice(CLONE, employeeId, {});
      expect(r.voiceId).toBe(DEFAULT_VOICE_ID);
      expect(r.fallback).toMatchObject({ error: "voice_consent_required" });
      expect(r.fallback?.message).toMatch(/consent/);
    }
  });

  it("lets stock voices and the install default through with no consent", async () => {
    const { resolveTtsVoice } = await import("./voice-live");
    expect(await resolveTtsVoice("onwK4e9ZLuTAKqWW03F9", undefined, {})).toEqual({ voiceId: "onwK4e9ZLuTAKqWW03F9" });
    expect(await resolveTtsVoice(undefined, undefined, {})).toEqual({ voiceId: SARAH });
    expect(await resolveTtsVoice(CLONE, undefined, { ELEVENLABS_VOICE_ID: CLONE })).toEqual({ voiceId: CLONE });
  });

  it("records who, when, wording digest, IP and user agent, then allows exactly that voice", async () => {
    const { recordVoiceConsent, voiceConsentDigest } = await import("./employees-disk");
    const { resolveTtsVoice } = await import("./voice-live");
    const res = await recordVoiceConsent("noa", { agree: true, voiceId: CLONE, onBehalf: false, actor: { userId: "u1" }, headers: headers() });
    expect(res.ok).toBe(true);
    expect(read("noa").voiceConsent).toMatchObject({
      voiceId: CLONE,
      textDigest: voiceConsentDigest(),
      ip: "203.0.113.7",
      userAgent: "TestBrowser/1",
    });
    expect(read("noa").voiceConsent.grantedAt).toBeTruthy();
    expect(read("noa").voiceConsent.onBehalf).toBeUndefined();
    expect(read("noa")).toMatchObject({ name: "Noa", role: "Frontend" });

    expect((await resolveTtsVoice(CLONE, "noa", {})).fallback).toBeUndefined();
    // Consent is for that voice id and that person only.
    expect((await resolveTtsVoice("OtherClone9", "noa", {})).fallback).toBeDefined();
    expect((await resolveTtsVoice(CLONE, "someone-else", {})).fallback).toBeDefined();
    expect(auditRows().at(-1)).toMatchObject({ bareName: "voice.consentGranted", employeeId: "noa" });
  });

  it("marks admin-recorded consent as on behalf", async () => {
    const { recordVoiceConsent } = await import("./employees-disk");
    await recordVoiceConsent("noa", { agree: true, voiceId: CLONE, onBehalf: true });
    expect(read("noa").voiceConsent.onBehalf).toBe(true);
    expect(auditRows().at(-1).input).toMatchObject({ onBehalf: true });
  });

  it("withdrawing removes the voice id, audits it, and the voice is refused again", async () => {
    const { recordVoiceConsent, loadVoiceConsent } = await import("./employees-disk");
    const { resolveTtsVoice } = await import("./voice-live");
    await recordVoiceConsent("noa", { agree: true, voiceId: CLONE, onBehalf: false });
    const res = await recordVoiceConsent("noa", { agree: false, voiceId: "", onBehalf: false, headers: headers() });
    expect(res).toEqual({ ok: true, voiceConsent: null });
    expect(read("noa").voiceConsent).toBeUndefined();
    expect(JSON.stringify(read("noa"))).not.toContain(CLONE);
    expect(await loadVoiceConsent("noa")).toBeNull();
    expect((await resolveTtsVoice(CLONE, "noa", {})).fallback).toBeDefined();
    expect(auditRows().at(-1)).toMatchObject({ bareName: "voice.consentWithdrawn" });
    expect(auditRows().at(-1).input).toMatchObject({ voiceId: CLONE });
  });

  it("rejects unsafe ids before touching disk", async () => {
    const { recordVoiceConsent } = await import("./employees-disk");
    expect(await recordVoiceConsent("../noa", { agree: true, voiceId: CLONE, onBehalf: true })).toMatchObject({ ok: false, status: 404 });
    expect(await recordVoiceConsent("noa", { agree: true, voiceId: "a/b", onBehalf: true })).toMatchObject({ ok: false, status: 400 });
    expect(read("noa").voiceConsent).toBeUndefined();
  });

  it("uses a consented clone only for the person or an admin", async () => {
    const { recordVoiceConsent } = await import("./employees-disk");
    const { resolveTtsVoice } = await import("./voice-live");
    await recordVoiceConsent("noa", { agree: true, voiceId: CLONE, onBehalf: false });
    const ok = (r: Awaited<ReturnType<typeof resolveTtsVoice>>) => r.voiceId === CLONE && r.fallback === undefined;
    expect(ok(await resolveTtsVoice(CLONE, "noa", {}, { role: "member", employeeId: "noa" }))).toBe(true);
    expect(ok(await resolveTtsVoice(CLONE, "noa", {}, { role: "employee", employeeId: "noa" }))).toBe(true);
    expect(ok(await resolveTtsVoice(CLONE, "noa", {}, { role: "admin" }))).toBe(true);
    expect(ok(await resolveTtsVoice(CLONE, "noa", {}, null))).toBe(true);
    // Another member sends Noa's employeeId and voice id: refused, default voice.
    for (const requester of [{ role: "member" as const, employeeId: "amit" }, { role: "approver" as const }]) {
      const r = await resolveTtsVoice(CLONE, "noa", {}, requester);
      expect(r.voiceId).toBe(SARAH);
      expect(r.fallback).toMatchObject({ error: "voice_owner_only" });
    }
  });

  it("keeps the voice id, IP and user agent out of the employee list", async () => {
    const { recordVoiceConsent, loadEmployeesFromDisk } = await import("./employees-disk");
    await recordVoiceConsent("noa", { agree: true, voiceId: CLONE, onBehalf: true, headers: headers() });
    const noa = (await loadEmployeesFromDisk()).find((e) => e.id === "noa");
    expect(noa?.voiceConsent).toEqual({ grantedAt: read("noa").voiceConsent.grantedAt, onBehalf: true });
    const json = JSON.stringify(noa);
    for (const secret of [CLONE, "203.0.113.7", "TestBrowser"]) expect(json).not.toContain(secret);
  });

  it("issues no live token for a consented clone, and one for the default voice", async () => {
    const { recordVoiceConsent } = await import("./employees-disk");
    await recordVoiceConsent("noa", { agree: true, voiceId: CLONE, onBehalf: false });
    vi.doMock("@/lib/voice-live", async (orig) => ({
      ...(await orig<typeof import("./voice-live")>()),
      liveTokenRefusal: () => null,
      mintSingleUseToken: async () => "tok",
      ttsLiveUrl: (t: string) => `wss://x/${t}`,
    }));
    const { POST } = await import("@/app/api/tts/token/route");
    const call = (body: unknown) =>
      POST(new NextRequest("http://localhost/api/tts/token", { method: "POST", body: JSON.stringify(body) }));
    const clone = await call({ voiceId: CLONE, employeeId: "noa" });
    expect(clone.status).toBe(409);
    expect((await clone.json()).error).toBe("voice_server_only");
    const noConsent = await (await call({ voiceId: "OtherClone9", employeeId: "noa" })).json();
    expect(noConsent).toMatchObject({ url: "wss://x/tok", voiceId: SARAH, voiceFallback: { error: "voice_consent_required" } });
    expect((await call({ voiceId: "onwK4e9ZLuTAKqWW03F9" })).status).toBe(200);
    vi.doUnmock("@/lib/voice-live");
  });

  it("answers 404 for an unknown twin", async () => {
    const { recordVoiceConsent } = await import("./employees-disk");
    expect(await recordVoiceConsent("ghost", { agree: true, voiceId: CLONE, onBehalf: true })).toMatchObject({ ok: false, status: 404 });
  });
});
