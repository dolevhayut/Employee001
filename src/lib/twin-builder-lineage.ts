// Data lineage for a twin build: which sources the builder actually read,
// how much, and over what window. The profile's "Trained on" card shows it.
// Client-safe and pure: the runner (twin-builder.ts) gathers the reads, these
// helpers turn them into the `lineage` stored on employee.json.

import type { LineageSource, TwinLineage } from "@/lib/employees";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Uploaded documents (knowledge/) count as one source, never by filename:
 *  lineage rides along on every member's /api/employees row. */
export const KNOWLEDGE_LINEAGE_SOURCE = { toolkit: "knowledge", itemType: "documents" } as const;

export type LineageSourceKey = { toolkit: string; itemType: string };

export type LineageTally = Map<string, LineageSourceKey & { count: number; tokens: number }>;

/**
 * The source an MCP tool call reads from, or null for anything that isn't a
 * connected system (built-ins, Composio meta tools). Composio actions are
 * named `<TOOLKIT>_<ACTION>`; the longest matching active toolkit wins, so
 * `GOOGLECALENDAR_LIST_EVENTS` is googlecalendar even when `google` is active.
 */
export function lineageSourceForTool(
  toolName: string,
  activeToolkits: string[],
  orgMcpNames: string[],
): LineageSourceKey | null {
  const m = toolName.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (!m) return null;
  const [, server, action] = m;
  if (server === "composio") {
    const upper = action.toUpperCase();
    const toolkit = [...activeToolkits]
      .sort((a, b) => b.length - a.length)
      .find((t) => upper.startsWith(`${t.toUpperCase()}_`));
    return toolkit ? { toolkit, itemType: "items read" } : null;
  }
  return orgMcpNames.includes(server) ? { toolkit: server, itemType: "items read" } : null;
}

/** Rough token count of a tool result (about 4 characters per token). At
 *  least 1, so a source that was read always has a share of the total. */
export function approxResultTokens(content: unknown): number {
  let chars = 0;
  if (typeof content === "string") chars = content.length;
  else if (Array.isArray(content)) {
    for (const block of content) {
      const text = (block as { text?: unknown } | null)?.text;
      if (typeof text === "string") chars += text.length;
    }
  }
  return Math.max(1, Math.ceil(chars / 4));
}

/** Count one successful read against its source. */
export function recordLineageRead(tally: LineageTally, source: LineageSourceKey, content: unknown): void {
  const key = `${source.toolkit}\u0000${source.itemType}`;
  const entry = tally.get(key) ?? { ...source, count: 0, tokens: 0 };
  entry.count += 1;
  entry.tokens += approxResultTokens(content);
  tally.set(key, entry);
}

/**
 * The lineage for a finished build, or null when it read nothing. Every
 * source spans the build's lookback window up to when the build finished.
 */
export function buildTwinLineage(args: {
  tally: LineageTally;
  lookbackDays: number;
  startedAt: Date;
  finishedAt: Date;
}): TwinLineage | null {
  const entries = [...args.tally.values()].filter((e) => e.count > 0);
  if (entries.length === 0) return null;
  const fromDate = new Date(args.startedAt.getTime() - args.lookbackDays * DAY_MS).toISOString();
  const toDate = args.finishedAt.toISOString();
  const sources: LineageSource[] = entries
    .sort((a, b) => b.tokens - a.tokens)
    .map((e) => ({
      toolkit: e.toolkit,
      itemType: e.itemType,
      count: e.count,
      tokens: e.tokens,
      fromDate,
      toDate,
      lastSyncAt: toDate,
    }));
  return {
    totalTokens: sources.reduce((sum, s) => sum + s.tokens, 0),
    lastSyncAt: toDate,
    sources,
  };
}

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** A stored lineage, or undefined when the record is missing or malformed
 *  (the card then shows its empty state instead of NaN). */
export function parseTwinLineage(value: unknown): TwinLineage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (!isCount(v.totalTokens) || v.totalTokens <= 0 || !isIso(v.lastSyncAt) || !Array.isArray(v.sources)) {
    return undefined;
  }
  const sources: LineageSource[] = [];
  for (const raw of v.sources) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (
      typeof s.toolkit !== "string" ||
      typeof s.itemType !== "string" ||
      !isCount(s.count) ||
      !isCount(s.tokens) ||
      !isIso(s.fromDate) ||
      !isIso(s.toDate) ||
      !isIso(s.lastSyncAt)
    ) {
      return undefined;
    }
    sources.push({
      toolkit: s.toolkit,
      itemType: s.itemType,
      count: s.count,
      tokens: s.tokens,
      fromDate: s.fromDate,
      toDate: s.toDate,
      lastSyncAt: s.lastSyncAt,
    });
  }
  if (sources.length === 0) return undefined;
  return { totalTokens: v.totalTokens, lastSyncAt: v.lastSyncAt, sources };
}
