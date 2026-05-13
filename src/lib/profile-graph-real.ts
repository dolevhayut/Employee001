// Server-only. Reads real employee MD files from data/employees/[id]/
// and produces nodes + edges for the Obsidian-style graph. Also surfaces
// the agent's WORKING MEMORY as yellow sticky-note nodes orbiting the
// profile cluster:
//   - scratch files at data/scratch/<id>/*.md
//   - recent twin-memory cards from data/memory/<id>/cards.jsonl
// These are tagged "scratch" / "memory" so the renderer can color them
// sticky-note yellow (#fde36b).

import fs from "fs";
import path from "path";
import { readAllEmployeeFiles } from "@/lib/employees-files";

const MEMORY_CARDS_PER_EMPLOYEE = 6;

export type RealNode = {
  name: string;
  tokens: number;
  confidence: number;
  lastUpdated: string;
  sources: string[];
  linkedFiles: string[];
  tags: string[];
};

export type RealEdge = {
  from: string;
  to: string;
  bidirectional: boolean;
};

export type EmployeeGraph = {
  nodes: RealNode[];
  edges: RealEdge[];
};

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

/** Parse the frontmatter block of an employee MD file. */
function parseFrontmatter(raw: string): {
  fm: Record<string, string | string[] | number>;
  body: string;
} {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { fm: {}, body: raw };

  const fm: Record<string, string | string[] | number> = {};
  const lines = m[1].split("\n");
  for (const line of lines) {
    const kvMatch = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    let value = kvMatch[2].trim();

    // List literal: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      const items = inner
        ? inner.split(",").map((s) =>
            s.trim().replace(/^['"]|['"]$/g, "")
          )
        : [];
      fm[key] = items;
      continue;
    }

    // Numeric
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      fm[key] = parseFloat(value);
      continue;
    }

    // String (strip quotes)
    fm[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return { fm, body: m[2] ?? "" };
}

/** Rough token count from text length. */
function estimateTokens(body: string): number {
  // ~4 chars per token is the standard rough estimate.
  return Math.round(body.length / 4);
}

/** Wikilink scanner — matches [[FILE.md]], [[FILE.md#anchor]], [[FILE.md|alias]]. */
const WIKILINK_RE = /\[\[([A-Z_]+\.md)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) {
    out.add(m[1]);
  }
  return Array.from(out);
}

/** Build the full graph for one employee from disk. */
export function buildEmployeeGraph(employeeId: string): EmployeeGraph {
  const files = readAllEmployeeFiles(employeeId);
  const nodes: RealNode[] = [];
  const allLinks = new Map<string, Set<string>>();

  for (const [name, raw] of Object.entries(files)) {
    const { fm, body } = parseFrontmatter(raw);
    const linkedFromFm = (fm.linked_files as string[]) ?? [];
    const linkedFromBody = extractWikilinks(body);
    const linked = Array.from(new Set([...linkedFromFm, ...linkedFromBody]));

    nodes.push({
      name,
      tokens: estimateTokens(body),
      confidence:
        typeof fm.confidence === "number" ? (fm.confidence as number) : 0.75,
      lastUpdated: (fm.last_updated as string) ?? "",
      sources: (fm.sources as string[]) ?? [],
      linkedFiles: linked,
      tags: (fm.tags as string[]) ?? [],
    });

    allLinks.set(name, new Set(linked));
  }

  // Build deduped edge list with bidirectional detection
  const seen = new Set<string>();
  const edges: RealEdge[] = [];
  const order = new Map<string, number>();
  nodes.forEach((n, i) => order.set(n.name, i));

  for (const node of nodes) {
    const targets = allLinks.get(node.name) ?? new Set<string>();
    for (const target of targets) {
      if (target === node.name) continue;
      // Skip targets that aren't real files for this employee
      if (!order.has(target)) continue;

      const a = node.name;
      const b = target;
      const key = a < b ? `${a}→${b}` : `${b}→${a}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const reverseLinks = allLinks.get(b);
      const bidirectional = reverseLinks?.has(a) ?? false;

      const aIdx = order.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bIdx = order.get(b) ?? Number.MAX_SAFE_INTEGER;
      const [from, to] = aIdx <= bIdx ? [a, b] : [b, a];

      edges.push({ from, to, bidirectional });
    }
  }

  // ─── Working memory layer (yellow sticky notes) ────────────────────
  // Anchor every working-memory node to EXPERTISE.md so the layout
  // engine pulls them toward the profile cluster (instead of scattering
  // them around the outer ring as orphans).
  const anchor =
    nodes.find((n) => n.name === "EXPERTISE.md")?.name ??
    nodes[0]?.name ??
    null;

  // ─── Backbone: every profile file links to the hub ─────────────────
  // Markdown profile files often don't cross-reference each other via
  // wikilinks, which would leave them as orphan dots in the brain. Add
  // a hub edge from the anchor to any profile node that has no edges
  // yet, so the brain reads as a single connected organism.
  if (anchor) {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.from);
      connected.add(e.to);
    }
    for (const n of nodes) {
      if (n.name === anchor) continue;
      if (connected.has(n.name)) continue;
      const a = anchor < n.name ? anchor : n.name;
      const b = anchor < n.name ? n.name : anchor;
      const key = `${a}→${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: anchor, to: n.name, bidirectional: false });
    }
  }

  const scratch = readScratchFiles(employeeId);
  for (const sf of scratch) {
    const nodeName = `scratch:${sf.filename}`;
    nodes.push({
      name: nodeName,
      tokens: estimateTokens(sf.body),
      confidence: 0.85,
      lastUpdated: sf.mtime,
      sources: ["scratch"],
      linkedFiles: anchor ? [anchor] : [],
      // tags drives renderer color → "scratch" maps to sticky-note yellow.
      tags: ["scratch"],
    });
    if (anchor) {
      const a = anchor < nodeName ? anchor : nodeName;
      const b = anchor < nodeName ? nodeName : anchor;
      const key = `${a}→${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: anchor, to: nodeName, bidirectional: false });
      }
    }
  }

  const memCards = readRecentMemoryCards(employeeId, MEMORY_CARDS_PER_EMPLOYEE);
  for (const card of memCards) {
    const nodeName = `memory:${card.id}`;
    nodes.push({
      name: nodeName,
      tokens: Math.max(40, Math.round((card.preview ?? "").length / 4)),
      confidence: 0.7,
      lastUpdated: card.createdAt,
      sources: ["memory"],
      linkedFiles: anchor ? [anchor] : [],
      // tags[0] = "memory", tags[1] = preview text used as label.
      tags: ["memory", card.preview ?? "recall"],
    });
    if (anchor) {
      const a = anchor < nodeName ? anchor : nodeName;
      const b = anchor < nodeName ? nodeName : anchor;
      const key = `${a}→${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: anchor, to: nodeName, bidirectional: false });
      }
    }
  }

  return { nodes, edges };
}

