import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_CODE_TTL_MS,
  DeviceCodeLimitError,
  MAX_OUTSTANDING_CODES,
  MAX_OUTSTANDING_CODES_PER_IP,
  SESSION_TTL_MS,
  approveUserCode,
  exchangeDeviceCode,
  issueDeviceCode,
  resolveBearer,
  revokeBearer,
  revokePersonSessions,
  setDeviceAuthClock,
} from "./store";

// Everyone signing in below is a member of the app.
vi.mock("@/lib/auth/store", () => ({ getUser: (id: string) => ({ id, role: "member" }) }));

let home: string;
let now: number;
const prevHome = process.env.EMPLOYEE001_HOME;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-device-auth-"));
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

async function signIn(personId = "ada") {
  const issued = await issueDeviceCode();
  expect((await approveUserCode(issued.userCode, personId)).ok).toBe(true);
  const result = await exchangeDeviceCode(issued.deviceCode);
  if (result.status !== "approved") throw new Error("expected approval");
  return { issued, bearer: result.bearer };
}

describe("issue", () => {
  it("returns a device code, a readable user code and a short expiry", async () => {
    const issued = await issueDeviceCode();
    expect(issued.deviceCode.length).toBeGreaterThanOrEqual(40);
    expect(issued.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(issued.expiresAt).toBe(now + DEVICE_CODE_TTL_MS);
    expect(DEVICE_CODE_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("never stores raw codes or bearers", async () => {
    const { issued, bearer } = await signIn();
    const disk = fs.readFileSync(path.join(home, "data", "mcp-device-auth.json"), "utf8");
    expect(disk).not.toContain(issued.deviceCode);
    expect(disk).not.toContain(issued.userCode.replace("-", ""));
    expect(disk).not.toContain(bearer);
  });
});

describe("approve", () => {
  it("records who approved and when", async () => {
    const issued = await issueDeviceCode();
    expect((await exchangeDeviceCode(issued.deviceCode)).status).toBe("pending");
    now += 6000;
    expect(await approveUserCode(issued.userCode.toLowerCase(), "ada")).toEqual({
      ok: true,
      approvedAt: now,
    });
    expect(await approveUserCode(issued.userCode, "eve")).toEqual({
      ok: false,
      reason: "already_approved",
    });
    const ex = await exchangeDeviceCode(issued.deviceCode);
    expect(ex.status).toBe("approved");
    expect(resolveBearer((ex as { bearer: string }).bearer)?.personId).toBe("ada");
  });

  it("rejects unknown codes and empty person ids", async () => {
    const issued = await issueDeviceCode();
    expect(await approveUserCode("ZZZZ-ZZZZ", "ada")).toEqual({ ok: false, reason: "unknown" });
    expect(await approveUserCode(issued.userCode, "")).toEqual({ ok: false, reason: "unknown" });
  });

  it("hands the bearer over once only", async () => {
    const { issued } = await signIn();
    now += 6000;
    expect((await exchangeDeviceCode(issued.deviceCode)).status).toBe("consumed");
  });
});

describe("abuse limits", () => {
  it("tells a client that polls too fast to slow down", async () => {
    const issued = await issueDeviceCode();
    expect((await exchangeDeviceCode(issued.deviceCode)).status).toBe("pending");
    now += 1000;
    expect((await exchangeDeviceCode(issued.deviceCode)).status).toBe("slow_down");
  });

  it("stops one person's approvals after repeated wrong user codes", async () => {
    const issued = await issueDeviceCode();
    for (let i = 0; i < 10; i++) {
      expect(await approveUserCode("ZZZZ-ZZZZ", "eve")).toEqual({ ok: false, reason: "unknown" });
    }
    expect(await approveUserCode(issued.userCode, "eve")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    now += DEVICE_CODE_TTL_MS;
    const fresh = await issueDeviceCode();
    expect((await approveUserCode(fresh.userCode, "eve")).ok).toBe(true);
  });

  it("one person's wrong guesses never block another person's valid approval", async () => {
    const issued = await issueDeviceCode();
    for (let i = 0; i < 12; i++) await approveUserCode("ZZZZ-ZZZZ", "eve");
    expect(await approveUserCode(issued.userCode, "eve")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(await approveUserCode(issued.userCode, "ada")).toMatchObject({ ok: true });
  });
});

describe("issue caps", () => {
  it("refuses a requester past the per-IP cap but not other IPs", async () => {
    for (let i = 0; i < MAX_OUTSTANDING_CODES_PER_IP; i++) await issueDeviceCode({ ip: "203.0.113.7" });
    await expect(issueDeviceCode({ ip: "203.0.113.7" })).rejects.toMatchObject({ scope: "ip" });
    await expect(issueDeviceCode({ ip: "203.0.113.8" })).resolves.toBeTruthy();
    const disk = fs.readFileSync(path.join(home, "data", "mcp-device-auth.json"), "utf8");
    expect(disk).not.toContain("203.0.113.7");
  });

  it("frees the per-IP cap as codes expire", async () => {
    for (let i = 0; i < MAX_OUTSTANDING_CODES_PER_IP; i++) await issueDeviceCode({ ip: "198.51.100.1" });
    now += DEVICE_CODE_TTL_MS;
    await expect(issueDeviceCode({ ip: "198.51.100.1" })).resolves.toBeTruthy();
  });

  it("refuses everyone past the global cap", async () => {
    const devices: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OUTSTANDING_CODES; i++) {
      devices[`k${i}`] = { userCodeHash: `u${i}`, expiresAt: now + DEVICE_CODE_TTL_MS };
    }
    fs.mkdirSync(path.join(home, "data"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "data", "mcp-device-auth.json"),
      JSON.stringify({ devices, sessions: {} }),
    );
    await expect(issueDeviceCode()).rejects.toBeInstanceOf(DeviceCodeLimitError);
    await expect(issueDeviceCode({ ip: "192.0.2.1" })).rejects.toMatchObject({ scope: "global" });
    now += DEVICE_CODE_TTL_MS;
    await expect(issueDeviceCode()).resolves.toBeTruthy();
  });
});

describe("inherited keys in failedApprovals", () => {
  it("treats constructor, toString and __proto__ as ordinary person ids", async () => {
    const issued = await issueDeviceCode();
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(await approveUserCode("ZZZZ-ZZZZ", id)).toEqual({ ok: false, reason: "unknown" });
      expect(await approveUserCode("ZZZZ-ZZZZ", id)).toEqual({ ok: false, reason: "unknown" });
    }
    expect((await approveUserCode(issued.userCode, "constructor")).ok).toBe(true);
  });

  it("survives a store file with non-array failure entries", async () => {
    const issued = await issueDeviceCode();
    const f = path.join(home, "data", "mcp-device-auth.json");
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    raw.failedApprovals = { constructor: "x", toString: 5, eve: [1, "a", null] };
    fs.writeFileSync(f, JSON.stringify(raw));
    expect((await approveUserCode(issued.userCode, "constructor")).ok).toBe(true);
  });
});

describe("lock", () => {
  const lockPath = () => path.join(home, "data", "mcp-device-auth.json.lock");

  it("is released after each operation", async () => {
    await issueDeviceCode();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("reclaims a stale lock left by a crashed process", async () => {
    await issueDeviceCode();
    fs.writeFileSync(lockPath(), "dead-owner");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath(), old, old);
    await expect(issueDeviceCode()).resolves.toBeTruthy();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("does not remove a lock it does not own", async () => {
    await issueDeviceCode();
    // A live lock held by someone else: our release must never touch it.
    fs.writeFileSync(lockPath(), "someone-else");
    const pending = issueDeviceCode();
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.readFileSync(lockPath(), "utf8")).toBe("someone-else");
    fs.rmSync(lockPath());
    await expect(pending).resolves.toBeTruthy();
  });

  it("keeps every write when many callers race to reclaim the same stale lock", async () => {
    await issueDeviceCode();
    fs.writeFileSync(lockPath(), "dead-owner");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath(), old, old);
    const issued = await Promise.all(Array.from({ length: 10 }, () => issueDeviceCode()));
    const stored = JSON.parse(fs.readFileSync(path.join(home, "data", "mcp-device-auth.json"), "utf8"));
    expect(Object.keys(stored.devices)).toHaveLength(11); // the first call plus all ten racers
    expect(new Set(issued.map((i) => i.deviceCode)).size).toBe(10);
    expect(fs.existsSync(lockPath())).toBe(false);
    expect(fs.existsSync(`${lockPath()}.guard`)).toBe(false);
  });

  it("leaves a fresh lock alone and waits for it, with no guard left behind", async () => {
    await issueDeviceCode();
    fs.writeFileSync(lockPath(), "live-owner"); // fresh mtime, no pid prefix
    const pending = issueDeviceCode();
    await new Promise((r) => setTimeout(r, 80));
    expect(fs.readFileSync(lockPath(), "utf8")).toBe("live-owner");
    expect(fs.existsSync(`${lockPath()}.guard`)).toBe(false);
    fs.rmSync(lockPath());
    await pending;
  });

  it("ages out a guard left by a crashed process", async () => {
    await issueDeviceCode();
    const guard = `${lockPath()}.guard`;
    fs.writeFileSync(guard, "dead-guard");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(guard, old, old);
    await expect(issueDeviceCode()).resolves.toBeTruthy();
    expect(fs.existsSync(guard)).toBe(false);
  });

  it("reclaims a fresh lock whose owner process is dead", async () => {
    await issueDeviceCode();
    const dead = spawnSync(process.execPath, ["-e", ""]);
    fs.writeFileSync(lockPath(), `${dead.pid}:abc`);
    await expect(issueDeviceCode()).resolves.toBeTruthy();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("reclaims a guard left by a crashed process", async () => {
    await issueDeviceCode();
    const dead = spawnSync(process.execPath, ["-e", ""]);
    fs.writeFileSync(`${lockPath()}.guard`, `${dead.pid}:abc`);
    fs.writeFileSync(lockPath(), `${dead.pid}:abc`);
    await expect(issueDeviceCode()).resolves.toBeTruthy();
    expect(fs.existsSync(`${lockPath()}.guard`)).toBe(false);
  });

  it("never deletes a live lock it did not see go stale", async () => {
    await issueDeviceCode();
    fs.writeFileSync(lockPath(), `${process.pid}:live`);
    const pending = issueDeviceCode();
    await new Promise((r) => setTimeout(r, 80));
    expect(fs.readFileSync(lockPath(), "utf8")).toBe(`${process.pid}:live`);
    fs.rmSync(lockPath());
    await expect(pending).resolves.toBeTruthy();
  });

  it("keeps every write when many operations contend with a stale lock", async () => {
    await issueDeviceCode();
    fs.writeFileSync(lockPath(), "dead-owner");
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lockPath(), old, old);
    const issued = await Promise.all(Array.from({ length: 16 }, () => issueDeviceCode()));
    const results = await Promise.all(issued.map((i) => approveUserCode(i.userCode, "ada")));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("serialises concurrent operations without losing writes", async () => {
    const issued = await Promise.all(Array.from({ length: 8 }, () => issueDeviceCode()));
    const results = await Promise.all(issued.map((i) => approveUserCode(i.userCode, "ada")));
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("expiry (AC2)", () => {
  it("cannot be approved after expiry", async () => {
    const issued = await issueDeviceCode();
    now += DEVICE_CODE_TTL_MS;
    expect(await approveUserCode(issued.userCode, "ada")).toEqual({ ok: false, reason: "expired" });
    expect((await exchangeDeviceCode(issued.deviceCode)).status).toBe("expired");
  });

  it("an approved but unredeemed code expires too", async () => {
    const issued = await issueDeviceCode();
    await approveUserCode(issued.userCode, "ada");
    now += DEVICE_CODE_TTL_MS;
    expect((await exchangeDeviceCode(issued.deviceCode)).status).toBe("expired");
  });

  it("sessions expire", async () => {
    const { bearer } = await signIn();
    expect(resolveBearer(bearer)).not.toBeNull();
    now += SESSION_TTL_MS;
    expect(resolveBearer(bearer)).toBeNull();
  });
});

describe("resolve", () => {
  it("resolves nothing for unapproved codes, the device code itself, or junk", async () => {
    const issued = await issueDeviceCode();
    expect(resolveBearer(issued.deviceCode)).toBeNull();
    await approveUserCode(issued.userCode, "ada");
    expect(resolveBearer(issued.deviceCode)).toBeNull();
    expect(resolveBearer("")).toBeNull();
    expect(resolveBearer("nope")).toBeNull();
  });

  it("keeps two people's sessions separate", async () => {
    const a = await signIn("ada");
    const b = await signIn("bob");
    expect(resolveBearer(a.bearer)?.personId).toBe("ada");
    expect(resolveBearer(b.bearer)?.personId).toBe("bob");
  });
});

describe("corrupt store", () => {
  it("resolves nothing and refuses to overwrite it", async () => {
    const { bearer } = await signIn();
    const target = path.join(home, "data", "mcp-device-auth.json");
    fs.writeFileSync(target, "{not json");
    expect(resolveBearer(bearer)).toBeNull();
    await expect(issueDeviceCode()).rejects.toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("{not json");
  });
});

describe("revoke (AC3)", () => {
  it("a revoked person's sessions resolve to nothing; others are untouched", async () => {
    const a1 = await signIn("ada");
    const a2 = await signIn("ada");
    const b = await signIn("bob");
    expect(await revokePersonSessions("ada")).toBe(2);
    expect(resolveBearer(a1.bearer)).toBeNull();
    expect(resolveBearer(a2.bearer)).toBeNull();
    expect(resolveBearer(b.bearer)?.personId).toBe("bob");
  });

  it("drops an approved-but-unredeemed code", async () => {
    const issued = await issueDeviceCode();
    await approveUserCode(issued.userCode, "ada");
    await revokePersonSessions("ada");
    expect((await exchangeDeviceCode(issued.deviceCode)).status).toBe("invalid");
  });

  it("revokes a single bearer", async () => {
    const { bearer } = await signIn();
    expect(await revokeBearer(bearer)).toBe(true);
    expect(resolveBearer(bearer)).toBeNull();
    expect(await revokeBearer(bearer)).toBe(false);
  });

  it("stays revoked after other entries are pruned", async () => {
    const { bearer } = await signIn();
    await revokePersonSessions("ada");
    await issueDeviceCode();
    expect(resolveBearer(bearer)).toBeNull();
  });
});
