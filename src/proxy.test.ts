import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { crossSiteBlock, proxy } from "./proxy";

function req(url: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, { method: init.method ?? "GET", headers: init.headers });
}

afterEach(() => {
  delete process.env.EMPLOYEE001_BIND;
  delete process.env.EMPLOYEE001_ALLOWED_HOSTS;
});

describe("crossSiteBlock on a loopback bind", () => {
  it("allows loopback hosts", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
      expect(crossSiteBlock(req("http://127.0.0.1:3000/api/x", { headers: { host } }), true)).toBeNull();
    }
  });

  it("blocks a rebinding host", async () => {
    const res = crossSiteBlock(req("http://evil.example/api/approvals/pending", { headers: { host: "evil.example:3000" } }), true);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "forbidden", reason: "host" });
  });

  it("allows hosts listed in EMPLOYEE001_ALLOWED_HOSTS", () => {
    process.env.EMPLOYEE001_ALLOWED_HOSTS = "mac.tail1234.ts.net";
    expect(crossSiteBlock(req("http://x/", { headers: { host: "mac.tail1234.ts.net" } }), true)).toBeNull();
  });

  it("blocks a cross-site POST but allows same-origin and Origin-less POSTs", () => {
    const headers = { host: "127.0.0.1:3000" };
    const cross = req("http://127.0.0.1:3000/api/council/approve", { method: "POST", headers: { ...headers, origin: "https://evil.example" } });
    const same = req("http://127.0.0.1:3000/api/council/approve", { method: "POST", headers: { ...headers, origin: "http://127.0.0.1:3000" } });
    const localhostAlias = req("http://127.0.0.1:3000/api/council/approve", { method: "POST", headers: { ...headers, origin: "http://localhost:3000" } });
    const cli = req("http://127.0.0.1:3000/api/mcp", { method: "POST", headers });
    const opaque = req("http://127.0.0.1:3000/api/council/approve", { method: "POST", headers: { ...headers, origin: "null" } });
    expect(crossSiteBlock(cross, true)?.status).toBe(403);
    expect(crossSiteBlock(same, true)).toBeNull();
    expect(crossSiteBlock(localhostAlias, true)).toBeNull();
    expect(crossSiteBlock(cli, true)).toBeNull();
    expect(crossSiteBlock(opaque, true)?.status).toBe(403);
  });

  it("does not check Origin on safe methods", () => {
    const get = req("http://127.0.0.1:3000/", { headers: { host: "127.0.0.1:3000", origin: "https://evil.example" } });
    expect(crossSiteBlock(get, true)).toBeNull();
  });
});

describe("crossSiteBlock edge cases", () => {
  it("rejects malformed Host authorities instead of normalizing them to loopback", () => {
    for (const host of ["evil.example@127.0.0.1:3000", "127.0.0.1#evil", "127.0.0.1/x", "127.0.0.1 :3000"]) {
      expect(crossSiteBlock(req("http://127.0.0.1:3000/", { headers: { host } }), true)?.status).toBe(403);
    }
  });

  it("accepts a trailing-dot loopback name", () => {
    expect(crossSiteBlock(req("http://localhost:3000/", { headers: { host: "localhost.:3000" } }), true)).toBeNull();
  });

  it("rejects a loopback origin on another port", () => {
    const r = req("http://127.0.0.1:3000/api/x", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://localhost:8080" } });
    expect(crossSiteBlock(r, true)?.status).toBe(403);
  });

  it("treats a default port as equal to no port", () => {
    const r = req("https://e001.example/api/x", { method: "POST", headers: { host: "e001.example", origin: "https://e001.example:443" } });
    expect(crossSiteBlock(r, false)).toBeNull();
  });

  it("blocks an Origin-less browser POST marked cross-site", () => {
    const r = req("http://127.0.0.1:3000/api/x", { method: "POST", headers: { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" } });
    expect(crossSiteBlock(r, true)?.status).toBe(403);
  });

  it("accepts an allow-listed origin when Host was rewritten to loopback", () => {
    process.env.EMPLOYEE001_ALLOWED_HOSTS = "mac.tail1234.ts.net";
    const r = req("http://127.0.0.1:3000/api/x", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "https://mac.tail1234.ts.net" } });
    expect(crossSiteBlock(r, true)).toBeNull();
  });
});

describe("crossSiteBlock on a non-loopback bind (LAN / Fly)", () => {
  it("accepts any Host but still requires a same-origin POST", () => {
    const headers = { host: "employee001-dolev.fly.dev" };
    expect(crossSiteBlock(req("https://employee001-dolev.fly.dev/", { headers }), false)).toBeNull();
    const same = req("https://employee001-dolev.fly.dev/api/x", { method: "POST", headers: { ...headers, origin: "https://employee001-dolev.fly.dev" } });
    const cross = req("https://employee001-dolev.fly.dev/api/x", { method: "POST", headers: { ...headers, origin: "http://localhost:3000" } });
    expect(crossSiteBlock(same, false)).toBeNull();
    expect(crossSiteBlock(cross, false)?.status).toBe(403);
  });
});

describe("proxy", () => {
  it("rejects a rebinding request before anything else", () => {
    const res = proxy(req("http://evil.example:3000/api/approvals/pending", { headers: { host: "evil.example:3000" } }));
    expect(res.status).toBe(403);
  });
});
