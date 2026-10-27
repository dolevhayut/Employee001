import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/app-home";
import { ROLE_RANK } from "@/lib/auth/rbac";
import { getUser, listUsers } from "@/lib/auth/store";

// Personal MCP sign-in (device-code flow), server-side model only. Raw device
// codes, user codes and bearers are never stored: only their SHA-256 hashes.

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const POLL_INTERVAL_SECONDS = 5;
/** Who approves a code on an install with no accounts (the proxy's implicit owner). */
export const LOCAL_OWNER = "local-owner";

// No 0/O/1/I/L/U so a code read aloud or typed from a screen is unambiguous.
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

interface DeviceRecord {
  userCodeHash: string;
  expiresAt: number;
  approvedBy?: string;
  approvedAt?: number;
  /** Set when a signed-in person refused the code; the poller then gets access_denied. */
  deniedAt?: number;
  /** Set once the session bearer was handed to the polling client. */
  sessionId?: string;
  lastPolledAt?: number;
  /** SHA-256 of the requesting IP, for the per-IP cap. The raw IP is never stored. */
  issuerHash?: string;
}

/** Wrong user-code guesses tolerated per code lifetime before approvals are refused. */
const MAX_FAILED_APPROVALS = 10;

/** Outstanding (unexpired) device codes tolerated store-wide and per requesting IP. */
export const MAX_OUTSTANDING_CODES = 500;
export const MAX_OUTSTANDING_CODES_PER_IP = 10;

export class DeviceCodeLimitError extends Error {
  constructor(readonly scope: "global" | "ip") {
    super(`too many outstanding device codes (${scope})`);
    this.name = "DeviceCodeLimitError";
  }
}

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
  | { ok: false; reason: "unknown" | "expired" | "already_approved" | "denied" | "rate_limited" };

export type ExchangeResult =
  | { status: "approved"; bearer: string; expiresAt: number }
  | { status: "pending" | "expired" | "invalid" | "consumed" | "slow_down" | "denied" };

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
    failedApprovals: sanitizeFailures(raw.failedApprovals),
  };
}

/**
 * Token of the lock this process holds while a mutation runs. Module-global, so
 * `fn` passed to withLock must stay synchronous. The fence narrows the window in
 * which a reclaimed holder can write; it is not a hard guarantee without OS locks.
 */
let heldToken: string | null = null;

/** Own, array-valued entries only, in a prototype-less object so "constructor" is just a key. */
function sanitizeFailures(value: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, times] of Object.entries(value)) {
    if (Array.isArray(times)) out[id] = times.filter((t): t is number => typeof t === "number");
  }
  return out;
}

