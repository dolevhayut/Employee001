// Replay protection for inbound webhooks, on top of the signature check.
// A captured, validly signed delivery must not be accepted twice or long
// after it was sent: the timestamp must be within TOLERANCE of now and the
// webhook id (the nonce) must not have been seen within the retention window.
// Call only after the signature verified, so unsigned junk can't fill the
// nonce store.

import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const RETENTION_MS = 2 * WEBHOOK_TOLERANCE_SECONDS * 1000;
const MAX_NONCES = 5000;

const FILE = () => dataDir("webhook-nonces.json");

type Store = Record<string, number>; // nonce key → first seen (ms)

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as Store;
  } catch {
    return {};
  }
}

function save(store: Store): void {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, file);
}

export type ReplayVerdict = { ok: true } | { ok: false; reason: "stale_timestamp" | "replayed" | "bad_timestamp" };

/** Timestamp check alone (pure). Accepts seconds or milliseconds. */
export function timestampFresh(timestamp: string, nowMs = Date.now()): ReplayVerdict {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "bad_timestamp" };
  const ms = n > 1e12 ? n : n * 1000;
  return Math.abs(nowMs - ms) <= WEBHOOK_TOLERANCE_SECONDS * 1000 ? { ok: true } : { ok: false, reason: "stale_timestamp" };
}

/** Check freshness, then record the nonce; a nonce seen before is a replay. */
export function acceptWebhookOnce(scope: string, nonce: string, timestamp: string, nowMs = Date.now()): ReplayVerdict {
  const fresh = timestampFresh(timestamp, nowMs);
  if (!fresh.ok) return fresh;
  const store = load();
  for (const [key, seen] of Object.entries(store)) if (nowMs - seen > RETENTION_MS) delete store[key];
  const key = `${scope}:${nonce}`;
  if (store[key] !== undefined) return { ok: false, reason: "replayed" };
  store[key] = nowMs;
  const keys = Object.keys(store);
  if (keys.length > MAX_NONCES) for (const k of keys.slice(0, keys.length - MAX_NONCES)) delete store[k];
  save(store);
  return { ok: true };
}
