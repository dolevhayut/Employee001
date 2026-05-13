import fs from "fs";
import path from "path";

import { getComposio, composioUserIdFor } from "@/lib/composio-client";
import { getFocusConfig, type FocusPrefetch } from "@/lib/twin-focus";

const DATA_ROOT = path.join(process.cwd(), "data", "employees");

export type PrefetchResult = {
  label: string;
  toolSlug: string;
  ts: string;
  cached: boolean;
  ok: boolean;
  data: unknown;
  errorMessage?: string;
  durationMs: number;
  maxItems?: number;
};

type CacheEntry = { ts: string; data: unknown };
type CacheMap = Record<string, CacheEntry>;

function cacheFile(employeeId: string): string {
  return path.join(DATA_ROOT, employeeId, ".shift", "focus-cache.json");
}

function ensureDir(p: string): void {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readCache(employeeId: string): CacheMap {
  const fp = cacheFile(employeeId);
  if (!fs.existsSync(fp)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as CacheMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[twin-focus-prefetch] cache read failed:", err);
    return {};
  }
}

function writeCache(employeeId: string, cache: CacheMap): void {
  const fp = cacheFile(employeeId);
  ensureDir(fp);
  fs.writeFileSync(fp, JSON.stringify(cache, null, 2), "utf8");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

function cacheKey(prefetch: FocusPrefetch): string {
  return `${prefetch.toolSlug}|${stableStringify(prefetch.arguments ?? {})}`;
}

function isFresh(entry: CacheEntry, ttlMs: number): boolean {
  const age = Date.now() - new Date(entry.ts).getTime();
  return Number.isFinite(age) && age < ttlMs;
}

function extractData(result: unknown): unknown {
  if (result && typeof result === "object" && "data" in (result as Record<string, unknown>)) {
    return (result as Record<string, unknown>).data;
  }
  return result;
}

export async function runPrefetches(employeeId: string): Promise<PrefetchResult[]> {
  const config = getFocusConfig(employeeId);
  if (!config.prefetches.length) return [];

  const cache = readCache(employeeId);
  const composio = getComposio();
  const userId = composioUserIdFor(employeeId);
  const results: PrefetchResult[] = [];

  for (const prefetch of config.prefetches) {
    const ttl = prefetch.cacheTtlMs ?? 300_000;
    const key = cacheKey(prefetch);
    const entry = cache[key];

    if (entry && isFresh(entry, ttl)) {
      results.push({
        label: prefetch.label,
        toolSlug: prefetch.toolSlug,
        ts: entry.ts,
        cached: true,
        ok: true,
        data: entry.data,
        durationMs: 0,
        maxItems: prefetch.maxItems,
      });
      continue;
    }

    const start = Date.now();
    try {
      const response = await composio.tools.execute(prefetch.toolSlug, {
        userId,
        arguments: prefetch.arguments,
      });
      const data = extractData(response);
      const ts = new Date().toISOString();
      cache[key] = { ts, data };
      results.push({
        label: prefetch.label,
        toolSlug: prefetch.toolSlug,
        ts,
        cached: false,
        ok: true,
        data,
        durationMs: Date.now() - start,
        maxItems: prefetch.maxItems,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        label: prefetch.label,
        toolSlug: prefetch.toolSlug,
        ts: new Date().toISOString(),
        cached: false,
        ok: false,
        data: null,
        errorMessage: message,
        durationMs: Date.now() - start,
        maxItems: prefetch.maxItems,
      });
    }
  }

  try {
    writeCache(employeeId, cache);
  } catch (err) {
    console.warn("[twin-focus-prefetch] cache write failed:", err);
  }

  return results;
}

const PER_RESULT_CHAR_CAP = 1500;
const TOTAL_CHAR_CAP = 8000;
const TRUNCATION_NOTICE = "\n\n_(focus snapshot truncated to fit prompt budget)_";

function sliceForMaxItems(data: unknown, maxItems: number): unknown {
  if (Array.isArray(data)) return data.slice(0, maxItems);
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const field of ["items", "data", "results"]) {
      if (Array.isArray(obj[field])) {
        return { ...obj, [field]: (obj[field] as unknown[]).slice(0, maxItems) };
      }
    }
  }
  return data;
}

function renderResult(result: PrefetchResult, maxItems: number): string {
  if (!result.ok) {
    return `## ${result.label}\n_(prefetch failed: ${result.errorMessage ?? "unknown error"})_`;
  }
  const sliced = sliceForMaxItems(result.data, maxItems);
  let body = JSON.stringify(sliced, null, 2);
  if (body.length > PER_RESULT_CHAR_CAP) {
    body = body.slice(0, PER_RESULT_CHAR_CAP) + "\n…(truncated)";
  }
  return `## ${result.label}\n\`\`\`json\n${body}\n\`\`\``;
}

export function formatFocusBlock(results: PrefetchResult[]): string {
  if (!results.length) return "";
  const header = `# Focus snapshot (as of ${new Date().toISOString()})`;
  const rendered = results.map((r) => renderResult(r, r.maxItems ?? 5));
  const block = [header, ...rendered].join("\n\n");
  if (block.length <= TOTAL_CHAR_CAP) return block;
  const room = TOTAL_CHAR_CAP - TRUNCATION_NOTICE.length;
  return block.slice(0, Math.max(0, room)) + TRUNCATION_NOTICE;
}