// ─── Working-memory readers (server-only) ────────────────────────────

type ScratchFile = { filename: string; body: string; mtime: string };
function readScratchFiles(employeeId: string): ScratchFile[] {
  const dir = path.join(process.cwd(), "data", "scratch", employeeId);
  try {
    if (!fs.existsSync(dir)) return [];
    const out: ScratchFile[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const fp = path.join(dir, e.name);
      const stat = fs.statSync(fp);
      out.push({
        filename: e.name,
        body: fs.readFileSync(fp, "utf8"),
        mtime: stat.mtime.toISOString(),
      });
    }
    return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

type MemoryCardLite = { id: string; preview: string; createdAt: string };
function readRecentMemoryCards(
  employeeId: string,
  limit: number
): MemoryCardLite[] {
  const file = path.join(
    process.cwd(),
    "data",
    "memory",
    employeeId,
    "cards.jsonl"
  );
  try {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const out: MemoryCardLite[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const c = JSON.parse(lines[i]) as {
          id?: string;
          question?: string;
          answerPreview?: string;
          createdAt?: string;
        };
        const id = c.id ?? `c-${i}`;
        const preview = (c.question ?? c.answerPreview ?? "").slice(0, 60);
        if (!preview) continue;
        out.push({ id, preview, createdAt: c.createdAt ?? "" });
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Read raw MD content of one file. */
export function readEmployeeFileRaw(
  employeeId: string,
  filename: string
): string | null {
  const files = readAllEmployeeFiles(employeeId);
  return files[filename] ?? null;
}

/** Strip frontmatter; return only the markdown body. */
export function readEmployeeFileBody(
  employeeId: string,
  filename: string
): { frontmatter: RealNode | null; body: string } | null {
  const raw = readEmployeeFileRaw(employeeId, filename);
  if (!raw) return null;
  const { fm, body } = parseFrontmatter(raw);
  const frontmatter: RealNode = {
    name: filename,
    tokens: estimateTokens(body),
    confidence:
      typeof fm.confidence === "number" ? (fm.confidence as number) : 0.75,
    lastUpdated: (fm.last_updated as string) ?? "",
    sources: (fm.sources as string[]) ?? [],
    linkedFiles: (fm.linked_files as string[]) ?? [],
    tags: (fm.tags as string[]) ?? [],
  };
  return { frontmatter, body };
}
