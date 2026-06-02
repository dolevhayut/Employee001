// Storage abstraction. `STORAGE_BACKEND=local` keeps the original JSON-on-disk
// behavior (dev fallback). `STORAGE_BACKEND=fabric` mirrors every audit write,
// twin-memory write, council-run write, and OAuth-token write to the
// Microsoft Fabric lakehouse via OneLake DFS REST.
//
// Reads always hit the local file system for speed; Fabric is treated as a
// durable append-only sink that the lakehouse SQL endpoint can ingest.
//
// Tables (Files/ paths on OneLake):
//   audit/audit-<YYYY-MM-DD>.jsonl       — appendAuditEntry
//   twin_memory/<employeeId>.jsonl       — rememberTwinRun
//   employees/<employeeId>.json          — saveEmployee (snapshot)
//   tokens/<employeeId>.json             — graph token + connection state
//   council_runs/<runId>.json            — council meeting summaries

import path from "path";
import fs from "fs/promises";
import {
  appendOneLake,
  writeOneLake,
  readOneLake,
  isOneLakeConfigured,
} from "./onelake-client";

export type StorageBackend = "local" | "fabric";

export function getStorageBackend(): StorageBackend {
  if (
    process.env.STORAGE_BACKEND === "fabric" &&
    isOneLakeConfigured()
  ) {
    return "fabric";
  }
  return "local";
}

function dataPath(...parts: string[]): string {
  return path.join(process.cwd(), "data", ...parts);
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

// ─── Local-first writes (always happen) + Fabric replication when enabled ──

/**
 * Append a single JSONL line to the named table. Local file is the source of
 * truth; the Fabric replica is fire-and-forget so the agent run is never
 * blocked on lakehouse latency.
 */
export async function appendJsonLine(
  table: string,
  filename: string,
  row: unknown
): Promise<void> {
  const line = JSON.stringify(row) + "\n";
  // Local
  const localFile = dataPath(table, filename);
  await ensureDir(localFile);
  await fs.appendFile(localFile, line, "utf8");

  // Fabric (background)
  if (getStorageBackend() === "fabric") {
    void appendOneLake({ table, filename, data: line }).catch((err) => {
      console.warn(
        `[storage] Fabric append ${table}/${filename} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });
  }
}

export async function writeFile(
  table: string,
  filename: string,
  content: string
): Promise<void> {
  const localFile = dataPath(table, filename);
  await ensureDir(localFile);
  await fs.writeFile(localFile, content, "utf8");
  if (getStorageBackend() === "fabric") {
    void writeOneLake({ table, filename, data: content }).catch((err) => {
      console.warn(
        `[storage] Fabric write ${table}/${filename} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });
  }
}

export async function readFile(
  table: string,
  filename: string
): Promise<string | null> {
  // Always try local first (no Fabric read cost on hot paths).
  try {
    const local = await fs.readFile(dataPath(table, filename), "utf8");
    return local;
  } catch {
    if (getStorageBackend() === "fabric") {
      try {
        return await readOneLake(table, filename);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Append a whole JSONL file's worth of lines (one mirror op). Used when the
 * caller already serialized everything and just wants to ship a bundle.
 */
export async function appendJsonLines(
  table: string,
  filename: string,
  rows: unknown[]
): Promise<void> {
  if (rows.length === 0) return;
  const data = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const localFile = dataPath(table, filename);
  await ensureDir(localFile);
  await fs.appendFile(localFile, data, "utf8");
  if (getStorageBackend() === "fabric") {
    void appendOneLake({ table, filename, data }).catch((err) => {
      console.warn(
        `[storage] Fabric batched append ${table}/${filename} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });
  }
}

export { isOneLakeConfigured };
