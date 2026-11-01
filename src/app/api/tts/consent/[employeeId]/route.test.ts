import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeApi } from "@/lib/auth/rbac";

let home: string;
const sidecar = (id: string) => path.join(home, "data", "employees", id, "employee.json");
const read = (id: string) => JSON.parse(fs.readFileSync(sidecar(id), "utf8"));

type User = { role: string; employee?: string };

function post(id: string, body: unknown, user?: User) {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "RouteTest/1" };
  if (user) {
    headers["x-e001-user-id"] = "u1";
    headers["x-e001-user-role"] = user.role;
    if (user.employee) headers["x-e001-user-employee"] = user.employee;
  }
  return new NextRequest(`http://localhost/api/tts/consent/${id}`, { method: "POST", headers, body: JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ employeeId: id }) });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-voice-route-"));
  process.env.EMPLOYEE001_HOME = home;
  for (const id of ["noa", "amit"]) {
    fs.mkdirSync(path.dirname(sidecar(id)), { recursive: true });
    fs.writeFileSync(sidecar(id), JSON.stringify({ id, name: id }));
  }
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("POST /api/tts/consent/[employeeId]", () => {
  it("records first-hand consent when the person is signed in as themself", async () => {
    const { POST } = await import("./route");
    const res = await POST(post("noa", { agree: true, voiceId: "Clone123" }, { role: "member", employee: "noa" }), ctx("noa"));
    expect(res.status).toBe(200);
    expect(read("noa").voiceConsent.onBehalf).toBeUndefined();
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("Clone123");
    expect(json.consent.onBehalf).toBeUndefined();
  });

  it("lets a person with the employee role consent for themself", async () => {
    const { POST } = await import("./route");
    const res = await POST(post("noa", { agree: true, voiceId: "Clone123" }, { role: "employee", employee: "noa" }), ctx("noa"));
    expect(res.status).toBe(200);
    expect(read("noa").voiceConsent.onBehalf).toBeUndefined();
  });

  it("marks an admin's consent as on behalf, owners included, and works without accounts", async () => {
    const { POST } = await import("./route");
    for (const user of [{ role: "admin" }, { role: "owner" }, undefined]) {
      await POST(post("noa", { agree: false }, user), ctx("noa"));
      const res = await POST(post("noa", { agree: true, voiceId: "Clone123" }, user), ctx("noa"));
      expect(res.status).toBe(200);
      expect((await res.json()).consent.onBehalf).toBe(true);
      expect(read("noa").voiceConsent.onBehalf).toBe(true);
    }
  });

  it("refuses a member speaking for someone else", async () => {
    const { POST } = await import("./route");
    const res = await POST(post("noa", { agree: true, voiceId: "Clone123" }, { role: "member", employee: "amit" }), ctx("noa"));
    expect(res.status).toBe(403);
    expect(read("noa").voiceConsent).toBeUndefined();
  });

  it("validates the body", async () => {
    const { POST } = await import("./route");
    expect((await POST(post("../x", { agree: true, voiceId: "x" }), ctx("../x"))).status).toBe(400);
    expect((await POST(post("noa", { agree: "yes" }), ctx("noa"))).status).toBe(400);
    expect((await POST(post("noa", { agree: true }), ctx("noa"))).status).toBe(400);
    expect((await POST(post("ghost", { agree: true, voiceId: "Clone123" }), ctx("ghost"))).status).toBe(404);
  });
});

describe("GET /api/tts/consent/[employeeId]", () => {
  it("reports status and whether it covers a voice, and never reveals the voice id", async () => {
    const { resolveTtsVoice } = await import("@/lib/voice-live");
    const r = await resolveTtsVoice("Clone123", "noa", {});
    expect(r.fallback?.error).toBe("voice_consent_required");

    const { POST, GET } = await import("./route");
    await POST(post("noa", { agree: true, voiceId: "Clone123" }), ctx("noa"));
    const get = async (q: string) => {
      const res = await GET(new NextRequest(`http://localhost/api/tts/consent/noa${q}`), ctx("noa"));
      return res.json();
    };
    const json = await get("?voiceId=Clone123");
    expect(JSON.stringify(json)).not.toContain("Clone123");
    expect(json.consent).toMatchObject({ onBehalf: true });
    expect(json.covers).toBe(true);
    expect((await get("?voiceId=Other456")).covers).toBe(false);
    expect((await get("")).covers).toBe(false);
  });
});

describe("access to the consent route", () => {
  const path_ = "/api/tts/consent/noa";
  it("lets the employee role reach their own record only", () => {
    for (const method of ["GET", "POST"]) {
      expect(authorizeApi(path_, method, { id: "u", role: "employee", employeeId: "noa" }).allow).toBe(true);
      expect(authorizeApi(path_, method, { id: "u", role: "employee", employeeId: "amit" }).allow).toBe(false);
      expect(authorizeApi(path_, method, { id: "u", role: "admin" }).allow).toBe(true);
    }
  });
});
