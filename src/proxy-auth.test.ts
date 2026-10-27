import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-proxy-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  for (const k of ["EMPLOYEE001_HOME", "EMPLOYEE001_BIND", "EMPLOYEE001_TOKEN"]) delete process.env[k];
  fs.rmSync(home, { recursive: true, force: true });
});

const LAN = "http://192.168.1.20:3000";
function req(url: string, init: { method?: string; headers?: Record<string, string>; cookie?: string } = {}) {
  const host = new URL(url).host;
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers: { host, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) },
  });
}
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

async function load() {
  const { proxy } = await import("./proxy");
  const store = await import("./lib/auth/store");
  return { proxy, store };
}

describe("proxy: local install with no accounts", () => {
  it("acts as the implicit local owner on loopback", async () => {
    const { proxy } = await load();
    const res = proxy(req("http://127.0.0.1:3000/api/org/ask", { method: "POST" }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(forwarded(res, "x-e001-user-role")).toBe("owner");
  });

  it("drops identity headers a client tries to send", async () => {
    const { proxy } = await load();
    const res = proxy(req("http://127.0.0.1:3000/api/org/ask", { method: "POST", headers: { "x-e001-user-id": "attacker", "x-e001-user-role": "owner" } }));
    expect(forwarded(res, "x-e001-user-id")).toBe("local-owner");
  });
});

describe("proxy: exposed with no accounts (bootstrap)", () => {
  it("trades the token for a signed setup cookie, never the raw token", async () => {
    process.env.EMPLOYEE001_BIND = "0.0.0.0";
    process.env.EMPLOYEE001_TOKEN = "boot-token-123";
    const { proxy } = await load();
    const res = proxy(req(`${LAN}/flow?token=boot-token-123`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${LAN}/auth/setup`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("e001_bootstrap=");
    expect(setCookie).not.toContain("boot-token-123");
    const cookie = setCookie.split(";")[0];
    // The bootstrap cookie opens setup only.
    expect(proxy(req(`${LAN}/api/auth/setup`, { method: "POST", cookie })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req(`${LAN}/api/org/ask`, { method: "POST", cookie })).status).toBe(403);
  });
});

describe("proxy: personal MCP bearers (accounts mode)", () => {
  const ENV = ["EMPLOYEE001_MCP_PERSONAL_SIGNIN", "EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN", "EMPLOYEE001_MCP_TOKEN"];
  afterEach(() => {
    for (const k of ENV) delete process.env[k];
  });

  async function setup() {
    const { proxy, store } = await load();
    store.createUser({ email: "o@x.io", name: "O", role: "owner" });
    const device = await import("./lib/mcp-server/device-auth");
    const issued = await device.issueDeviceCode();
    await device.approveUserCode(issued.userCode, "person_ana");
    const exchanged = await device.exchangeDeviceCode(issued.deviceCode);
    if (exchanged.status !== "approved") throw new Error("not approved");
    return { proxy, device, bearer: exchanged.bearer };
  }
  const mcp = (bearer: string) =>
    req("http://127.0.0.1:3000/api/mcp", { method: "POST", headers: { authorization: `Bearer ${bearer}` } });

  it("admits a live personal bearer, and refuses it after revoke", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy, device, bearer } = await setup();
    expect(proxy(mcp(bearer)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(mcp("not-a-session-bearer")).status).toBe(401);
    await device.revokePersonSessions("person_ana");
    expect(proxy(mcp(bearer)).status).toBe(401);
  });

  it("ignores personal bearers while personal sign-in is off", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy, bearer } = await setup();
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "0";
    expect(proxy(mcp(bearer)).status).toBe(401);
  });

  it("follows the shared-token policy: refused once personal sign-in is on, unless opted in", async () => {
    process.env.EMPLOYEE001_MCP_TOKEN = "shared-secret-token";
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy } = await setup();
    expect(proxy(mcp("shared-secret-token")).status).toBe(401);
    process.env.EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN = "1";
    expect(proxy(mcp("shared-secret-token")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy: accounts exist", () => {
  async function withUser(role: "owner" | "admin" | "approver" | "member" | "employee", extra: Record<string, unknown> = {}) {
    const { proxy, store } = await load();
    const user = store.createUser({ email: `${role}@x.io`, name: role, role, ...extra });
    const cookie = `${store.SESSION_COOKIE}=${store.createSession(user.id, "password", true)}`;
    return { proxy, store, user, cookie };
  }

  it("requires sign-in on loopback too, and sends pages to /login", async () => {
    const { proxy } = await withUser("owner");
    expect(proxy(req("http://127.0.0.1:3000/api/org/ask", { method: "POST" })).status).toBe(401);
    const page = proxy(req("http://127.0.0.1:3000/council"));
    expect(page.status).toBe(307);
    const location = new URL(page.headers.get("location")!);
    expect(location.pathname + location.search).toBe("/login?next=%2Fcouncil");
  });

  it("forwards the verified user and enforces roles", async () => {
    const { proxy, cookie, user } = await withUser("member");
    const ok = proxy(req("http://127.0.0.1:3000/api/org/ask", { method: "POST", cookie }));
    expect(forwarded(ok, "x-e001-user-id")).toBe(user.id);
    expect(forwarded(ok, "x-e001-user-role")).toBe("member");
    expect(proxy(req("http://127.0.0.1:3000/api/audit/export", { cookie })).status).toBe(403);
    expect(proxy(req("http://127.0.0.1:3000/api/council/approve", { method: "POST", cookie })).status).toBe(403);
    expect(proxy(req("http://127.0.0.1:3000/settings", { cookie })).status).toBe(403);
  });

  it("keeps an employee to their own twin", async () => {
    const { proxy, cookie } = await withUser("employee", { employeeId: "noa" });
    expect(proxy(req("http://127.0.0.1:3000/api/employees/noa/file/TONE.md", { cookie })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("http://127.0.0.1:3000/api/employees/itai/file/TONE.md", { cookie })).status).toBe(403);
    expect(proxy(req("http://127.0.0.1:3000/api/twin/chat", { method: "POST", cookie })).status).toBe(403);
  });

  it("holds a session with MFA pending at the second-factor step", async () => {
    const { proxy, store } = await load();
    const user = store.createUser({ email: "m@x.io", name: "M", role: "owner", totp: { secret: "JBSWY3DPEHPK3PXP", enabled: true, lastStep: -1 } });
    const cookie = `${store.SESSION_COOKIE}=${store.createSession(user.id, "password", false)}`;
    const api = proxy(req("http://127.0.0.1:3000/api/org/ask", { method: "POST", cookie }));
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ reason: "second factor required" });
    expect(proxy(req("http://127.0.0.1:3000/flow", { cookie })).headers.get("location")).toContain("step=mfa");
  });

  it("lets webhooks and invites through to their own checks, and nothing else unsigned", async () => {
    const { proxy } = await withUser("owner");
    expect(proxy(req("http://127.0.0.1:3000/api/slack/composio", { method: "POST", headers: { "webhook-signature": "v1,x" } })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("http://127.0.0.1:3000/api/slack/composio", { method: "POST" })).status).toBe(401);
    expect(proxy(req("http://127.0.0.1:3000/api/invites/inv_abc123")).headers.get("x-middleware-next")).toBe("1");
  });
});
