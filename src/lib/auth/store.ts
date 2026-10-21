// Accounts and sessions on disk (data/auth/, files mode 0600). Imported by
// src/proxy.ts (Node runtime), so no "server-only" and no React.
//
// Sessions: the cookie carries a random 32-byte id plus an HMAC of it under
// a per-install key (never a reusable secret like the old raw token). The
// store keeps only SHA-256(id). A session lasts at most 12 hours from login,
// expires after 2 idle hours, and its id rotates every 30 minutes of use and
// at login, MFA and role changes.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../app-home";
import type { Role } from "./request-user";

export const SESSION_COOKIE = "e001_session";
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const SESSION_ROTATE_MS = 30 * 60 * 1000;

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** For role "employee": the twin they may see and revoke. */
  employeeId?: string;
  passwordHash?: string;
  totp?: { secret: string; enabled: boolean; lastStep: number; confirmedAt?: string };
  oidc?: { issuer: string; subject: string };
  disabled?: boolean;
  createdAt: string;
  createdBy?: string;
};

export type Session = {
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  rotatedAt: number;
  /** False until the second factor is verified, for users with TOTP on. */
  mfaPassed: boolean;
  method: "password" | "oidc";
  /** Set on an id that was rotated out: it keeps working for a short grace
   *  period so requests already in flight with it don't sign the user out. */
  retiredAt?: number;
};

const ROTATION_GRACE_MS = 60_000;

const AUTH_DIR = () => dataDir("auth");
const USERS_FILE = () => path.join(AUTH_DIR(), "users.json");
const SESSIONS_FILE = () => path.join(AUTH_DIR(), "sessions.json");
const KEY_FILE = () => path.join(AUTH_DIR(), "session-key");

function writeSecure(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

let usersCache: { file: string; mtimeMs: number; users: User[] } | undefined;

export function listUsers(): User[] {
  const file = USERS_FILE();
  try {
    const { mtimeMs } = fs.statSync(file);
    if (usersCache && usersCache.file === file && usersCache.mtimeMs === mtimeMs) return usersCache.users;
    const users = readJson<User[]>(file, []);
    usersCache = { file, mtimeMs, users };
    return users;
  } catch {
    return [];
  }
}

/** Accounts exist: sign-in is required everywhere, loopback included. */
export function accountsEnabled(): boolean {
  return listUsers().some((u) => !u.disabled);
}

function saveUsers(users: User[]): void {
  writeSecure(USERS_FILE(), JSON.stringify(users, null, 2));
  usersCache = undefined;
}

export function getUser(id: string): User | undefined {
  return listUsers().find((u) => u.id === id);
}

export function findUserByEmail(email: string): User | undefined {
  const e = email.trim().toLowerCase();
  return listUsers().find((u) => u.email === e);
}

export function createUser(input: Omit<User, "id" | "createdAt"> & { id?: string }): User {
  const users = listUsers();
  const email = input.email.trim().toLowerCase();
  if (users.some((u) => u.email === email)) throw new Error("A user with that email already exists.");
  const user: User = { ...input, email, id: input.id ?? `usr_${randomUUID().replace(/-/g, "").slice(0, 16)}`, createdAt: new Date().toISOString() };
  saveUsers([...users, user]);
  return user;
}

export function updateUser(id: string, patch: Partial<Omit<User, "id" | "createdAt">>): User {
  const users = listUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error("No such user.");
  const next = { ...users[idx], ...patch };
  const copy = [...users];
  copy[idx] = next;
  saveUsers(copy);
  return next;
}

export function deleteUser(id: string): void {
  saveUsers(listUsers().filter((u) => u.id !== id));
  revokeUserSessions(id);
}

/** What the API may show about a user: never hashes or TOTP secrets. */
export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    ...(u.employeeId ? { employeeId: u.employeeId } : {}),
    mfaEnabled: Boolean(u.totp?.enabled),
    sso: Boolean(u.oidc),
    disabled: Boolean(u.disabled),
    createdAt: u.createdAt,
  };
}

// ─── Keys and cookie signing ─────────────────────────────────────────────────

