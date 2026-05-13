import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { RunSurface } from "@/lib/active-runs";

export type RunLogEvent =
  | { ts: string; type: "text"; text: string }
  | { ts: string; type: "thinking"; text: string }
  | {
      ts: string;
      type: "artifact";
      artifactId: string;
      payload: { type: "html" | "svg"; title: string; content: string };
    }
  | { ts: string; type: "tool_use"; tool: string; input?: Record<string, unknown> }
  | { ts: string; type: "tool_result"; tool: string }
  | { ts: string; type: "approval"; tool: string; decision: "allow" | "deny" | "deferred" }
  | { ts: string; type: "meta"; message: string }
  | { ts: string; type: "error"; message: string }
  | { ts: string; type: "done"; summary?: string; costUsd?: number; turns?: number };

// Distributive Omit so that `RunLogEventInput` keeps the discriminated-union
// shape after stripping `ts`. Plain `Omit<RunLogEvent, "ts">` collapses the
// union and drops the per-variant fields.
type DistributiveOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never;
export type RunLogEventInput = DistributiveOmit<RunLogEvent, "ts">;

const MAX_LIMIT_BYTES = 1_048_576;

export function logPathFor(surface: RunSurface, runId: string): string {
  return path.join(process.cwd(), "data", "run-logs", surface, `${runId}.ndjson`);
}

function ensureDirFor(file: string) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function appendRunLog(
  surface: RunSurface,
  runId: string,
  event: RunLogEventInput
): void {
  try {
    const file = logPathFor(surface, runId);
    ensureDirFor(file);
    const stamped = { ts: new Date().toISOString(), ...event } as RunLogEvent;
    fs.appendFileSync(file, JSON.stringify(stamped) + "\n", "utf8");
  } catch (err) {
    console.warn("[run-logs] append failed", surface, runId, err);
  }
}

export type LogTailResult = {
  bytes: Buffer;
  size: number;
  etag: string;
};

function emptyResult(size = 0, etag = "0"): LogTailResult {
  return { bytes: Buffer.alloc(0), size, etag };
}

function computeEtag(file: string, size: number): string {
  if (size === 0) return "0";
  try {
    const tailLen = Math.min(32, size);
    const buf = Buffer.alloc(tailLen);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buf, 0, tailLen, size - tailLen);
    } finally {
      fs.closeSync(fd);
    }
    const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12);
    return `${size}-${hash}`;
  } catch {
    return `${size}-x`;
  }
}

export function readLogTail(
  surface: RunSurface,
  runId: string,
  offset: number,
  limitBytes: number
): LogTailResult {
  try {
    const file = logPathFor(surface, runId);
    if (!fs.existsSync(file)) return emptyResult();

    const stat = fs.statSync(file);
    const size = stat.size;
    const etag = computeEtag(file, size);

    if (size === 0) return emptyResult(0, etag);

    const cap = Math.min(MAX_LIMIT_BYTES, Math.max(1, limitBytes));
    const start = Math.max(0, offset);
    if (start >= size) return { bytes: Buffer.alloc(0), size, etag };

    const end = Math.min(size, start + cap);
    const length = end - start;
    const buf = Buffer.alloc(length);

    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buf, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }

    return { bytes: buf, size, etag };
  } catch (err) {
    console.warn("[run-logs] read tail failed", surface, runId, err);
    return emptyResult();
  }
}
