// BM25-based lexical search across every employee's 9 profile markdown files
// plus any shared org-brain nodes. Built lazily on first query, kept warm in
// memory, and invalidated by the directory mtime so freshly-edited files
// surface immediately.
//
// Why BM25 not embeddings: this is the local-first OSS edition. Real semantic
// embeddings would require either a third-party API key (which the user
// explicitly doesn't want) or a model download via transformers.js (~20MB +
// ONNX runtime + cold-start latency). BM25 is one Node-only function, finds
// keyword matches with frequency + rarity weighting, and is "good enough" for
// the 5-employee × 9-file scale this product runs at. The seam to upgrade is
// the `score()` function in this file; everything else (MCP tool surface,
// runner wiring, system prompt) stays put.
//
// Index size at this product's scale (5 employees, 45 files, ~1KB-3KB each):
// • Term dictionary: ~3K unique terms
// • Per-doc length: ~200 tokens after stopword removal
// • Full index in memory: a few hundred KB
// Query latency: <5ms on M-series. No optimisation needed.

import "server-only";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

// ─── Tokenisation ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  // English most-common — anything that drowns BM25 signal
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't",
  "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during",
  "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "isn't", "it", "its",
  "itself", "just", "let's", "me", "more", "most", "my", "myself", "no", "nor",
  "not", "now", "of", "off", "on", "once", "only", "or", "other", "ought", "our",
  "ours", "ourselves", "out", "over", "own", "same", "should", "shouldn't", "so",
  "some", "such", "than", "that", "that's", "the", "their", "theirs", "them",
  "themselves", "then", "there", "these", "they", "this", "those", "through",
  "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "were",
  "weren't", "what", "when", "where", "which", "while", "who", "whose", "why",
  "with", "won't", "would", "wouldn't", "you", "your", "yours", "yourself",
]);

/** Cheap tokeniser — lowercase, strip non-alphanumeric, drop stopwords and
 *  one-char tokens. Good enough for English; for non-English files the
 *  full token survives intact (Hebrew etc. pass through). */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_~\[\]()<>{}#|!?,.;:"]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-']+|[-']+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// ─── Index types ──────────────────────────────────────────────────────────────

type ChunkId = string;

type Chunk = {
  id: ChunkId;
  /** Source employee id (e.g. "maya-chen") or "org-brain" for shared nodes. */
  source: string;
  /** Display label for the source ("Maya Chen", or "Org brain"). */
  sourceLabel: string;
  /** File name relative to the source (e.g. "EXPERTISE.md"). */
  file: string;
  /** Section heading from the markdown header trail, or empty for top-of-file. */
  section: string;
  /** Raw text content of this chunk, ready to return as a citation. */
  text: string;
  /** Tokenised body for BM25 — kept on the chunk so we don't re-tokenise per query. */
  tokens: string[];
};

type Index = {
  builtAt: number;
  /** Root mtime when the index was built — used for invalidation. */
  rootMtime: number;
  chunks: Chunk[];
  /** Document frequency: how many chunks each term appears in. */
  df: Map<string, number>;
  avgDocLen: number;
};

// ─── BM25 ─────────────────────────────────────────────────────────────────────

// Standard BM25 hyperparameters. Defaults from the original paper work fine
// for our scale; tuning isn't worth the cycle.
const K1 = 1.5;
const B = 0.75;