function sessionKey(): Buffer {
  try {
    const key = fs.readFileSync(KEY_FILE());
    if (key.length >= 32) return key;
  } catch { /* first use */ }
  const key = randomBytes(32);
  try {
    fs.mkdirSync(AUTH_DIR(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_FILE(), key, { mode: 0o600, flag: "wx" });
    return key;
  } catch {
    return fs.readFileSync(KEY_FILE());
  }
}

export function sign(value: string): string {
  return createHmac("sha256", sessionKey()).update(value).digest("base64url");
}

export function verifySigned(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = cookie.slice(0, dot);
  const mac = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(sign(value));
  return mac.length === expected.length && timingSafeEqual(mac, expected) ? value : null;
}

const hashId = (id: string) => createHash("sha256").update(id).digest("hex");

// ─── Sessions ────────────────────────────────────────────────────────────────

type SessionMap = Record<string, Session>;

function loadSessions(now = Date.now()): SessionMap {
  const all = readJson<SessionMap>(SESSIONS_FILE(), {});
  for (const [k, s] of Object.entries(all)) {
    if (now - s.createdAt > SESSION_MAX_MS || now - s.lastSeenAt > SESSION_IDLE_MS) delete all[k];
    else if (s.retiredAt && now - s.retiredAt > ROTATION_GRACE_MS) delete all[k];
  }
  return all;
}

function saveSessions(all: SessionMap): void {
  writeSecure(SESSIONS_FILE(), JSON.stringify(all));
}

/** Start a session; returns the signed cookie value. */
export function createSession(userId: string, method: Session["method"], mfaPassed: boolean, now = Date.now()): string {
  const id = randomBytes(32).toString("base64url");
  const all = loadSessions(now);
  all[hashId(id)] = { userId, createdAt: now, lastSeenAt: now, rotatedAt: now, mfaPassed, method };
  saveSessions(all);
  return `${id}.${sign(id)}`;
}

export type ResolvedSession = { user: User; session: Session; rotatedCookie?: string };

/**
 * Look up the session behind a cookie. Touches lastSeenAt (at most once a
 * minute) and rotates the id when it is older than SESSION_ROTATE_MS: the
 * caller sets rotatedCookie on the response. The 12-hour cap counts from
 * login and survives rotation.
 */
export function resolveSession(cookie: string | undefined, now = Date.now()): ResolvedSession | null {
  const id = verifySigned(cookie);
  if (!id) return null;
  const all = loadSessions(now);
  const key = hashId(id);
  const session = all[key];
  if (!session) return null;
  const user = getUser(session.userId);
  if (!user || user.disabled) {
    delete all[key];
    saveSessions(all);
    return null;
  }
  // A rotated-out id within its grace period: accept, never rotate again.
  if (session.retiredAt) return { user, session };
  let rotatedCookie: string | undefined;
  let dirty = false;
  if (now - session.rotatedAt > SESSION_ROTATE_MS) {
    const fresh = randomBytes(32).toString("base64url");
    all[key] = { ...session, retiredAt: now };
    all[hashId(fresh)] = { ...session, rotatedAt: now, lastSeenAt: now };
    rotatedCookie = `${fresh}.${sign(fresh)}`;
    dirty = true;
  } else if (now - session.lastSeenAt > 60_000) {
    session.lastSeenAt = now;
    dirty = true;
  }
  if (dirty) saveSessions(all);
  return { user, session, ...(rotatedCookie ? { rotatedCookie } : {}) };
}

/** Mark the second factor passed: the old id is dropped, a new one issued. */
export function upgradeSessionMfa(cookie: string | undefined, now = Date.now()): string | null {
  const id = verifySigned(cookie);
  if (!id) return null;
  const all = loadSessions(now);
  const session = all[hashId(id)];
  if (!session || session.retiredAt) return null;
  delete all[hashId(id)];
  const fresh = randomBytes(32).toString("base64url");
  all[hashId(fresh)] = { ...session, mfaPassed: true, rotatedAt: now, lastSeenAt: now };
  saveSessions(all);
  return `${fresh}.${sign(fresh)}`;
}

export function endSession(cookie: string | undefined): void {
  const id = verifySigned(cookie);
  if (!id) return;
  const all = loadSessions();
  delete all[hashId(id)];
  saveSessions(all);
}

/** Sign a user out everywhere (role change, password change, disable). */
export function revokeUserSessions(userId: string): number {
  const all = loadSessions();
  let n = 0;
  for (const [k, s] of Object.entries(all)) {
    if (s.userId === userId) {
      delete all[k];
      n++;
    }
  }
  if (n) saveSessions(all);
  return n;
}

// ─── Bootstrap (first owner) ─────────────────────────────────────────────────

export const BOOTSTRAP_COOKIE = "e001_bootstrap";
const BOOTSTRAP_MS = 30 * 60 * 1000;

/** Short-lived signed proof that the holder presented EMPLOYEE001_TOKEN.
 *  Only lets them create the first owner. */
export function bootstrapCookie(now = Date.now()): string {
  return `${now + BOOTSTRAP_MS}.${sign(`bootstrap:${now + BOOTSTRAP_MS}`)}`;
}

export function bootstrapValid(cookie: string | undefined, now = Date.now()): boolean {
  if (!cookie) return false;
  const [exp, mac] = cookie.split(".");
  if (!exp || !mac || Number(exp) < now) return false;
  const expected = Buffer.from(sign(`bootstrap:${exp}`));
  const got = Buffer.from(mac);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
