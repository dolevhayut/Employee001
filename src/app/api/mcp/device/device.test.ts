import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_CODE_TTL_MS, POLL_INTERVAL_SECONDS, resolveBearer, setDeviceAuthClock } from "@/lib/mcp-server/device-auth";
import { POST as start } from "./start/route";
import { POST as poll } from "./poll/route";
import { POST as approve } from "./approve/route";
import { POST as deny } from "./deny/route";
import { POST as revoke } from "./revoke/route";
import { resetSlots } from "./respond";

// People known to the app: anyone not listed here does not exist.
const users = new Map<string, { id: string; role: string; disabled?: boolean }>();
vi.mock("@/lib/auth/store", () => ({ getUser: (id: string) => users.get(id) }));

let home: string;
let now: number;
const prevHome = process.env.EMPLOYEE001_HOME;
const prevSignIn = process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN;

beforeEach(() => {
  resetSlots();
  process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
  users.clear();
  for (const id of ["ada", "bob", "root"]) users.set(id, { id, role: "admin" });
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-device-routes-"));
  process.env.EMPLOYEE001_HOME = home;
  now = Date.parse("2026-10-27T09:00:00Z");
  setDeviceAuthClock(() => now);
});

afterEach(() => {
  setDeviceAuthClock();
  if (prevSignIn === undefined) delete process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN;
  else process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = prevSignIn;
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
    expect(body.verification_uri).toBe("http://localhost:3000/device");
    expect(body.verification_uri_complete).toBe(`http://localhost:3000/device?code=${body.user_code}`);
    expect(body.interval).toBe(POLL_INTERVAL_SECONDS);
    expect(body.expires_in).toBe(DEVICE_CODE_TTL_MS / 1000);
  });
});

describe("rate limits on the public routes", () => {
  it("answers 429 once start or poll is called too often", async () => {
    for (let i = 0; i < 30; i++) expect((await start(post("start"))).status).toBe(200);
    expect((await start(post("start"))).status).toBe(429);
    const code = "A".repeat(43);
    for (let i = 0; i < 300; i++) await poll(post("poll", { device_code: code }));
    expect((await poll(post("poll", { device_code: code }))).status).toBe(429);
  });

  it("keeps a separate bucket per client, so one caller cannot lock out another", async () => {
    const from = (ip: string) => post("start", undefined, { "x-forwarded-for": ip });
    for (let i = 0; i < 30; i++) expect((await start(from("203.0.113.1"))).status).toBe(200);
    expect((await start(from("203.0.113.1"))).status).toBe(429);
    expect((await start(from("203.0.113.2"))).status).toBe(200);
    const code = "B".repeat(43);
    const pollFrom = (ip: string) => poll(post("poll", { device_code: code }, { "x-forwarded-for": ip }));
    for (let i = 0; i < 300; i++) await pollFrom("198.51.100.1");
    expect((await pollFrom("198.51.100.1")).status).toBe(429);
    expect((await pollFrom("198.51.100.2")).status).toBe(400);
  });

  it("does not spend rate-limit slots on malformed device codes", async () => {
    for (let i = 0; i < 400; i++) expect((await poll(post("poll", { device_code: `junk${i}` }))).status).toBe(400);
    const { device_code } = await begin();
    const res = await poll(post("poll", { device_code }));
    expect((await res.json()).error).toBe("authorization_pending");
  });
});

describe("POST /api/mcp/device/deny", () => {
  it("needs a signed-in person", async () => {
    const { user_code } = await begin();
    expect((await deny(post("deny", { user_code }))).status).toBe(401);
  });

  it("invalidates the code: the poller gets access_denied and nobody can approve it", async () => {
    const { device_code, user_code } = await begin();
    const res = await deny(post("deny", { user_code }, as("ada", "member")));
    expect(res.status).toBe(200);
    expect((await res.json()).denied).toBe(true);

    const polled = await poll(post("poll", { device_code }));
    const body = await polled.json();
    expect(polled.status).toBe(400);
    expect(body.error).toBe("access_denied");
    expect(body.access_token).toBeUndefined();

    const late = await approve(post("approve", { user_code }, as("bob", "member")));
    expect(late.status).toBe(409);
    now += POLL_INTERVAL_SECONDS * 1000;
    expect((await (await poll(post("poll", { device_code }))).json()).error).toBe("access_denied");
  });

  it("will not refuse a code that was already approved, and 404s an unknown one", async () => {
    const { user_code } = await begin();
    await approve(post("approve", { user_code }, as("ada", "member")));
    expect((await deny(post("deny", { user_code }, as("ada", "member")))).status).toBe(409);
    expect((await deny(post("deny", { user_code: "ZZZZ-ZZZZ" }, as("ada", "member")))).status).toBe(404);
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
    const unknown = await poll(post("poll", { device_code: "n".repeat(43) }));
    expect((await unknown.json()).error).toBe("invalid_grant");
    expect((await poll(post("poll", {}))).status).toBe(400);
    expect((await poll(post("poll", { device_code: 42 }))).status).toBe(400);
    expect((await poll(post("poll"))).status).toBe(400);
  });

  it("does not accept the user code in place of the device code", async () => {
    const { user_code } = await begin();
    expect((await (await poll(post("poll", { device_code: user_code }))).json()).error).toBe("invalid_request");
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

  it("stops honouring a session when its person is deleted, disabled or demoted", async () => {
    const a = await signIn("ada");
    const b = await signIn("bob");
    const c = await signIn("root");
    users.delete("ada");
    users.set("bob", { id: "bob", role: "admin", disabled: true });
    users.set("root", { id: "root", role: "employee" });
    expect(resolveBearer(a)).toBeNull();
    expect(resolveBearer(b)).toBeNull();
    expect(resolveBearer(c)).toBeNull();
    users.set("bob", { id: "bob", role: "member" });
    expect(resolveBearer(b)?.personId).toBe("bob");
  });
});

describe("personal sign-in switched off", () => {
  it("start, poll and approve answer 404 and mint nothing", async () => {
    delete process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN;
    expect((await start(post("start"))).status).toBe(404);
    expect((await poll(post("poll", { device_code: "x".repeat(43) }))).status).toBe(404);
    expect((await approve(post("approve", { user_code: "ABCD-EFGH" }, as("ada", "member")))).status).toBe(404);
    expect(fs.existsSync(path.join(home, "data", "mcp-device-auth.json"))).toBe(false);
  });

  it("a code started while on is not usable once the flag is turned off", async () => {
    const { device_code, user_code } = await begin();
    delete process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN;
    expect((await approve(post("approve", { user_code }, as("ada", "member")))).status).toBe(404);
    expect((await poll(post("poll", { device_code }))).status).toBe(404);
  });
});
