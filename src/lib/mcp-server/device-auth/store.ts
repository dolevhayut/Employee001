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
  | { ok: false; reason: "unknown" | "expired" | "already_approved" };

export type ExchangeResult =
  | { status: "approved"; bearer: string; expiresAt: number }
  | { status: "pending" | "expired" | "invalid" | "consumed" };

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

function load(): StoreShape {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (raw && typeof raw === "object") {
      return { devices: raw.devices ?? {}, sessions: raw.sessions ?? {} };
    }
  } catch {
    /* missing or unreadable: start empty (nothing resolves) */
  }
  return { devices: {}, sessions: {} };
}

function save(store: StoreShape): void {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
}

function randomUserCode(): string {
  let out = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
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

export function issueDeviceCode(): IssuedDeviceCode {
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
export function approveUserCode(userCode: string, personId: string): ApproveResult {
  const now = clock();
  if (!personId) return { ok: false, reason: "unknown" };
  const store = load();
  const hash = sha(normalizeUserCode(userCode));
  const entry = Object.values(store.devices).find((d) => d.userCodeHash === hash);
  if (!entry) return { ok: false, reason: "unknown" };
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
export function exchangeDeviceCode(deviceCode: string): ExchangeResult {
  const now = clock();
  const store = load();
  const key = sha(deviceCode);
  const entry = store.devices[key];
  if (!entry) return { status: "invalid" };
  if (entry.expiresAt <= now) return { status: "expired" };
  if (!entry.approvedBy) return { status: "pending" };
  if (entry.sessionId) return { status: "consumed" };
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
  const session = load().sessions[sha(bearer)];
  if (!session || session.revokedAt || session.expiresAt <= clock()) return null;
  return { personId: session.personId, createdAt: session.createdAt, expiresAt: session.expiresAt };
}

/** Revoke every MCP session (and unredeemed approval) held by a person. Returns sessions revoked. */
export function revokePersonSessions(personId: string): number {
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
export function revokeBearer(bearer: string): boolean {
  const store = load();
  const session = store.sessions[sha(bearer)];
  if (!session || session.revokedAt) return false;
  session.revokedAt = clock();
  save(store);
  return true;
}
