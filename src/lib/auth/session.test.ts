import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "e001-auth-"));
  process.env.EMPLOYEE001_HOME = home;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.EMPLOYEE001_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const PW = "a long enough password";

describe("sessions", () => {
  it("never puts a reusable secret in the cookie and stores only a hash of the id", async () => {
    const store = await import("./store");
    const u = store.createUser({ email: "a@x.io", name: "A", role: "owner" });
    const cookie = store.createSession(u.id, "password", true);
    const [id] = cookie.split(".");
    const raw = fs.readFileSync(path.join(home, "data", "auth", "sessions.json"), "utf8");
    expect(raw).not.toContain(id);
    expect(store.resolveSession(cookie)?.user.id).toBe(u.id);
    expect(store.resolveSession(`${id}.forged`)).toBeNull();
    expect((fs.statSync(path.join(home, "data", "auth", "sessions.json")).mode & 0o777).toString(8)).toBe("600");
  });

  it("expires after 12 hours however active, and after 2 idle hours", async () => {
    const store = await import("./store");
    const u = store.createUser({ email: "a@x.io", name: "A", role: "owner" });
    const t0 = 1_800_000_000_000;
    let cookie = store.createSession(u.id, "password", true, t0);
    for (let t = t0; t < t0 + 12 * 3600_000; t += 25 * 60_000) {
      const r = store.resolveSession(cookie, t);
      expect(r, `at +${(t - t0) / 60_000}m`).not.toBeNull();
      cookie = r!.rotatedCookie ?? cookie;
    }
    expect(store.resolveSession(cookie, t0 + 12 * 3600_000 + 60_000)).toBeNull();

    const idle = store.createSession(u.id, "password", true, t0);
    expect(store.resolveSession(idle, t0 + 2 * 3600_000 + 60_000)).toBeNull();
  });

  it("rotates the id every 30 minutes; the old id works only for a short grace period", async () => {
    const store = await import("./store");
    const u = store.createUser({ email: "a@x.io", name: "A", role: "owner" });
    const t0 = 1_800_000_000_000;
    const first = store.createSession(u.id, "password", true, t0);
    const r = store.resolveSession(first, t0 + 31 * 60_000);
    expect(r?.rotatedCookie).toBeTruthy();
    expect(r!.rotatedCookie).not.toBe(first);
    expect(store.resolveSession(first, t0 + 31 * 60_000 + 30_000)?.rotatedCookie).toBeUndefined();
    expect(store.resolveSession(first, t0 + 33 * 60_000)).toBeNull();
    expect(store.resolveSession(r!.rotatedCookie, t0 + 33 * 60_000)).not.toBeNull();
  });

  it("signs a user out everywhere when revoked", async () => {
    const store = await import("./store");
    const u = store.createUser({ email: "a@x.io", name: "A", role: "admin" });
    const a = store.createSession(u.id, "password", true);
    const b = store.createSession(u.id, "password", true);
    expect(store.revokeUserSessions(u.id)).toBe(2);
    expect(store.resolveSession(a)).toBeNull();
    expect(store.resolveSession(b)).toBeNull();
  });
});

describe("sign-in", () => {
  it("creates the first owner once, then refuses", async () => {
    const login = await import("./login");
    const first = login.createFirstOwner({ email: "Owner@X.io", name: "O", password: PW });
    expect("user" in first && first.user.role).toBe("owner");
    expect(login.createFirstOwner({ email: "b@x.io", name: "B", password: PW })).toMatchObject({ error: expect.stringMatching(/already/) });
    expect(login.createFirstOwner).toBeTruthy();
  });

  it("logs in with a password, locks after 5 failures, and audits without secrets", async () => {
    const login = await import("./login");
    login.resetLoginLimits();
    login.createFirstOwner({ email: "o@x.io", name: "O", password: PW });
    expect(login.loginWithPassword("o@x.io", PW, "1.1.1.1").status).toBe("ok");
    for (let i = 0; i < 5; i++) expect(login.loginWithPassword("o@x.io", "wrong", "1.1.1.1").status).toBe("invalid");
    expect(login.loginWithPassword("o@x.io", PW, "1.1.1.1").status).toBe("locked");
    const audit = fs.readFileSync(path.join(home, "data", "audit.jsonl"), "utf8");
    expect(audit).not.toContain(PW);
    expect(audit).not.toContain("wrong");
  });

  it("requires the TOTP code when MFA is on and upgrades the session", async () => {
    const login = await import("./login");
    const store = await import("./store");
    const totp = await import("./totp");
    login.resetLoginLimits();
    const created = login.createFirstOwner({ email: "o@x.io", name: "O", password: PW });
    if (!("user" in created)) throw new Error("setup failed");
    const secret = totp.newTotpSecret();
    store.updateUser(created.user.id, { totp: { secret, enabled: true, lastStep: -1 } });

    const r = login.loginWithPassword("o@x.io", PW, "1.1.1.1");
    expect(r.status).toBe("mfa_required");
    const pending = (r as { cookie: string }).cookie;
    expect(store.resolveSession(pending)?.session.mfaPassed).toBe(false);
    expect(login.completeMfa(pending, "000000", "1.1.1.1")).toBeNull();
    const code = totp.totpAt(secret, totp.currentStep());
    const done = login.completeMfa(pending, code, "1.1.1.1");
    expect(done).not.toBeNull();
    expect(store.resolveSession(done!.cookie)?.session.mfaPassed).toBe(true);
    expect(store.resolveSession(pending)).toBeNull(); // the pre-MFA id is gone
    // The same code can't be used again.
    const again = login.loginWithPassword("o@x.io", PW, "1.1.1.1") as { cookie: string };
    expect(login.completeMfa(again.cookie, code, "1.1.1.1")).toBeNull();
  });

  it("links OIDC sign-ins by verified email and creates members only for allowed domains", async () => {
    const login = await import("./login");
    login.resetLoginLimits();
    const cfg = { issuer: "https://idp", clientId: "c", redirectUri: "r", allowedDomains: ["acme.com"] };
    const base = { iss: "https://idp", aud: "c", exp: 0, iat: 0 };
    expect(login.signInWithOidc({ ...base, sub: "s1", email: "x@other.com", email_verified: true }, cfg, "ip").status).toBe("invalid");
    const r = login.signInWithOidc({ ...base, sub: "s2", email: "dana@acme.com", email_verified: true }, cfg, "ip");
    expect(r.status === "ok" && r.user.role).toBe("member");
    expect(login.signInWithOidc({ ...base, sub: "s3", email: "eve@acme.com", email_verified: false }, cfg, "ip").status).toBe("invalid");
  });

  it("only redirects back to same-site paths", async () => {
    const { safeReturnTo } = await import("./login");
    expect(safeReturnTo("/flow?x=1")).toBe("/flow?x=1");
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
  });
});
