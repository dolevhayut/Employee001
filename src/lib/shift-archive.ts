// Per-shift archive — a durable, organised record of everything an autonomous
// shift did and produced. One folder per run under data/shifts/<runId>/:
//
//   manifest.json   — run metadata (who/when/cost/status + approvals + output count)
//   events.jsonl    — full chronological history (tool calls, results, approvals)
//   outputs.jsonl   — distilled deliverables (image/video URLs, files, links)
//
// Mirrors the JSONL grain the rest of the app uses (run-logs, task-events,
// task-history). The run-logs NDJSON stays the live cockpit tail; this archive
// is the durable, output-focused record. Every function is fail-safe — a disk
// hiccup must never crash a shift.

import "server-only";
import fs from "fs";
import path from "path";

export type ShiftOutputKind = "image" | "video" | "file" | "link" | "text" | "document";

export type ShiftArchiveEvent =
  | { ts: string; kind: "meta"; message: string }
  | { ts: string; kind: "tool_use"; tool: string; input?: Record<string, unknown> }
  | { ts: string; kind: "tool_result"; tool: string; output?: string; urls?: string[] }
  | { ts: string; kind: "approval_request"; tool: string; reason: string }
  | { ts: string; kind: "approval"; tool: string; decision: "allow" | "deny" }
  | { ts: string; kind: "done"; summary: string };

// Distributive Omit so stripping `ts` keeps the discriminated-union shape
// (a plain Omit collapses the union and drops per-variant fields).
type DistributiveOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never;
export type ShiftArchiveEventInput = DistributiveOmit<ShiftArchiveEvent, "ts">;

export type ShiftOutput = {
  ts: string;
  tool: string;
  kind: ShiftOutputKind;
  urls?: string[];
  /** Relative path (within the shift folder) to a saved deliverable file. */
  path?: string;
  note?: string;
};

export type ShiftManifest = {
  runId: string;
  employeeId: string;
  employeeName: string;
  trigger: "scheduled" | "manual" | "wakeup";
  startedAt: string;
  endedAt?: string;
  status?: "running" | "complete" | "error";
  costUsd?: number;
  turns?: number;
  summary?: string;
  outputCount: number;
  approvals: Array<{ tool: string; decision: "allow" | "deny"; ts: string }>;
};

const MAX_OUTPUT_CHARS = 4096;
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

function shiftDir(runId: string): string {
  return path.join(process.cwd(), "data", "shifts", runId);
}

function ensureDir(runId: string): string {
  const dir = shiftDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendLine(file: string, obj: unknown): void {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

/**
 * Truncate a tool-result string for storage. base64-ish blobs (long runs with
 * no whitespace) are collapsed to a placeholder so we never persist megabytes
 * of inline image bytes — the URL/output that matters is captured separately.
 */
export function summariseOutput(raw: string): string {
  const text = raw ?? "";
  const looksBase64 =
    text.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 512)) && !/\s/.test(text.slice(0, 200));
  if (looksBase64) return `[binary/base64 payload omitted — ${text.length} chars]`;
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + `… [+${text.length - MAX_OUTPUT_CHARS} chars]` : text;
}

/** Pull http(s) URLs out of a tool-result string. */
export function extractUrls(raw: string): string[] {
  const out = new Set<string>();
  for (const m of (raw ?? "").matchAll(URL_RE)) out.add(m[0]);
  return [...out].slice(0, 20);
}

/** Infer an output kind from a URL and/or the tool name. */
export function inferOutputKind(url: string, tool: string): ShiftOutputKind {
  const u = url.toLowerCase();
  const t = tool.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/.test(u) || /image|photo|design|render/.test(t)) return "image";
  if (/\.(mp4|mov|webm|m4v|gif)(\?|$)/.test(u) || /video|clip|reel|teaser/.test(t)) return "video";
  if (/\.(pdf|docx?|pptx?|xlsx?|csv|zip|json|md)(\?|$)/.test(u)) return "file";
  return "link";
}

// ─── Manifest ───────────────────────────────────────────────────────────────

function manifestPath(runId: string): string {
  return path.join(shiftDir(runId), "manifest.json");
}

function readManifest(runId: string): ShiftManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(runId), "utf8")) as ShiftManifest;
  } catch {
    return null;
  }
}

function writeManifest(m: ShiftManifest): void {
  fs.writeFileSync(manifestPath(m.runId), JSON.stringify(m, null, 2), "utf8");
}

// ─── Public API (all fail-safe) ───────────────────────────────────────────────

// ─── Reader ───────────────────────────────────────────────────────────────────

export type ShiftArchiveData = {
  manifest: ShiftManifest | null;
  outputs: ShiftOutput[];
  artifacts: Array<{ name: string; relativePath: string; sizeBytes: number }>;
};

