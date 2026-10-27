import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_CODE_TTL_MS, POLL_INTERVAL_SECONDS, resolveBearer, setDeviceAuthClock } from "@/lib/mcp-server/device-auth";
import { POST as start } from "./start/route";
import { POST as poll } from "./poll/route";
import { POST as approve } from "./approve/route";
import { POST as revoke } from "./revoke/route";

let home: string;
let now: number;
const prevHome = process.env.EMPLOYEE001_HOME;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-device-routes-"));
  process.env.EMPLOYEE001_HOME = home;
  now = Date.parse("2026-10-27T09:00:00Z");
  setDeviceAuthClock(() => now);
});

afterEach(() => {
  setDeviceAuthClock();
  if (prevHome === undefined) delete process.env.EMPLOYEE001_HOME;
  else process.env.EMPLOYEE001_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const as = (id: string, role: string) => ({ "x-e001-user-id": id, "x-e001-user-role": role });

function post(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/mcp/device/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function begin() {
  const res = await start(post("start"));
  expect(res.status).toBe(200);
  return (await res.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number; interval: number };
}

describe("POST /api/mcp/device/start", () => {
  it("returns a device code, user code, verification URL and interval", async () => {
    const res = await start(post("start"));
    const body = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.device_code).toMatch(/^[\w-]{40,}$/);
    expect(body.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.verification_uri).toBe("http://localhost:3000/mcp/device");
    expect(body.verification_uri_complete).toBe(`http://localhost:3000/mcp/device?code=${body.user_code}`);
    expect(body.interval).toBe(POLL_INTERVAL_SECONDS);
    expect(body.expires_in).toBe(DEVICE_CODE_TTL_MS / 1000);
  });
});

describe("POST /api/mcp/device/poll", () => {
  it("is pending before approval and returns no token", async () => {
    const { device_code } = await begin();
    const res = await poll(post("poll", { device_code }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("authorization_pending");
    expect(body.access_token).toBeUndefined();
  });

  it("rejects an unapproved device code on every poll and issues no session", async () => {
    const { device_code } = await begin();
    for (let i = 0; i < 3; i++) {
      const res = await poll(post("poll", { device_code }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).not.toContain("access_token");
      now += POLL_INTERVAL_SECONDS * 1000;
    }
  });

  it("rejects an expired device code, approved or not, and issues no session", async () => {
    const unapproved = await begin();
    const approved = await begin();
    expect((await approve(post("approve", { user_code: approved.user_code }, as("ada", "member")))).status).toBe(200);
    now += DEVICE_CODE_TTL_MS + 1;
    for (const { device_code } of [unapproved, approved]) {
      const res = await poll(post("poll", { device_code }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("expired_token");
      expect(body.access_token).toBeUndefined();
    }
  });

  it("rejects an unknown device code and malformed bodies", async () => {
    const unknown = await poll(post("poll", { device_code: "nope" }));
    expect((await unknown.json()).error).toBe("invalid_grant");
    expect((await poll(post("poll", {}))).status).toBe(400);
    expect((await poll(post("poll", { device_code: 42 }))).status).toBe(400);
    expect((await poll(post("poll"))).status).toBe(400);
  });

  it("does not accept the user code in place of the device code", async () => {
    const { user_code } = await begin();
    expect((await (await poll(post("poll", { device_code: user_code }))).json()).error).toBe("invalid_grant");
  });

  it("tells a client that polls too fast to slow down", async () => {
    const { device_code } = await begin();
    await poll(post("poll", { device_code }));
    const res = await poll(post("poll", { device_code }));
    expect((await res.json()).error).toBe("slow_down");
  });
});

describe("POST /api/mcp/device/approve", () => {
  it("lets a signed-in person approve, and the poll then returns that person's session once", async () => {
    const { device_code, user_code } = await begin();
    const res = await approve(post("approve", { user_code: user_code.toLowerCase().replace("-", " ") }, as("ada", "member")));
    expect(res.status).toBe(200);
    expect((await res.json()).approved).toBe(true);

    now += POLL_INTERVAL_SECONDS * 1000;
    const ok = await poll(post("poll", { device_code }));
    const body = await ok.json();
    expect(ok.status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(resolveBearer(body.access_token)?.personId).toBe("ada");

    now += POLL_INTERVAL_SECONDS * 1000;
    const again = await poll(post("poll", { device_code }));
    expect((await again.json()).error).toBe("invalid_grant");
  });

  it("refuses without a signed-in session, and ignores an approver named in the body", async () => {
    const { device_code, user_code } = await begin();
    expect((await approve(post("approve", { user_code }))).status).toBe(401);
    await approve(post("approve", { user_code, personId: "mallory", approvedBy: "mallory" }, as("ada", "member")));
    now += POLL_INTERVAL_SECONDS * 1000;
    const body = await (await poll(post("poll", { device_code }))).json();
    expect(resolveBearer(body.access_token)?.personId).toBe("ada");
  });

  it("rejects unknown, expired and already-approved codes", async () => {
    const a = await begin();
    expect((await approve(post("approve", { user_code: "ZZZZ-ZZZZ" }, as("ada", "member")))).status).toBe(404);
    expect((await approve(post("approve", {}, as("ada", "member")))).status).toBe(400);
    expect((await approve(post("approve", { user_code: a.user_code }, as("ada", "member")))).status).toBe(200);
    expect((await approve(post("approve", { user_code: a.user_code }, as("bob", "member")))).status).toBe(409);
    now += DEVICE_CODE_TTL_MS + 1;
    const b = await begin();
    now += DEVICE_CODE_TTL_MS + 1;
    expect((await approve(post("approve", { user_code: b.user_code }, as("ada", "member")))).status).toBe(400);
  });
});

describe("POST /api/mcp/device/revoke", () => {
  async function signIn(person: string) {
    const { device_code, user_code } = await begin();
    await approve(post("approve", { user_code }, as(person, "member")));
    now += POLL_INTERVAL_SECONDS * 1000;
    const body = await (await poll(post("poll", { device_code }))).json();
    return body.access_token as string;
  }

  it("lets a person revoke their own sessions only", async () => {
    const ada = await signIn("ada");
    const bob = await signIn("bob");
    const res = await revoke(post("revoke", undefined, as("ada", "member")));
    expect(await res.json()).toEqual({ revoked: 1 });
    expect(resolveBearer(ada)).toBeNull();
    expect(resolveBearer(bob)?.personId).toBe("bob");
  });

  it("refuses a non-admin revoking someone else, and unauthenticated calls", async () => {
    const bob = await signIn("bob");
    expect((await revoke(post("revoke", { person_id: "bob" }, as("ada", "approver")))).status).toBe(403);
    expect((await revoke(post("revoke", { person_id: "bob" }))).status).toBe(401);
    expect(resolveBearer(bob)?.personId).toBe("bob");
  });

  it("lets an admin revoke another person's sessions", async () => {
    const bob = await signIn("bob");
    const res = await revoke(post("revoke", { person_id: "bob" }, as("root", "admin")));
    expect(res.status).toBe(200);
    expect(resolveBearer(bob)).toBeNull();
  });

  it("rejects a malformed person_id", async () => {
    expect((await revoke(post("revoke", { person_id: 7 }, as("root", "admin")))).status).toBe(400);
  });
});