function score(query: string[], chunk: Chunk, index: Index): number {
  const N = index.chunks.length;
  let s = 0;
  for (const term of query) {
    const f = chunk.tokens.filter((t) => t === term).length;
    if (f === 0) continue;
    const n = index.df.get(term) ?? 0;
    // IDF — log((N - n + 0.5) / (n + 0.5) + 1) keeps things positive
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    const tfNorm = (f * (K1 + 1)) / (f + K1 * (1 - B + (B * chunk.tokens.length) / index.avgDocLen));
    s += idf * tfNorm;
  }
  return s;
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/** Split a markdown body into chunks. Each H1/H2/H3 starts a new chunk;
 *  paragraphs within the same heading are joined. Falls back to one chunk
 *  per file when there are no headings. */
function chunkMarkdown(body: string): Array<{ section: string; text: string }> {
  if (!body.trim()) return [];
  const lines = body.split("\n");
  const out: Array<{ section: string; text: string }> = [];
  let currentSection = "";
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ section: currentSection, text });
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) {
      flush();
      currentSection = m[2].trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

// ─── Index build ──────────────────────────────────────────────────────────────

const PROFILE_FILES = [
  "EXPERTISE.md", "DECISIONS.md", "CONTEXT.md", "PEOPLE.md",
  "PROJECTS.md", "PREFERENCES.md", "TONE.md", "BOUNDARIES.md", "EMPLOYMENT.md",
];

type Source = { id: string; label: string; dir: string; files: string[] };

/** Enumerate every source we'll index: each employee directory + the
 *  optional org-brain nodes directory. Skips dotted directories (trial
 *  agents, the leading-dot convention used elsewhere in the repo). */
async function discoverSources(): Promise<Source[]> {
  const root = path.join(process.cwd(), "data");
  const sources: Source[] = [];

  // Employee directories
  const employeesRoot = path.join(root, "employees");
  try {
    const entries = await fs.readdir(employeesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const dir = path.join(employeesRoot, entry.name);
      let label = entry.name;
      try {
        const sidecar = JSON.parse(
          await fs.readFile(path.join(dir, "employee.json"), "utf8"),
        ) as { name?: string };
        if (sidecar.name) label = sidecar.name;
      } catch {
        // missing or malformed — fall back to the directory id
      }
      sources.push({ id: entry.name, label, dir, files: PROFILE_FILES });
    }
  } catch {
    // employees/ doesn't exist yet — empty index is fine
  }

  // Shared org-brain nodes (optional)
  const brainDir = path.join(root, "org-brain", "nodes");
  try {
    const entries = await fs.readdir(brainDir);
    const brainFiles = entries.filter((f) => f.endsWith(".md"));
    if (brainFiles.length > 0) {
      sources.push({ id: "org-brain", label: "Org brain", dir: brainDir, files: brainFiles });
    }
  } catch {
    // no shared brain yet — silent
  }

  return sources;
}

async function buildIndex(): Promise<Index> {
  const sources = await discoverSources();
  const chunks: Chunk[] = [];
  const df = new Map<string, number>();

  for (const source of sources) {
    for (const fileName of source.files) {
      const filePath = path.join(source.dir, fileName);
      let body: string;
      try {
        body = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }
      const split = chunkMarkdown(body);
      for (let i = 0; i < split.length; i += 1) {
        const piece = split[i];
        const id = `${source.id}#${fileName}#${i}`;
        const tokens = tokenise(`${piece.section} ${piece.text}`);
        if (tokens.length === 0) continue;
        chunks.push({
          id,
          source: source.id,
          sourceLabel: source.label,
          file: fileName,
          section: piece.section,
          text: piece.text,
          tokens,
        });
        // Document frequency — each unique term in this chunk bumps df by 1.
        const seen = new Set<string>();
        for (const t of tokens) {
          if (seen.has(t)) continue;
          seen.add(t);
          df.set(t, (df.get(t) ?? 0) + 1);
        }
      }
    }
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.tokens.length, 0);
  const avgDocLen = chunks.length > 0 ? totalLen / chunks.length : 0;

  return {
    builtAt: Date.now(),
    rootMtime: await rootMtime(),
    chunks,
    df,
    avgDocLen,
  };
}

/** Stat the data/employees root and return its mtime. Cheap proxy for
 *  "did anything change since the index was built." A new file or
 *  rewritten file bumps the parent directory mtime; an edit to an
 *  existing file's content does NOT, so we ALSO check the most recent
 *  file mtime within the tree. */
async function rootMtime(): Promise<number> {
  const root = path.join(process.cwd(), "data", "employees");
  let latest = 0;
  try {
    const dirs = await fs.readdir(root, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      const sub = path.join(root, d.name);
      try {
        const stat = await fs.stat(sub);
        if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      } catch { /* skip */ }
      try {
        const files = await fs.readdir(sub);
        for (const f of files) {
          if (!f.endsWith(".md") && f !== "employee.json") continue;
          try {
            const stat = await fs.stat(path.join(sub, f));
            if (stat.mtimeMs > latest) latest = stat.mtimeMs;
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* empty root — fine */ }
  return latest;
}

// ─── Cache + public API ──────────────────────────────────────────────────────

let cache: Index | null = null;
let buildInFlight: Promise<Index> | null = null;

/** Get the index, rebuilding lazily if any file under data/employees has
 *  been touched since the last build. Concurrent callers share one build. */
async function getIndex(): Promise<Index> {
  const currentMtime = await rootMtime();
  if (cache && cache.rootMtime >= currentMtime) return cache;
  if (buildInFlight) return buildInFlight;
  buildInFlight = (async () => {
    const idx = await buildIndex();
    cache = idx;
    buildInFlight = null;
    return idx;
  })();
  return buildInFlight;
}

export type OrgBrainHit = {
  /** Stable handle of the chunk in the form `<source>#<file>#<offset>`. */
  id: string;
  /** Source employee id ("maya-chen") or "org-brain". */
  source: string;
  /** Display label for the source ("Maya Chen", "Org brain"). */
  sourceLabel: string;
  /** File name within the source dir. */
  file: string;
  /** Section heading the chunk lives under (empty for top-of-file). */
  section: string;
  /** A short snippet of the chunk text, capped to ~400 chars. */
  snippet: string;
  /** BM25 score, only useful for relative comparison within one query. */
  score: number;
};

export type SearchOptions = {
  /** Restrict to a single employee id, or "org-brain" for shared nodes. */
  source?: string;
  /** Restrict to a single profile file (e.g. "DECISIONS.md"). */
  file?: string;
  /** Max results to return (default 6, hard cap 20). */
  limit?: number;
};

/**
 * Search the org brain. Returns the top-k chunks by BM25 score across every
 * employee's profile files + any shared org-brain nodes. Hits are sorted by
 * score descending. Empty array if nothing scores > 0 (e.g. the query is all
 * stopwords).
 */
export async function searchOrgBrain(
  query: string,
  options: SearchOptions = {},
): Promise<OrgBrainHit[]> {
  const q = tokenise(query);
  if (q.length === 0) return [];

  const idx = await getIndex();
  if (idx.chunks.length === 0) return [];

  const filter = (c: Chunk): boolean => {
    if (options.source && c.source !== options.source) return false;
    if (options.file && c.file !== options.file) return false;
    return true;
  };

  const limit = Math.min(20, Math.max(1, options.limit ?? 6));
  const scored: Array<{ chunk: Chunk; s: number }> = [];
  for (const chunk of idx.chunks) {
    if (!filter(chunk)) continue;
    const s = score(q, chunk, idx);
    if (s <= 0) continue;
    scored.push({ chunk, s });
  }
  scored.sort((a, b) => b.s - a.s);

  return scored.slice(0, limit).map(({ chunk, s }) => ({
    id: chunk.id,
    source: chunk.source,
    sourceLabel: chunk.sourceLabel,
    file: chunk.file,
    section: chunk.section,
    snippet: chunk.text.length > 400 ? chunk.text.slice(0, 400).trimEnd() + "…" : chunk.text,
    score: Math.round(s * 1000) / 1000,
  }));
}

/** Synchronous diagnostic helper used by tests and the health-check page. */
export function isIndexBuilt(): boolean {
  return cache !== null;
}

/** Drop the cached index — forces the next query to rebuild. Used after
 *  bulk profile imports / scripted edits so the runner sees fresh content
 *  without waiting on the mtime heuristic. */
export function invalidateIndex(): void {
  cache = null;
}

/** Synchronous helper for the diagnostic UI — counts roughly how many
 *  chunks we'd index without building. Cheap. */
export function quickStats(): { sourceCount: number } {
  // Light synchronous probe, no markdown parsing
  try {
    const root = path.join(process.cwd(), "data", "employees");
    if (!fsSync.existsSync(root)) return { sourceCount: 0 };
    let count = 0;
    for (const name of fsSync.readdirSync(root)) {
      if (name.startsWith(".")) continue;
      if (fsSync.statSync(path.join(root, name)).isDirectory()) count += 1;
    }
    return { sourceCount: count };
  } catch {
    return { sourceCount: 0 };
  }
}
