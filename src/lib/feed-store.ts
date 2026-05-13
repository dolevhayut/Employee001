import fs from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedItemType = "update" | "alert" | "needs-review" | "task-handoff";
export type FeedItemStatus = "open" | "resolved" | "dismissed";

export type FeedSource =
  | { kind: "shift"; employeeId: string; runId: string }
  | {
      kind: "routine";
      employeeId: string;
      runId: string;
      routineId: string;
      routineName: string;
    }
  | {
      kind: "task-run";
      employeeId: string;
      runId: string;
      task: string;
    }
  | { kind: "twin-task"; taskId: string; fromId: string; toId: string }
  | {
      kind: "approval";
      employeeId: string;
      runId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | { kind: "off-track"; departmentId: string; metric: string };

export type FeedItem = {
  id: string;
  ts: string;
  source: FeedSource;
  type: FeedItemType;
  title: string;
  detail?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  status: FeedItemStatus;
  resolvedAt?: string;
  resolution?: string;
};

export type FeedListFilter = {
  type?: FeedItemType | FeedItemType[];
  status?: FeedItemStatus | FeedItemStatus[];
  employeeId?: string;
  limit?: number;
  since?: string;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const FEED_FILE = path.join(process.cwd(), "data", "org", "feed.jsonl");

function ensureDir() {
  const dir = path.dirname(FEED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let _counter = 0;
function makeId(): string {
  _counter++;
  return `feed_${Date.now().toString(36)}_${_counter}`;
}

function normalize(raw: Partial<FeedItem> & { id?: string; ts?: string }): FeedItem | null {
  if (!raw || !raw.id || !raw.ts || !raw.source || !raw.title) return null;
  return {
    id: raw.id,
    ts: raw.ts,
    source: raw.source as FeedSource,
    type: (raw.type as FeedItemType) ?? "update",
    title: raw.title,
    detail: raw.detail,
    priority: (raw.priority as FeedItem["priority"]) ?? 3,
    status: (raw.status as FeedItemStatus) ?? "open",
    resolvedAt: raw.resolvedAt,
    resolution: raw.resolution,
  };
}

function readAllLines(): FeedItem[] {
  try {
    ensureDir();
    if (!fs.existsSync(FEED_FILE)) return [];
    const raw = fs.readFileSync(FEED_FILE, "utf8");
    const items: FeedItem[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const item = normalize(parsed);
        if (item) items.push(item);
        else console.warn("[feed-store] dropping malformed line", line.slice(0, 120));
      } catch {
        console.warn("[feed-store] unparseable line", line.slice(0, 120));
      }
    }
    return items;
  } catch (err) {
    console.warn("[feed-store] read failed", err);
    return [];
  }
}

function sourceMatchesEmployee(source: FeedSource, employeeId: string): boolean {
  switch (source.kind) {
    case "shift":
      return source.employeeId === employeeId;
    case "routine":
      return source.employeeId === employeeId;
    case "task-run":
      return source.employeeId === employeeId;
    case "twin-task":
      return source.fromId === employeeId || source.toId === employeeId;
    case "approval":
      return source.employeeId === employeeId;
    case "off-track":
      return false;
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

export function appendFeedItem(input: {
  source: FeedSource;
  type: FeedItemType;
  title: string;
  detail?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
}): FeedItem {
  const item: FeedItem = {
    id: makeId(),
    ts: new Date().toISOString(),
    source: input.source,
    type: input.type,
    title: input.title,
    detail: input.detail,
    priority: input.priority ?? 3,
    status: "open",
  };
  try {
    ensureDir();
    fs.appendFileSync(FEED_FILE, JSON.stringify(item) + "\n", "utf8");
  } catch (err) {
    console.warn("[feed-store] append failed", err);
  }
  return item;
}

export function listFeed(filter: FeedListFilter = {}): FeedItem[] {
  let items = readAllLines();

  if (filter.type) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    items = items.filter((i) => types.includes(i.type));
  }
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    items = items.filter((i) => statuses.includes(i.status));
  }
  if (filter.employeeId) {
    items = items.filter((i) => sourceMatchesEmployee(i.source, filter.employeeId!));
  }
  if (filter.since) {
    items = items.filter((i) => i.ts >= filter.since!);
  }

  items.sort((a, b) => b.ts.localeCompare(a.ts));

  if (typeof filter.limit === "number" && filter.limit >= 0) {
    items = items.slice(0, filter.limit);
  }
  return items;
}

export function getFeedItem(id: string): FeedItem | null {
  return readAllLines().find((i) => i.id === id) ?? null;
}

export function resolveFeedItem(
  id: string,
  resolution: "approved" | "rejected" | "dismissed",
  note?: string
): FeedItem | null {
  try {
    const items = readAllLines();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    items[idx] = {
      ...items[idx],
      status: resolution === "dismissed" ? "dismissed" : "resolved",
      resolvedAt: now,
      resolution: note ?? resolution,
    };
    ensureDir();
    const body = items.map((i) => JSON.stringify(i)).join("\n") + "\n";
    fs.writeFileSync(FEED_FILE, body, "utf8");
    return items[idx];
  } catch (err) {
    console.warn("[feed-store] resolve failed", id, err);
    return null;
  }
}
