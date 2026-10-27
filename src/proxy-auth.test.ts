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
    const ana = store.createUser({ email: "ana@x.io", name: "Ana", role: "member" });
    const device = await import("./lib/mcp-server/device-auth");
    const issued = await device.issueDeviceCode();
    await device.approveUserCode(issued.userCode, ana.id);
    const exchanged = await device.exchangeDeviceCode(issued.deviceCode);
    if (exchanged.status !== "approved") throw new Error("not approved");
    return { proxy, device, store, ana, bearer: exchanged.bearer };
  }
  const mcp = (bearer: string) =>
    req("http://127.0.0.1:3000/api/mcp", { method: "POST", headers: { authorization: `Bearer ${bearer}` } });

  it("admits a live personal bearer, and refuses it after revoke", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy, device, ana, bearer } = await setup();
    expect(proxy(mcp(bearer)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(mcp("not-a-session-bearer")).status).toBe(401);
    await device.revokePersonSessions(ana.id);
    expect(proxy(mcp(bearer)).status).toBe(401);
  });

  it("refuses the bearer of a person who was deleted or disabled", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy, store, ana, bearer } = await setup();
    store.updateUser(ana.id, { disabled: true });
    expect(proxy(mcp(bearer)).status).toBe(401);
    store.updateUser(ana.id, { disabled: false });
    expect(proxy(mcp(bearer)).headers.get("x-middleware-next")).toBe("1");
    store.deleteUser(ana.id);
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

describe("proxy: personal MCP sign-in bearers", () => {
  async function mint(personId: string) {
    const auth = await import("./lib/mcp-server/device-auth");
    const issued = await auth.issueDeviceCode();
    expect((await auth.approveUserCode(issued.userCode, personId)).ok).toBe(true);
    const exchanged = await auth.exchangeDeviceCode(issued.deviceCode);
    if (exchanged.status !== "approved") throw new Error("not approved");
    return exchanged.bearer;
  }
  const mcp = (url: string, bearer: string) => req(url, { method: "POST", headers: { authorization: `Bearer ${bearer}` } });
  afterEach(() => {
    for (const k of ["EMPLOYEE001_MCP_PERSONAL_SIGNIN", "EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN", "EMPLOYEE001_MCP_TOKEN"]) delete process.env[k];
  });

  it("accepts a personal session as that person on /api/mcp when accounts exist", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy, store } = await load();
    store.createUser({ id: "usr_ada", email: "o@x.io", name: "o", role: "owner" });
    const bearer = await mint("usr_ada");
    const res = proxy(mcp("http://127.0.0.1:3000/api/mcp", bearer));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(forwarded(res, "x-e001-user-id")).toBe("usr_ada");
    store.updateUser("usr_ada", { disabled: true });
    store.createUser({ email: "p@x.io", name: "p", role: "owner" });
    expect(proxy(mcp("http://127.0.0.1:3000/api/mcp", bearer)).status).toBe(401);
    expect(proxy(mcp("http://127.0.0.1:3000/api/mcp", "not-a-session")).status).toBe(401);
  });

  it("accepts a personal session on an exposed bind before accounts exist", async () => {
    process.env.EMPLOYEE001_BIND = "0.0.0.0";
    process.env.EMPLOYEE001_TOKEN = "boot-token-123";
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy } = await load();
    const bearer = await mint("usr_ada");
    expect(proxy(mcp(`${LAN}/api/mcp`, bearer)).headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses shared tokens once personal sign-in is on, unless an admin opts in", async () => {
    process.env.EMPLOYEE001_MCP_TOKEN = "shared-mcp";
    const { proxy, store } = await load();
    store.createUser({ email: "o@x.io", name: "o", role: "owner" });
    expect(proxy(mcp("http://127.0.0.1:3000/api/mcp", "shared-mcp")).headers.get("x-middleware-next")).toBe("1");
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    expect(proxy(mcp("http://127.0.0.1:3000/api/mcp", "shared-mcp")).status).toBe(401);
    process.env.EMPLOYEE001_MCP_ALLOW_SHARED_TOKEN = "1";
    expect(proxy(mcp("http://127.0.0.1:3000/api/mcp", "shared-mcp")).headers.get("x-middleware-next")).toBe("1");
  });

  it("stops honouring a local-owner session once accounts exist", async () => {
    process.env.EMPLOYEE001_MCP_PERSONAL_SIGNIN = "1";
    const { proxy, store } = await load();
    const bearer = await mint("local-owner");
    expect(proxy(mcp("http://127.0.0.1:3000/api/mcp", bearer)).headers.get("x-middleware-next")).toBe("1");
    store.createUser({ email: "o@x.io", name: "o", role: "owner" });
    expect(proxy(mcp("http://127.0.0.1:3000/api/mcp", bearer)).status).toBe(401);
  });

  it("revokes local-owner sessions when the first owner is created", async () => {
    await load();
    const bearer = await mint("local-owner");
    const { createFirstOwner } = await import("./lib/auth/login");
    const { resolveBearer } = await import("./lib/mcp-server/device-auth");
    expect(resolveBearer(bearer)).not.toBeNull();
    const created = createFirstOwner({ email: "o@x.io", name: "Owner", password: "correct horse battery staple 9!" });
    expect("user" in created).toBe(true);
    await vi.waitFor(() => expect(resolveBearer(bearer)).toBeNull());
  });
});
