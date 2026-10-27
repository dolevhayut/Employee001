import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const sidecar = (id: string) => path.join(home, "data", "employees", id, "employee.json");
const read = (id: string) => JSON.parse(fs.readFileSync(sidecar(id), "utf8"));

function post(body: unknown, user?: { role: string; employee?: string }) {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "RouteTest/1" };
  if (user) {
    headers["x-e001-user-id"] = "u1";
    headers["x-e001-user-role"] = user.role;
    if (user.employee) headers["x-e001-user-employee"] = user.employee;
  }
  return new NextRequest("http://localhost/api/tts/consent", { method: "POST", headers, body: JSON.stringify(body) });
}

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

describe("POST /api/tts/consent", () => {
  it("records first-hand consent when the person is signed in as themself", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ employeeId: "noa", agree: true, voiceId: "Clone123" }, { role: "member", employee: "noa" }));
    expect(res.status).toBe(200);
    expect(read("noa").voiceConsent.onBehalf).toBeUndefined();
  });

  it("marks an admin's consent as on behalf, owners included, and works without accounts", async () => {
    const { POST } = await import("./route");
    for (const user of [{ role: "admin" }, { role: "owner" }, undefined]) {
      await POST(post({ employeeId: "noa", agree: false }, user));
      const res = await POST(post({ employeeId: "noa", agree: true, voiceId: "Clone123" }, user));
      expect(res.status).toBe(200);
      expect(read("noa").voiceConsent.onBehalf).toBe(true);
    }
  });

  it("refuses a member speaking for someone else", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ employeeId: "noa", agree: true, voiceId: "Clone123" }, { role: "member", employee: "amit" }));
    expect(res.status).toBe(403);
    expect(read("noa").voiceConsent).toBeUndefined();
  });

  it("validates the body", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ agree: true, voiceId: "x" }))).status).toBe(400);
    expect((await POST(post({ employeeId: "../x", agree: true, voiceId: "x" }))).status).toBe(400);
    expect((await POST(post({ employeeId: "noa", agree: "yes" }))).status).toBe(400);
    expect((await POST(post({ employeeId: "noa", agree: true }))).status).toBe(400);
    expect((await POST(post({ employeeId: "ghost", agree: true, voiceId: "Clone123" }))).status).toBe(404);
  });
});

describe("GET /api/tts/consent", () => {
  it("reports the fallback reason without consent, and never reveals the voice id", async () => {
    const { resolveTtsVoice } = await import("@/lib/voice-live");
    const r = await resolveTtsVoice("Clone123", "noa", {});
    expect(r.fallback?.error).toBe("voice_consent_required");

    const { POST } = await import("./route");
    await POST(post({ employeeId: "noa", agree: true, voiceId: "Clone123" }));
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/tts/consent?employeeId=noa"));
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("Clone123");
    expect(json.consent).toMatchObject({ onBehalf: true });
  });
});
