import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appBase, isCleartextRemote, readStoredSession, runLogin } from "../../bin/commands/login.mjs";

let dir: string;
let env: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e001-login-"));
  env = { EMPLOYEE001_MCP_SESSION_FILE: join(dir, "sub", "mcp-session.json") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const started = {
  device_code: "dev-secret",
  user_code: "ABCD-1234",
  verification_uri: "http://app/device",
  verification_uri_complete: "http://app/device?code=ABCD-1234",
  expires_in: 600,
  interval: 5,
};

describe("employee001 login", () => {
  it("prints the page and code, polls until approved, and stores the session privately", async () => {
    const polls = [
      reply({ error: "authorization_pending" }, 400),
      reply({ error: "slow_down" }, 400),
      reply({ access_token: "tok-1", token_type: "Bearer", expires_at: Date.now() + 60_000 }),
    ];
    const fetchFn = vi.fn(async (url: string) => (String(url).endsWith("/start") ? reply(started) : polls.shift()!));
    const sleeps: number[] = [];
    const out: string[] = [];
    const result = await runLogin({
      base: "http://app",
      env,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async (ms: number) => void sleeps.push(ms),
      write: (s: string) => void out.push(s),
    });
    expect(result.ok).toBe(true);
    expect(out.join("")).toContain("http://app/device?code=ABCD-1234");
    expect(out.join("")).toContain("ABCD-1234");
    expect(out.join("")).not.toContain("dev-secret");
    expect(sleeps).toEqual([5000, 5000, 10000]); // slow_down widens the interval
    const stored = readStoredSession(env);
    expect(stored).toMatchObject({ url: "http://app/api/mcp", token: "tok-1" });
    expect(statSync(env.EMPLOYEE001_MCP_SESSION_FILE).mode & 0o777).toBe(0o600);
  });

  it("stops with a clear message when the code expires, and stores nothing", async () => {
    const fetchFn = vi.fn(async (url: string) => (String(url).endsWith("/start") ? reply(started) : reply({ error: "expired_token", message: "x" }, 400)));
    const result = await runLogin({ base: "http://app", env, fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {}, write: () => {} });
    expect(result).toEqual({ ok: false, message: "That sign-in expired. Run the command again." });
    expect(readStoredSession(env)).toBeNull();
  });

  it("stops with a clear message when the person refuses the code, and stores nothing", async () => {
    const fetchFn = vi.fn(async (url: string) => (String(url).endsWith("/start") ? reply(started) : reply({ error: "access_denied", message: "x" }, 400)));
    const result = await runLogin({ base: "http://app", env, fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {}, write: () => {} });
    expect(result).toEqual({ ok: false, message: "That sign-in was refused in Employee001. Nothing was signed in." });
    expect(readStoredSession(env)).toBeNull();
  });

  it("reports an app that is not running", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await runLogin({ base: "http://app", env, fetchFn: fetchFn as unknown as typeof fetch, write: () => {} });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("not running");
  });

  it("gives up at the deadline", async () => {
    let t = 0;
    const fetchFn = vi.fn(async (url: string) => (String(url).endsWith("/start") ? reply({ ...started, expires_in: 10 }) : reply({ error: "authorization_pending" }, 400)));
    const result = await runLogin({
      base: "http://app",
      env,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
      write: () => {},
    });
    expect(result.ok).toBe(false);
  });

  it("ignores an expired or malformed stored session", () => {
    writeFileSync(join(dir, "s.json"), JSON.stringify({ url: "http://app/api/mcp", token: "t", expiresAt: 5 }));
    expect(readStoredSession({ EMPLOYEE001_MCP_SESSION_FILE: join(dir, "s.json") }, 10)).toBeNull();
    writeFileSync(join(dir, "s.json"), "not json");
    expect(readStoredSession({ EMPLOYEE001_MCP_SESSION_FILE: join(dir, "s.json") })).toBeNull();
    expect(readFileSync(join(dir, "s.json"), "utf8")).toBe("not json");
  });

  it("accepts the app address or the MCP endpoint", () => {
    expect(appBase("http://127.0.0.1:3000/api/mcp/")).toBe("http://127.0.0.1:3000");
    expect(appBase("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });
});

describe("isCleartextRemote", () => {
  it("flags plain http to another machine, not https or this machine", () => {
    expect(isCleartextRemote("http://10.0.0.5:3000")).toBe(true);
    expect(isCleartextRemote("http://mac-mini.local:3000")).toBe(true);
    expect(isCleartextRemote("https://e001.example.com")).toBe(false);
    expect(isCleartextRemote("http://127.0.0.1:3000")).toBe(false);
    expect(isCleartextRemote("http://localhost:3001")).toBe(false);
    expect(isCleartextRemote("http://[::1]:3000")).toBe(false);
  });
});
