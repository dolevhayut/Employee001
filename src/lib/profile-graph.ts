// Employee001 — Twin Memory Graph helpers.
// Pure data layer: parses wikilinks, builds backlink/outlink lookups, and
// produces a deduped edge list for the React Flow graph view.

import type { WikiLink } from "@/lib/ex-graph-types";
import {
  PROFILE_FILES,
  type ContentLine,
  type ProfileFile,
} from "@/lib/ex-profile-files";

export type { WikiLink };

const WIKILINK_RE = /\[\[([A-Z_]+\.md)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/**
 * Pure: extract every `[[FILENAME.md]]` (with optional `#anchor` and `|alias`)
 * from a markdown string. Does NOT touch PROFILE_FILES.
 */
export function extractWikilinks(markdown: string): WikiLink[] {
  const out: WikiLink[] = [];
  // Reset regex state — the regex literal above is shared via closure.
  const re = new RegExp(WIKILINK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const link: WikiLink = { target: m[1] };
    if (m[2]) link.anchor = m[2];
    if (m[3]) link.alias = m[3];
    out.push(link);
  }
  return out;
}

export function getProfileFile(name: string): ProfileFile | undefined {
  return PROFILE_FILES.find((f) => f.name === name);
}

/** File names whose `linked_files` include `name`. */
export function getBacklinks(name: string): string[] {
  return PROFILE_FILES
    .filter((f) => f.name !== name && f.frontmatter.linked_files.includes(name))
    .map((f) => f.name);
}

/** Outbound: this file's frontmatter `linked_files`. */
export function getOutlinks(name: string): string[] {
  const f = getProfileFile(name);
  return f ? [...f.frontmatter.linked_files] : [];
}

export type GraphEdge = {
  from: string;
  to: string;
  bidirectional?: boolean;
};

/**
 * Deduped edge list. If A→B and B→A both exist, we emit one edge marked
 * `bidirectional: true` (direction A→B is arbitrary but deterministic by
 * PROFILE_FILES order).
 */
export function getEdges(): GraphEdge[] {
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  const order = new Map<string, number>();
  PROFILE_FILES.forEach((f, i) => order.set(f.name, i));

  for (const file of PROFILE_FILES) {
    for (const target of file.frontmatter.linked_files) {
      if (file.name === target) continue;
      const a = file.name;
      const b = target;
      const key = a < b ? `${a}→${b}` : `${b}→${a}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const reverse = PROFILE_FILES.find((f) => f.name === b);
      const bidirectional = !!reverse?.frontmatter.linked_files.includes(a);

      // Pick deterministic direction: lower PROFILE_FILES index first.
      const aIdx = order.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bIdx = order.get(b) ?? Number.MAX_SAFE_INTEGER;
      const [from, to] = aIdx <= bIdx ? [a, b] : [b, a];

      const edge: GraphEdge = { from, to };
      if (bidirectional) edge.bidirectional = true;
      edges.push(edge);
    }
  }

  return edges;
}

/**
 * Pass-through. The UI splits `[[...]]` at render time, so we leave the raw
 * wikilink markup intact in `line.v`. This helper exists so callers have one
 * obvious place to hook content transforms later without touching the data.
 */
export function renderContentWithLinks(content: ContentLine[]): ContentLine[] {
  return content.map((line) => ({ ...line }));
}
