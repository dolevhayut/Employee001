import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { base32Decode, base32Encode, totpAt, verifyTotp } from "./totp";

describe("password hashing", () => {
  it("verifies the right password only, with a fresh salt each time", () => {
    const a = hashPassword("correct horse battery staple");
    expect(a).toMatch(/^scrypt\$/);
    expect(a).not.toBe(hashPassword("correct horse battery staple"));
    expect(verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(verifyPassword("correct horse battery stapl", a)).toBe(false);
    expect(verifyPassword("x", undefined)).toBe(false);
    expect(verifyPassword("x", "plain")).toBe(false);
  });

  it("requires 12+ characters", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("long enough pass")).toBeNull();
  });
});

describe("TOTP (RFC 6238 test vectors, SHA-1)", () => {
  // RFC 6238 Appendix B secret "12345678901234567890", 8-digit codes; the
  // last 6 digits are what a 6-digit authenticator shows.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30))).toBe(code);
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from("hello world, mfa!");
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it("accepts ±1 step, refuses replays and junk", () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, code, -1, now)).toBe(step);
    expect(verifyTotp(secret, code, step, now)).toBeNull(); // already used
    expect(verifyTotp(secret, totpAt(secret, step - 1), -1, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), -1, now)).toBeNull();
    expect(verifyTotp(secret, "12345", -1, now)).toBeNull();
  });
});
