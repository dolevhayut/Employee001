// Sign-in flows on top of store.ts: password (+ TOTP), OIDC, first-owner
// setup. Every attempt is audited (user id, method, outcome, client IP;
// never the password or code). Failed attempts are rate limited per
// account and per IP.

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir } from "../app-home";
import { appendAuditEntry } from "../audit-log";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { verifyTotp } from "./totp";
import { emailVerified, type IdClaims, type OidcConfig } from "./oidc";
import {
  accountsEnabled,
  createSession,
  createUser,
  findUserByEmail,
  listUsers,
  updateUser,
  upgradeSessionMfa,
  resolveSession,
  type User,
} from "./store";
import { addPersonProblem } from "../model-provider";

// ─── Rate limiting ───────────────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 20;
const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, list);
  return list;
}

export function loginLocked(email: string, ip: string, now = Date.now()): boolean {
  return recent(`acct:${email.toLowerCase()}`, now).length >= MAX_PER_ACCOUNT || recent(`ip:${ip}`, now).length >= MAX_PER_IP;
}

function recordFailure(email: string, ip: string, now = Date.now()): void {
  recent(`acct:${email.toLowerCase()}`, now).push(now);
  recent(`ip:${ip}`, now).push(now);
}

export function resetLoginLimits(): void {
  failures.clear();
}

// ─── Audit ───────────────────────────────────────────────────────────────────

function auditAuth(event: string, input: Record<string, unknown>, userId?: string): void {
  appendAuditEntry({
    runId: `auth-${Date.now()}`,
    employeeId: "system",
    employeeName: "system",
    toolName: event,
    bareName: event,
    input,
    verdict: input.ok === false ? "hard_blocked" : "executed",
    ...(userId ? { requesterId: userId } : {}),
  });
}

// ─── Password + TOTP ─────────────────────────────────────────────────────────

/** Compared against when the email is unknown, so timing doesn't reveal
 *  which accounts exist. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

export type LoginResult =
  | { status: "ok"; cookie: string; user: User }
  | { status: "mfa_required"; cookie: string; user: User }
  | { status: "invalid" }
  | { status: "locked" };

export function loginWithPassword(email: string, password: string, ip: string): LoginResult {
  const e = String(email ?? "").trim().toLowerCase();
  if (loginLocked(e, ip)) {
    auditAuth("login", { method: "password", ok: false, reason: "rate_limited", ip });
    return { status: "locked" };
  }
  const user = findUserByEmail(e);
  const ok = verifyPassword(String(password ?? ""), user?.passwordHash ?? DUMMY_HASH) && Boolean(user) && !user!.disabled;
  if (!ok || !user) {
    recordFailure(e, ip);
    auditAuth("login", { method: "password", ok: false, reason: "bad_credentials", ip }, user?.id);
    return { status: "invalid" };
  }
  const mfa = Boolean(user.totp?.enabled);
  const cookie = createSession(user.id, "password", !mfa);
  auditAuth("login", { method: "password", ok: true, mfaPending: mfa, ip }, user.id);
  return mfa ? { status: "mfa_required", cookie, user } : { status: "ok", cookie, user };
}

/** Second step: a valid code upgrades the session (new id). */
export function completeMfa(cookie: string | undefined, code: string, ip: string): { cookie: string } | null {
  const resolved = resolveSession(cookie);
  if (!resolved || resolved.session.mfaPassed || !resolved.user.totp?.enabled) return null;
  const { user } = resolved;
  if (loginLocked(user.email, ip)) return null;
  const step = verifyTotp(user.totp!.secret, code, user.totp!.lastStep);
  if (step === null) {
    recordFailure(user.email, ip);
    auditAuth("mfa", { ok: false, ip }, user.id);
    return null;
  }
  updateUser(user.id, { totp: { ...user.totp!, lastStep: step } });
  const upgraded = upgradeSessionMfa(cookie);
  auditAuth("mfa", { ok: true, ip }, user.id);
  return upgraded ? { cookie: upgraded } : null;
}

// ─── First owner ─────────────────────────────────────────────────────────────

export function createFirstOwner(input: { email: string; name: string; password: string }): { user: User; cookie: string } | { error: string } {
  if (accountsEnabled()) return { error: "An owner already exists. Sign in instead." };
  const problem = passwordProblem(input.password);
  if (problem) return { error: problem };
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email." };
  const user = createUser({ email, name: String(input.name ?? "").trim() || email, role: "owner", passwordHash: hashPassword(input.password), createdBy: "bootstrap" });
  auditAuth("userCreated", { userId: user.id, role: "owner", via: "bootstrap" }, user.id);
  return { user, cookie: createSession(user.id, "password", true) };
}

// ─── OIDC ────────────────────────────────────────────────────────────────────

type Pending = Record<string, { nonce: string; verifier: string; createdAt: number; returnTo: string }>;
const PENDING_FILE = () => dataDir("auth", "oidc-pending.json");
const PENDING_MS = 10 * 60 * 1000;

function loadPending(now = Date.now()): Pending {
  let all: Pending = {};
  try {
    all = JSON.parse(fs.readFileSync(PENDING_FILE(), "utf8")) as Pending;
  } catch { /* none */ }
  for (const [k, v] of Object.entries(all)) if (now - v.createdAt > PENDING_MS) delete all[k];
  return all;
}

function savePending(all: Pending): void {
  fs.mkdirSync(path.dirname(PENDING_FILE()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(PENDING_FILE(), JSON.stringify(all), { mode: 0o600 });
}

export function rememberOidcRequest(state: string, nonce: string, verifier: string, returnTo: string): void {
  const all = loadPending();
  all[state] = { nonce, verifier, createdAt: Date.now(), returnTo: safeReturnTo(returnTo) };
  savePending(all);
}

/** Single use: the state is deleted as it is read. */
export function takeOidcRequest(state: string): { nonce: string; verifier: string; returnTo: string } | null {
  const all = loadPending();
  const hit = all[state];
  if (!hit) return null;
  delete all[state];
  savePending(all);
  return hit;
}

/** Only same-site paths: never an absolute URL (open redirect). */
export function safeReturnTo(value: string | null | undefined): string {
  const v = String(value ?? "");
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

/** Find or link the account for verified ID-token claims. */
export function signInWithOidc(claims: IdClaims, cfg: OidcConfig, ip: string): LoginResult {
  const users = listUsers();
  let user = users.find((u) => u.oidc?.issuer === cfg.issuer && u.oidc.subject === claims.sub);
  const email = claims.email?.toLowerCase();
  if (!user && email && emailVerified(claims)) {
    const byEmail = findUserByEmail(email);
    if (byEmail && !byEmail.oidc) {
      user = updateUser(byEmail.id, { oidc: { issuer: cfg.issuer, subject: claims.sub } });
    } else if (!byEmail && cfg.allowedDomains.includes(email.split("@")[1] ?? "") && !addPersonProblem()) {
      user = createUser({ email, name: claims.name ?? email, role: "member", oidc: { issuer: cfg.issuer, subject: claims.sub }, createdBy: "oidc" });
      auditAuth("userCreated", { userId: user.id, role: "member", via: "oidc" }, user.id);
    }
  }
  if (!user || user.disabled) {
    auditAuth("login", { method: "oidc", ok: false, reason: "no_account", ip });
    return { status: "invalid" };
  }
  const mfa = Boolean(user.totp?.enabled);
  const cookie = createSession(user.id, "oidc", !mfa);
  auditAuth("login", { method: "oidc", ok: true, mfaPending: mfa, ip }, user.id);
  return mfa ? { status: "mfa_required", cookie, user } : { status: "ok", cookie, user };
}

