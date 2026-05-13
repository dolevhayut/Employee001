// Org Brain — organization-wide knowledge graph (YC "Company Brain" layer).
//
// Mirrors org-skills in structure, but stores FACTS not playbooks:
//   - org-skills/{id}/SKILL.md   = how the org thinks (playbook)
//   - org-brain/nodes/{slug}.md  = what is true about the org (knowledge node)
//
// Every node is a markdown file with YAML frontmatter. All twins read the
// same brain. Trigger-based recall is injected as a dynamic block in the
// twin's system prompt at run time (see council-runner buildSystemPromptBlocks).

import fs from "fs";
import path from "path";

const ORG_BRAIN_DIR = path.join(process.cwd(), "data", "org-brain");
const NODES_DIR = path.join(ORG_BRAIN_DIR, "nodes");
const DEFAULT_LIMIT = 4;

export type OrgBrainNodeType =
  | "document"
  | "decision"
  | "incident"
  | "policy"
  | "customer"
  | "product"
  | "process"
  | "note";

export type OrgBrainNode = {
  slug: string;
  label: string;
  type: OrgBrainNodeType;
  description: string;
  triggers: string[];
  sources: string[];
  linkedNodes: string[];
  lastUpdated: string;
  body: string;
};

export type OrgBrainHit = {
  node: OrgBrainNode;
  score: number;
};

export type OrgBrainInput = {
  slug: string;
  label: string;
  type?: OrgBrainNodeType;
  description?: string;
  triggers?: string[];
  sources?: string[];
  linkedNodes?: string[];
  body: string;
};

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
const WIKILINK_RE = /\[\[([a-zA-Z0-9_-]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

const VALID_TYPES: OrgBrainNodeType[] = [
  "document",
  "decision",
  "incident",
  "policy",
  "customer",
  "product",
  "process",
  "note",
];

function parseFrontmatter(raw: string): {
  fm: Record<string, string | string[]>;
  body: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { fm: {}, body: raw };
  const fm: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      fm[key] = inner
        ? inner.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        : [];
      continue;
    }
    fm[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return { fm, body: match[2]?.trim() ?? "" };
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stringValue(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

function arrayValue(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) return [v];
  return [];
}

function coerceType(v: string): OrgBrainNodeType {
  const candidate = v.toLowerCase() as OrgBrainNodeType;
  return VALID_TYPES.includes(candidate) ? candidate : "note";
}

function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) out.add(m[1]);
  return Array.from(out);
}

export function readOrgBrainNode(slug: string): OrgBrainNode | null {
  const safe = safeSlug(slug);
  const file = path.join(NODES_DIR, `${safe}.md`);
  try {
    const raw = fs.readFileSync(file, "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const linksFromFm = arrayValue(fm.linked_nodes);
    const linksFromBody = extractWikilinks(body);
    const linkedNodes = Array.from(new Set([...linksFromFm, ...linksFromBody]));
    return {
      slug: stringValue(fm.slug) || safe,
      label: stringValue(fm.label) || safe,
      type: coerceType(stringValue(fm.type) || "note"),
      description: stringValue(fm.description),
      triggers: arrayValue(fm.triggers),
      sources: arrayValue(fm.sources),
      linkedNodes,
      lastUpdated: stringValue(fm.last_updated),
      body,
    };
  } catch {
    return null;
  }
}

export function listOrgBrainNodes(): OrgBrainNode[] {
  try {
    return fs
      .readdirSync(NODES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => readOrgBrainNode(entry.name.replace(/\.md$/, "")))
      .filter((n): n is OrgBrainNode => Boolean(n))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

export function writeOrgBrainNode(input: OrgBrainInput): OrgBrainNode {
  const slug = safeSlug(input.slug);
  if (!slug) throw new Error("node slug is required");

  const node: OrgBrainNode = {
    slug,
    label: input.label.trim() || slug,
    type: coerceType(input.type ?? "note"),
    description: (input.description ?? "").trim(),
    triggers: (input.triggers ?? []).map((t) => t.trim()).filter(Boolean),
    sources: (input.sources ?? []).map((s) => s.trim()).filter(Boolean),
    linkedNodes: (input.linkedNodes ?? [])
      .map((l) => safeSlug(l))
      .filter(Boolean),
    lastUpdated: new Date().toISOString(),
    body: input.body.trim(),
  };

  fs.mkdirSync(NODES_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(NODES_DIR, `${slug}.md`),
    serializeNode(node),
    "utf8"
  );
  return node;
}

export function deleteOrgBrainNode(slug: string): boolean {
  const safe = safeSlug(slug);
  const file = path.join(NODES_DIR, `${safe}.md`);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function serializeNode(node: OrgBrainNode): string {
  return `---
slug: ${node.slug}
label: ${node.label}
type: ${node.type}
description: ${node.description}
triggers: [${node.triggers.join(", ")}]
sources: [${node.sources.join(", ")}]
linked_nodes: [${node.linkedNodes.join(", ")}]
last_updated: ${node.lastUpdated}
---

${node.body.replace(/\s+$/, "")}
`;
}

// ─── Recall (matches the org-skills scoring approach) ─────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "you", "are", "was", "were",
  "what", "how", "who", "why", "when", "from", "can", "our", "your",
  "של", "על", "עם", "את", "זה", "מה", "איך", "מי", "למה", "מתי",
]);

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return new Set(tokens.filter((t) => !STOPWORDS.has(t)));
}

function scoreNode(node: OrgBrainNode, question: string): number {
  const queryTokens = tokenize(question);
  if (queryTokens.size === 0) return 0;

  let score = 0;
  const haystack = tokenize(
    [node.slug, node.label, node.description, node.triggers.join(" ")]
      .join(" ")
      .toLowerCase()
  );
  for (const token of queryTokens) {
    if (haystack.has(token)) score += 1;
  }
  // Trigger phrase substring match — heaviest signal.
  for (const trigger of node.triggers) {
    if (trigger && question.toLowerCase().includes(trigger.toLowerCase())) {
      score += 3;
    }
  }
  // Label phrase match — strong signal.
  if (
    node.label.length >= 4 &&
    question.toLowerCase().includes(node.label.toLowerCase())
  ) {
    score += 2;
  }
  return score;
}

export function selectOrgBrainNodesForRun(
  question: string,
  limit = DEFAULT_LIMIT
): OrgBrainHit[] {
  const all = listOrgBrainNodes();
  if (all.length === 0) return [];

  const scored = all
    .map((node) => ({ node, score: scoreNode(node, question) }))
    .sort((a, b) => b.score - a.score);

  const relevant = scored.filter((hit) => hit.score > 0);
  if (relevant.length === 0) return [];
  return relevant.slice(0, limit);
}

export function formatOrgBrainBlock(hits: OrgBrainHit[]): string {
  if (hits.length === 0) return "";

  const items = hits
    .map(({ node }) => {
      const meta = [
        node.type ? `type: ${node.type}` : "",
        node.sources.length ? `sources: ${node.sources.join(", ")}` : "",
        node.lastUpdated ? `updated: ${node.lastUpdated.slice(0, 10)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `## ${node.label} \`[[${node.slug}]]\`
${meta ? `_${meta}_\n` : ""}
${node.body}`;
    })
    .join("\n\n---\n\n");

  return `# Relevant company knowledge (Org Brain)

These are organization-wide facts and documents — shared across every twin in
the company. Treat them as ground truth about the company itself (decisions,
policies, customers, incidents, products). They do NOT override your personal
profile, hard boundaries, or the user's direction.

${items}`;
}
