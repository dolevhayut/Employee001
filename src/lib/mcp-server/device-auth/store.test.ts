import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEVICE_CODE_TTL_MS,
  SESSION_TTL_MS,
  approveUserCode,
  exchangeDeviceCode,
  issueDeviceCode,
  resolveBearer,
  revokeBearer,
  revokePersonSessions,
  setDeviceAuthClock,
} from "./store";

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

function signIn(personId = "ada") {
  const issued = issueDeviceCode();
  expect(approveUserCode(issued.userCode, personId).ok).toBe(true);
  const result = exchangeDeviceCode(issued.deviceCode);
  if (result.status !== "approved") throw new Error("expected approval");
  return { issued, bearer: result.bearer };
}

describe("issue", () => {
  it("returns a device code, a readable user code and a short expiry", () => {
    const issued = issueDeviceCode();
    expect(issued.deviceCode.length).toBeGreaterThanOrEqual(40);
    expect(issued.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(issued.expiresAt).toBe(now + DEVICE_CODE_TTL_MS);
    expect(DEVICE_CODE_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("never stores raw codes or bearers", () => {
    const { issued, bearer } = signIn();
    const disk = fs.readFileSync(path.join(home, "data", "mcp-device-auth.json"), "utf8");
    expect(disk).not.toContain(issued.deviceCode);
    expect(disk).not.toContain(issued.userCode.replace("-", ""));
    expect(disk).not.toContain(bearer);
  });
});

describe("approve", () => {
  it("records who approved and when", () => {
    const issued = issueDeviceCode();
    expect(exchangeDeviceCode(issued.deviceCode).status).toBe("pending");
    now += 1000;
    expect(approveUserCode(issued.userCode.toLowerCase(), "ada")).toEqual({
      ok: true,
      approvedAt: now,
    });
    expect(approveUserCode(issued.userCode, "eve")).toEqual({
      ok: false,
      reason: "already_approved",
    });
    const ex = exchangeDeviceCode(issued.deviceCode);
    expect(ex.status).toBe("approved");
    expect(resolveBearer((ex as { bearer: string }).bearer)?.personId).toBe("ada");
  });

  it("rejects unknown codes and empty person ids", () => {
    const issued = issueDeviceCode();
    expect(approveUserCode("ZZZZ-ZZZZ", "ada")).toEqual({ ok: false, reason: "unknown" });
    expect(approveUserCode(issued.userCode, "")).toEqual({ ok: false, reason: "unknown" });
  });

  it("hands the bearer over once only", () => {
    const { issued } = signIn();
    expect(exchangeDeviceCode(issued.deviceCode).status).toBe("consumed");
  });
});

describe("expiry (AC2)", () => {
  it("cannot be approved after expiry", () => {
    const issued = issueDeviceCode();
    now += DEVICE_CODE_TTL_MS;
    expect(approveUserCode(issued.userCode, "ada")).toEqual({ ok: false, reason: "expired" });
    expect(exchangeDeviceCode(issued.deviceCode).status).toBe("expired");
  });

  it("an approved but unredeemed code expires too", () => {
    const issued = issueDeviceCode();
    approveUserCode(issued.userCode, "ada");
    now += DEVICE_CODE_TTL_MS;
    expect(exchangeDeviceCode(issued.deviceCode).status).toBe("expired");
  });

  it("sessions expire", () => {
    const { bearer } = signIn();
    expect(resolveBearer(bearer)).not.toBeNull();
    now += SESSION_TTL_MS;
    expect(resolveBearer(bearer)).toBeNull();
  });
});

describe("resolve", () => {
  it("resolves nothing for unapproved codes, the device code itself, or junk", () => {
    const issued = issueDeviceCode();
    expect(resolveBearer(issued.deviceCode)).toBeNull();
    approveUserCode(issued.userCode, "ada");
    expect(resolveBearer(issued.deviceCode)).toBeNull();
    expect(resolveBearer("")).toBeNull();
    expect(resolveBearer("nope")).toBeNull();
  });

  it("keeps two people's sessions separate", () => {
    const a = signIn("ada");
    const b = signIn("bob");
    expect(resolveBearer(a.bearer)?.personId).toBe("ada");
    expect(resolveBearer(b.bearer)?.personId).toBe("bob");
  });
});

describe("corrupt store", () => {
  it("resolves nothing and refuses to overwrite it", () => {
    const { bearer } = signIn();
    const target = path.join(home, "data", "mcp-device-auth.json");
    fs.writeFileSync(target, "{not json");
    expect(resolveBearer(bearer)).toBeNull();
    expect(() => issueDeviceCode()).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("{not json");
  });
});

describe("revoke (AC3)", () => {
  it("a revoked person's sessions resolve to nothing; others are untouched", () => {
    const a1 = signIn("ada");
    const a2 = signIn("ada");
    const b = signIn("bob");
    expect(revokePersonSessions("ada")).toBe(2);
    expect(resolveBearer(a1.bearer)).toBeNull();
    expect(resolveBearer(a2.bearer)).toBeNull();
    expect(resolveBearer(b.bearer)?.personId).toBe("bob");
  });

  it("drops an approved-but-unredeemed code", () => {
    const issued = issueDeviceCode();
    approveUserCode(issued.userCode, "ada");
    revokePersonSessions("ada");
    expect(exchangeDeviceCode(issued.deviceCode).status).toBe("invalid");
  });

  it("revokes a single bearer", () => {
    const { bearer } = signIn();
    expect(revokeBearer(bearer)).toBe(true);
    expect(resolveBearer(bearer)).toBeNull();
    expect(revokeBearer(bearer)).toBe(false);
  });

  it("stays revoked after other entries are pruned", () => {
    const { bearer } = signIn();
    revokePersonSessions("ada");
    issueDeviceCode();
    expect(resolveBearer(bearer)).toBeNull();
  });
});
