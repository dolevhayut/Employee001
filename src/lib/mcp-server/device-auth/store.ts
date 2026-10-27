import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/app-home";

// Personal MCP sign-in (device-code flow), server-side model only. Raw device
// codes, user codes and bearers are never stored: only their SHA-256 hashes.

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const POLL_INTERVAL_SECONDS = 5;

// No 0/O/1/I/L/U so a code read aloud or typed from a screen is unambiguous.
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

interface DeviceRecord {
  userCodeHash: string;
  expiresAt: number;
  approvedBy?: string;
  approvedAt?: number;
  /** Set once the session bearer was handed to the polling client. */
  sessionId?: string;
  lastPolledAt?: number;
}

/** Wrong user-code guesses tolerated per code lifetime before approvals are refused. */
const MAX_FAILED_APPROVALS = 10;

interface SessionRecord {
  personId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

interface StoreShape {
  devices: Record<string, DeviceRecord>; // key: hash(deviceCode)
  sessions: Record<string, SessionRecord>; // key: hash(bearer)
  failedApprovals?: Record<string, number[]>; // personId -> times of unknown-code attempts
}

export interface McpSession {
  personId: string;
  createdAt: number;
  expiresAt: number;
}

export interface IssuedDeviceCode {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  intervalSeconds: number;
}

export type ApproveResult =
  | { ok: true; approvedAt: number }
  | { ok: false; reason: "unknown" | "expired" | "already_approved" | "rate_limited" };

export type ExchangeResult =
  | { status: "approved"; bearer: string; expiresAt: number }
  | { status: "pending" | "expired" | "invalid" | "consumed" | "slow_down" };

type Clock = () => number;
let clock: Clock = Date.now;

/** Test seam: replace the clock. Pass nothing to restore the real one. */
export function setDeviceAuthClock(next?: Clock): void {
  clock = next ?? Date.now;
}

const file = () => dataDir("mcp-device-auth.json");

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeUserCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Every mutation is a read-modify-write under a cross-process lock (withLock).
function load(): StoreShape {
  let text: string;
  try {
    text = fs.readFileSync(file(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { devices: {}, sessions: {} };
    throw err;
  }
  // A corrupt file throws instead of reading as empty: the next save must not
  // wipe sessions and revocation markers. resolveBearer treats a throw as "no session".
  const raw = JSON.parse(text);
  const isMap = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isMap(raw) || !isMap(raw.devices ?? {}) || !isMap(raw.sessions ?? {})) {
    throw new Error("mcp-device-auth store is malformed");
  }
  return {
    devices: raw.devices ?? {},
    sessions: raw.sessions ?? {},
    failedApprovals: isMap(raw.failedApprovals) ? raw.failedApprovals : {},
  };
}

/** Token of the lock this process holds while a mutation runs (mutations are synchronous). */
let heldToken: string | null = null;

function save(store: StoreShape): void {
  const target = file();
  // Fence: a holder that stalled past the stale timeout may have been reclaimed.
  // Writing then could drop a revokedAt or a new session another process saved.
  if (heldToken !== null && readLockOwner(`${target}.lock`) !== heldToken) {
    throw new Error("mcp-device-auth store lock was lost");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
}

function randomUserCode(): string {
  let out = "";
  const limit = 256 - (256 % USER_CODE_ALPHABET.length); // reject biased bytes
  while (out.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte < limit && out.length < 8) out += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
    }
  }
  return out;
}

export function formatUserCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/** Drop expired device codes and expired sessions. Revoked-but-live sessions are kept. */
function prune(store: StoreShape, now: number): void {
  for (const [key, d] of Object.entries(store.devices)) {
    if (d.expiresAt <= now) delete store.devices[key];
  }
  for (const [key, s] of Object.entries(store.sessions)) {
    if (s.expiresAt <= now) delete store.sessions[key];
  }
}

const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 6_000; // longer than the stale timeout, so a crashed holder never makes waiters fail

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readLockOwner(lock: string): string | null {
  try {
    return fs.readFileSync(lock, "utf8");
  } catch {
    return null;
  }
}

/**
 * Cross-process mutex: an exclusively created lock file holding an owner token.
 * Release removes the lock only if we still own it. A stale lock is reclaimed by
 * an atomic rename, and put back if what we moved turns out to be someone's fresh
 * lock. Waiting is async, so the event loop is never blocked.
 */
async function withLock<T>(fn: () => T): Promise<T> {
  const lock = `${file()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const token = randomBytes(16).toString("hex");
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, token, { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      reclaimIfStale(lock, token);
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error("mcp-device-auth store is busy");
      await sleep(10);
    }
  }
  heldToken = token;
  try {
    return fn();
  } finally {
    heldToken = null;
    if (readLockOwner(lock) === token) fs.rmSync(lock, { force: true });
  }
}

/**
 * Remove a lock whose holder stalled past LOCK_STALE_MS. Reclaiming is itself
 * serialized by an exclusive `.reclaim` file, so two waiters never both remove a
 * lock (the old rename-then-link-back could hand the slot to two processes).
 * Under that guard the lock is re-read, and only the exact stale owner is removed.
 */
function reclaimIfStale(lock: string, token: string): void {
  const guard = `${lock}.reclaim`;
  try {
    fs.writeFileSync(guard, token, { flag: "wx", mode: 0o600 });
  } catch {
    // Someone else is reclaiming; clear a guard its crashed owner left behind.
    try {
      if (Date.now() - fs.statSync(guard).mtimeMs > LOCK_STALE_MS) fs.rmSync(guard, { force: true });
    } catch {
      /* gone already */
    }
    return;
  }
  try {
    const seen = readLockOwner(lock);
    if (seen !== null && Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS && readLockOwner(lock) === seen) {
      fs.rmSync(lock, { force: true });
    }
  } catch {
    /* released or reclaimed by someone else */
  } finally {
    if (readLockOwner(guard) === token) fs.rmSync(guard, { force: true });
  }
}

export function issueDeviceCode(): Promise<IssuedDeviceCode> {
  return withLock(issueUnlocked);
}
export function approveUserCode(userCode: string, personId: string): Promise<ApproveResult> {
  return withLock(() => approveUnlocked(userCode, personId));
}
export function exchangeDeviceCode(deviceCode: string): Promise<ExchangeResult> {
  return withLock(() => exchangeUnlocked(deviceCode));
}
export function revokePersonSessions(personId: string): Promise<number> {
  return withLock(() => revokePersonUnlocked(personId));
}
export function revokeBearer(bearer: string): Promise<boolean> {
  return withLock(() => revokeBearerUnlocked(bearer));
}

function issueUnlocked(): IssuedDeviceCode {
  const now = clock();
  const store = load();
  prune(store, now);
  const deviceCode = randomBytes(32).toString("base64url");
  let normalized = randomUserCode();
  const taken = new Set(Object.values(store.devices).map((d) => d.userCodeHash));
  while (taken.has(sha(normalized))) normalized = randomUserCode();
  const expiresAt = now + DEVICE_CODE_TTL_MS;
  store.devices[sha(deviceCode)] = { userCodeHash: sha(normalized), expiresAt };
  save(store);
  return {
    deviceCode,
    userCode: formatUserCode(normalized),
    expiresAt,
    intervalSeconds: POLL_INTERVAL_SECONDS,
  };
}

/** Record that a signed-in person approved the user code. Caller authenticates `personId`. */
function approveUnlocked(userCode: string, personId: string): ApproveResult {
  const now = clock();
  if (!personId) return { ok: false, reason: "unknown" };
  const store = load();
  // The cap is per approving person, so one member's typos never block another's
  // valid approval. It is checked before the lookup so a locked-out person cannot
  // keep guessing.
  const failures = store.failedApprovals ?? {};
  const recent = (failures[personId] ?? []).filter((t) => t > now - DEVICE_CODE_TTL_MS);
  if (recent.length >= MAX_FAILED_APPROVALS) return { ok: false, reason: "rate_limited" };
  const hash = sha(normalizeUserCode(userCode));
  const entry = Object.values(store.devices).find((d) => d.userCodeHash === hash);
  if (!entry) {
    failures[personId] = [...recent, now];
    for (const [id, times] of Object.entries(failures)) {
      if (id !== personId && !times.some((t) => t > now - DEVICE_CODE_TTL_MS)) delete failures[id];
    }
    store.failedApprovals = failures;
    save(store);
    return { ok: false, reason: "unknown" };
  }
  if (entry.expiresAt <= now) return { ok: false, reason: "expired" };
  if (entry.approvedBy) return { ok: false, reason: "already_approved" };
  entry.approvedBy = personId;
  entry.approvedAt = now;
  save(store);
  return { ok: true, approvedAt: now };
}

/**
 * Polling step: trade an approved device code for a session bearer, once.
 * The device code itself never works as a bearer.
 */
function exchangeUnlocked(deviceCode: string): ExchangeResult {
  const now = clock();
  const store = load();
  const key = sha(deviceCode);
  const entry = store.devices[key];
  if (!entry) return { status: "invalid" };
  if (entry.expiresAt <= now) return { status: "expired" };
  if (entry.lastPolledAt !== undefined && now - entry.lastPolledAt < POLL_INTERVAL_SECONDS * 1000) {
    return { status: "slow_down" }; // keep the window anchored so jitter cannot loop forever
  }
  entry.lastPolledAt = now;
  if (!entry.approvedBy) {
    save(store);
    return { status: "pending" };
  }
  if (entry.sessionId) {
    save(store);
    return { status: "consumed" };
  }
  const bearer = randomBytes(32).toString("base64url");
  const bearerHash = sha(bearer);
  const expiresAt = now + SESSION_TTL_MS;
  store.sessions[bearerHash] = { personId: entry.approvedBy, createdAt: now, expiresAt };
  entry.sessionId = bearerHash;
  save(store);
  return { status: "approved", bearer, expiresAt };
}

/** One person's session for a presented bearer, or null (unknown, expired, revoked). */
export function resolveBearer(bearer: string): McpSession | null {
  if (!bearer) return null;
  let session: SessionRecord | undefined;
  try {
    session = load().sessions[sha(bearer)];
  } catch {
    return null; // unreadable store: fail closed
  }
  if (!session || session.revokedAt || session.expiresAt <= clock()) return null;
  return { personId: session.personId, createdAt: session.createdAt, expiresAt: session.expiresAt };
}

/** Revoke every MCP session (and unredeemed approval) held by a person. Returns sessions revoked. */
function revokePersonUnlocked(personId: string): number {
  const now = clock();
  const store = load();
  let revoked = 0;
  for (const s of Object.values(store.sessions)) {
    if (s.personId === personId && !s.revokedAt) {
      s.revokedAt = now;
      revoked++;
    }
  }
  for (const [key, d] of Object.entries(store.devices)) {
    if (d.approvedBy === personId && !d.sessionId) delete store.devices[key];
  }
  save(store);
  return revoked;
}

/** Revoke the single session behind a bearer (sign out). */
function revokeBearerUnlocked(bearer: string): boolean {
  const store = load();
  const session = store.sessions[sha(bearer)];
  if (!session || session.revokedAt) return false;
  session.revokedAt = clock();
  save(store);
  return true;
}