function save(store: StoreShape): void {
  const target = file();
  // Fence: a holder that stalled past the stale timeout may have been reclaimed.
  // Writing then could drop a revokedAt or a new session another process saved.
  if (heldToken !== null && readOwner(`${target}.lock`) !== heldToken) {
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

const LOCK_STALE_MS = 30_000; // a live holder is never stolen from sooner than this
const GUARD_STALE_MS = 2_000; // the guard is held for microseconds
const LOCK_WAIT_MS = 6_000; // a busy store fails the caller instead of stealing a live lock

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readOwner(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Stale when the owner process (the "pid:" prefix) is gone, or when the file is
 * older than maxAgeMs (a backstop for unknown formats and reused pids; the store
 * is single-host and its critical sections last milliseconds).
 */
function isStale(p: string, content: string, maxAgeMs: number): boolean {
  const pid = /^(\d+):/.exec(content)?.[1];
  if (pid !== undefined && !pidAlive(Number(pid))) return true;
  try {
    return Date.now() - fs.statSync(p).mtimeMs > maxAgeMs;
  } catch {
    return false; // already gone
  }
}

/**
 * Short critical section that serialises every removal of the lock file, so the
 * "is it still the lock I looked at?" check and the unlink cannot interleave with
 * another process's release or reclaim. Creating the lock stays a plain exclusive
 * create. Only a guard whose holder crashed is reclaimed (dead pid or age).
 */
async function withGuard<T>(lock: string, fn: () => T): Promise<T> {
  const guard = `${lock}.guard`;
  const mine = `${process.pid}:${randomBytes(16).toString("hex")}`;
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(guard, mine, { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const seen = readOwner(guard);
    if (seen !== null && isStale(guard, seen, GUARD_STALE_MS) && readOwner(guard) === seen) {
      fs.rmSync(guard, { force: true });
    }
    if (Date.now() - started > LOCK_WAIT_MS) throw new Error("mcp-device-auth store is busy");
    await sleep(2);
  }
  try {
    return fn();
  } finally {
    if (readOwner(guard) === mine) fs.rmSync(guard, { force: true });
  }
}

/**
 * Cross-process mutex: an exclusively created lock file holding "pid:token".
 * A lock is reclaimed only when its owner process is dead or it is older than
 * LOCK_STALE_MS. Every removal, release and reclaim alike,
 * runs inside withGuard and re-checks the owner token first, so a fresh lock
 * created by someone else is never deleted. Waiting is async.
 */
async function withLock<T>(fn: () => T): Promise<T> {
  const lock = `${file()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const mine = `${process.pid}:${randomBytes(16).toString("hex")}`;
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, mine, { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const seen = readOwner(lock);
    if (seen !== null && isStale(lock, seen, LOCK_STALE_MS)) {
      await withGuard(lock, () => {
        if (readOwner(lock) === seen) fs.rmSync(lock, { force: true });
      });
      continue;
    }
    if (Date.now() - started > LOCK_WAIT_MS) throw new Error("mcp-device-auth store is busy");
    await sleep(10);
  }
  heldToken = mine;
  try {
    return fn();
  } finally {
    heldToken = null;
    // Release must never turn a committed write into a failure.
    try {
      await withGuard(lock, () => {
        if (readOwner(lock) === mine) fs.rmSync(lock, { force: true });
      });
    } catch {
      if (readOwner(lock) === mine) fs.rmSync(lock, { force: true });
    }
  }
}

/** Rejects with DeviceCodeLimitError when the global or per-IP cap is reached. */
export function issueDeviceCode(opts: { ip?: string } = {}): Promise<IssuedDeviceCode> {
  return withLock(() => issueUnlocked(opts.ip ? sha(opts.ip) : undefined));
}
export function approveUserCode(userCode: string, personId: string): Promise<ApproveResult> {
  return withLock(() => approveUnlocked(userCode, personId));
}
/** Refuse a user code: it can no longer be approved and the poller gets access_denied. */
export function denyUserCode(userCode: string, personId: string): Promise<ApproveResult> {
  return withLock(() => approveUnlocked(userCode, personId, true));
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

function issueUnlocked(issuerHash?: string): IssuedDeviceCode {
  const now = clock();
  const store = load();
  prune(store, now);
  const outstanding = Object.values(store.devices);
  if (outstanding.length >= MAX_OUTSTANDING_CODES) throw new DeviceCodeLimitError("global");
  if (
    issuerHash &&
    outstanding.filter((d) => d.issuerHash === issuerHash).length >= MAX_OUTSTANDING_CODES_PER_IP
  ) {
    throw new DeviceCodeLimitError("ip");
  }
  const deviceCode = randomBytes(32).toString("base64url");
  let normalized = randomUserCode();
  const taken = new Set(Object.values(store.devices).map((d) => d.userCodeHash));
  while (taken.has(sha(normalized))) normalized = randomUserCode();
  const expiresAt = now + DEVICE_CODE_TTL_MS;
  store.devices[sha(deviceCode)] = {
    userCodeHash: sha(normalized),
    expiresAt,
    ...(issuerHash ? { issuerHash } : {}),
  };
  save(store);
  return {
    deviceCode,
    userCode: formatUserCode(normalized),
    expiresAt,
    intervalSeconds: POLL_INTERVAL_SECONDS,
  };
}

/** Record that a signed-in person approved the user code. Caller authenticates `personId`. */
function approveUnlocked(userCode: string, personId: string, deny = false): ApproveResult {
  const now = clock();
  if (!personId) return { ok: false, reason: "unknown" };
  const store = load();
  // The cap is per approving person, so one member's typos never block another's
  // valid approval. It is checked before the lookup so a locked-out person cannot
  // keep guessing.
  const failures = store.failedApprovals ?? sanitizeFailures(undefined);
  const prior = failures[personId];
  const recent = (Array.isArray(prior) ? prior : []).filter((t) => t > now - DEVICE_CODE_TTL_MS);
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
  if (entry.deniedAt) return { ok: false, reason: "denied" };
  if (deny) {
    entry.deniedAt = now;
    save(store);
    return { ok: true, approvedAt: now };
  }
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
  if (entry.deniedAt) {
    save(store);
    return { status: "denied" };
  }
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
  // The implicit local owner exists only while the app has no user record at all
  // (disabled ones count): its sessions die with the first account, even if the
  // revoke at owner creation never ran. Everyone else must be a person who can
  // still approve one: deleted, disabled or demoted below member means no session,
  // and that holds even when every account is disabled. Checked on every request,
  // so the cut-off is immediate.
  try {
    if (session.personId === LOCAL_OWNER) {
      if (listUsers().length > 0) return null;
    } else {
      const person = getUser(session.personId);
      if (!person || person.disabled || ROLE_RANK[person.role] < ROLE_RANK.member) return null;
    }
  } catch {
    return null; // unreadable user store: fail closed
  }
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