/** Read a shift's archive from disk. Safe — returns nulls/empty on missing dir. */
export function readShiftArchive(runId: string): ShiftArchiveData {
  const dir = shiftDir(runId);
  const manifest = readManifest(runId);
  const outputs: ShiftOutput[] = [];
  try {
    const raw = fs.readFileSync(path.join(dir, "outputs.jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { outputs.push(JSON.parse(line) as ShiftOutput); } catch { /* skip */ }
    }
  } catch { /* file absent */ }
  const artifacts: ShiftArchiveData["artifacts"] = [];
  const artifactsDir = path.join(dir, "artifacts");
  try {
    for (const name of fs.readdirSync(artifactsDir)) {
      const full = path.join(artifactsDir, name);
      const stat = fs.statSync(full);
      artifacts.push({ name, relativePath: path.join("artifacts", name), sizeBytes: stat.size });
    }
  } catch { /* dir absent */ }
  return { manifest, outputs, artifacts };
}

/** List shift archives (manifests only), newest first. Optionally filter by twin. */
export function listShiftArchives(opts?: { employeeId?: string; limit?: number }): ShiftManifest[] {
  const root = path.join(process.cwd(), "data", "shifts");
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out: ShiftManifest[] = [];
  for (const runId of dirs) {
    if (runId.startsWith(".")) continue;
    const m = readManifest(runId);
    if (!m) continue;
    if (opts?.employeeId && m.employeeId !== opts.employeeId) continue;
    out.push(m);
  }
  out.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return typeof opts?.limit === "number" ? out.slice(0, opts.limit) : out;
}

/** Read a specific artifact file as UTF-8 text. Returns null if not found or too large. */
export function readArtifactContent(runId: string, artifactName: string): string | null {
  try {
    const full = path.join(shiftDir(runId), "artifacts", path.basename(artifactName));
    if (!fs.existsSync(full)) return null;
    const stat = fs.statSync(full);
    if (stat.size > MAX_DOC_BYTES) return null;
    return fs.readFileSync(full, "utf8");
  } catch { return null; }
}

export function initShiftArchive(meta: {
  runId: string;
  employeeId: string;
  employeeName: string;
  trigger: "scheduled" | "manual" | "wakeup";
}): void {
  try {
    ensureDir(meta.runId);
    writeManifest({
      ...meta,
      startedAt: new Date().toISOString(),
      status: "running",
      outputCount: 0,
      approvals: [],
    });
  } catch (err) {
    console.warn("[shift-archive] init failed", meta.runId, err);
  }
}

export function archiveEvent(runId: string, event: ShiftArchiveEventInput): void {
  try {
    const dir = ensureDir(runId);
    const stamped = { ts: new Date().toISOString(), ...event } as ShiftArchiveEvent;
    appendLine(path.join(dir, "events.jsonl"), stamped);
    // Mirror approval decisions into the manifest for an at-a-glance summary.
    if (stamped.kind === "approval") {
      const m = readManifest(runId);
      if (m) {
        m.approvals.push({ tool: stamped.tool, decision: stamped.decision, ts: stamped.ts });
        writeManifest(m);
      }
    }
  } catch (err) {
    console.warn("[shift-archive] event failed", runId, err);
  }
}

export function archiveOutput(runId: string, output: Omit<ShiftOutput, "ts">): void {
  try {
    const dir = ensureDir(runId);
    const stamped: ShiftOutput = { ts: new Date().toISOString(), ...output };
    appendLine(path.join(dir, "outputs.jsonl"), stamped);
    const m = readManifest(runId);
    if (m) {
      m.outputCount += 1;
      writeManifest(m);
    }
  } catch (err) {
    console.warn("[shift-archive] output failed", runId, err);
  }
}

/**
 * Capture a tool result: write the (truncated) payload to events.jsonl and, if
 * it carries URLs, record one distilled output per URL group.
 */
export function archiveToolResult(runId: string, tool: string, rawResult: string): void {
  const urls = extractUrls(rawResult);
  archiveEvent(runId, {
    kind: "tool_result",
    tool,
    output: summariseOutput(rawResult),
    ...(urls.length ? { urls } : {}),
  });
  if (urls.length) {
    archiveOutput(runId, {
      tool,
      kind: inferOutputKind(urls[0], tool),
      urls,
      note: `Produced by ${tool}`,
    });
  }
}

const MAX_DOC_BYTES = 256 * 1024;

function slugify(s: string): string {
  return (
    (s || "document")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  );
}

/**
 * Persist a document deliverable (markdown body) as a real file under
 * data/shifts/<runId>/artifacts/<slug>.md and record it as an output. This is
 * the "the agent wrote a doc" deliverable that agentic workflows produce —
 * stored as an openable file, not just a mention. Returns the relative path.
 */
export function archiveDocument(
  runId: string,
  doc: { title: string; content: string; kind?: ShiftOutputKind }
): string | null {
  try {
    const artifactsDir = path.join(ensureDir(runId), "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    let name = `${slugify(doc.title)}.md`;
    let full = path.join(artifactsDir, name);
    for (let i = 1; fs.existsSync(full); i++) {
      name = `${slugify(doc.title)}-${i}.md`;
      full = path.join(artifactsDir, name);
    }
    const body = doc.content.length > MAX_DOC_BYTES ? doc.content.slice(0, MAX_DOC_BYTES) : doc.content;
    fs.writeFileSync(full, body, "utf8");
    const rel = path.join("artifacts", name);
    archiveOutput(runId, {
      tool: "shift-report",
      kind: doc.kind ?? "document",
      path: rel,
      note: doc.title,
    });
    return rel;
  } catch (err) {
    console.warn("[shift-archive] document failed", runId, err);
    return null;
  }
}

export function finalizeShiftArchive(
  runId: string,
  final: { status: "complete" | "error"; summary: string; costUsd?: number; turns?: number }
): void {
  try {
    archiveEvent(runId, { kind: "done", summary: final.summary });
    const m = readManifest(runId);
    if (m) {
      m.endedAt = new Date().toISOString();
      m.status = final.status;
      m.summary = final.summary;
      m.costUsd = final.costUsd;
      m.turns = final.turns;
      writeManifest(m);
    }
  } catch (err) {
    console.warn("[shift-archive] finalize failed", runId, err);
  }
}
