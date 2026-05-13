// Org Brain graph — Obsidian-style cross-references between brain nodes,
// employee profile clusters, AND each employee's working memory (scratch
// files + recent twin-memory cards). The CEO sees the whole brain in one
// view: long-term knowledge (brain), identity (profiles), and short-term
// memory (yellow sticky notes).
//
// Returns the same shape as profile-graph-real.ts (`EmployeeGraph`) so the
// existing `obsidian-graph.tsx` component can render it without changes.
// The 3D renderer reads `tags[0]` to colorize node "kind" — special values:
//   - "brain"   → type-coded color
//   - "employee" → warm gold
//   - "scratch" → sticky-note yellow (working memory written by the twin)
//   - "memory"  → sticky-note yellow (recent twin-memory cards)

import fs from "fs";
import path from "path";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
import { readAllEmployeeFiles } from "@/lib/employees-files";
import { listOrgBrainNodes } from "@/lib/org-brain";
import type { EmployeeGraph, RealEdge, RealNode } from "@/lib/profile-graph-real";

/** Cap recent memory cards per employee — keeps the graph readable when an
 *  employee has thousands of cards on disk. The graph models *working*
 *  memory, not the full archive. */
const MEMORY_CARDS_PER_EMPLOYEE = 12;

const WIKILINK_RE = /\[\[([a-zA-Z0-9_-]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) out.add(m[1]);
  return Array.from(out);
}

function estimateTokens(body: string): number {
  return Math.round(body.length / 4);
}

/**
 * Build the org-wide brain graph.
 *
 * Nodes:
 *   - Each brain node → name = `brain:<slug>`, tags include the type.
 *   - Each employee → name = `emp:<id>`, tags = ["employee"].
 *
 * Edges:
 *   - brain ↔ brain: from `linkedNodes` and body wikilinks.
 *   - employee → brain: when an employee profile file body contains a
 *     wikilink to a brain slug.
 */
export function buildOrgBrainGraph(): EmployeeGraph {
  const brainNodes = listOrgBrainNodes();
  const brainSlugs = new Set(brainNodes.map((n) => n.slug));

  const nodes: RealNode[] = [];
  const edges: RealEdge[] = [];
  const seenEdge = new Set<string>();

  // ─── brain nodes ─────────────────────────────────────────────────────
  for (const node of brainNodes) {
    const linksFromBody = extractWikilinks(node.body);
    const linkedFiles = Array.from(
      new Set([...node.linkedNodes, ...linksFromBody])
    );
    nodes.push({
      name: `brain:${node.slug}`,
      tokens: estimateTokens(node.body),
      confidence: 0.9,
      lastUpdated: node.lastUpdated,
      sources: node.sources,
      linkedFiles: linkedFiles.map((l) => `brain:${l}`),
      tags: [node.type, "brain", ...node.triggers.slice(0, 3)],
    });
  }

  // brain ↔ brain edges
  for (const node of brainNodes) {
    const targets = new Set([
      ...node.linkedNodes,
      ...extractWikilinks(node.body),
    ]);
    for (const target of targets) {
      if (target === node.slug) continue;
      if (!brainSlugs.has(target)) continue;
      const a = `brain:${node.slug}`;
      const b = `brain:${target}`;
      const key = a < b ? `${a}→${b}` : `${b}→${a}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      const reverseHas = brainNodes
        .find((m) => m.slug === target)
        ?.linkedNodes.includes(node.slug) ?? false;
      edges.push({ from: a, to: b, bidirectional: reverseHas });
    }
  }

  // ─── employee profile clusters ──────────────────────────────────────
  for (const emp of EMPLOYEES_WITH_TWIN) {
    const empName = `emp:${emp.id}`;
    const files = (() => {
      try {
        return readAllEmployeeFiles(emp.id);
      } catch {
        return {};
      }
    })();

    // Find every brain wikilink across this employee's profile body.
    const brainTargets = new Set<string>();
    for (const raw of Object.values(files)) {
      for (const link of extractWikilinks(raw)) {
        if (brainSlugs.has(link)) brainTargets.add(link);
      }
    }

    // Only include employees who actually link into brain — keeps the
    // graph from getting cluttered with disconnected employee nodes.
    if (brainTargets.size === 0) continue;

    nodes.push({
      name: empName,
      tokens: 0,
      confidence: 1,
      lastUpdated: "",
      sources: [emp.role ?? ""],
      linkedFiles: Array.from(brainTargets).map((s) => `brain:${s}`),
      tags: ["employee", emp.role ?? "person"],
    });

    for (const slug of brainTargets) {
      const a = empName;
      const b = `brain:${slug}`;
      const key = a < b ? `${a}→${b}` : `${b}→${a}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ from: a, to: b, bidirectional: false });
    }
  }

  // ─── Working memory (yellow sticky notes) ──────────────────────────
  // For every employee — even those with no brain links — surface their
  // scratch files and recent twin-memory cards as yellow nodes attached
  // to a (possibly synthetic) employee node. This is the agent's
  // short-term memory drawer made visible.
  for (const emp of EMPLOYEES_WITH_TWIN) {
    const empName = `emp:${emp.id}`;
    const scratchFiles = readScratchFiles(emp.id);
    const memoryCards = readRecentMemoryCards(emp.id, MEMORY_CARDS_PER_EMPLOYEE);

    if (scratchFiles.length === 0 && memoryCards.length === 0) continue;

    // Ensure the employee node exists (might not, if no brain links).
    const hasEmployeeNode = nodes.some((n) => n.name === empName);
    if (!hasEmployeeNode) {
      nodes.push({
        name: empName,
        tokens: 0,
        confidence: 1,
        lastUpdated: "",
        sources: [emp.role ?? ""],
        linkedFiles: [],
        tags: ["employee", emp.role ?? "person"],
      });
    }

    // Scratch files — yellow nodes, larger than memory cards.
    for (const sf of scratchFiles) {
      const nodeName = `scratch:${emp.id}:${sf.filename}`;
      nodes.push({
        name: nodeName,
        tokens: estimateTokens(sf.body),
        confidence: 0.85,
        lastUpdated: sf.mtime,
        sources: ["scratch"],
        linkedFiles: [],
        // tags[0] drives the renderer color → "scratch" = yellow.
        tags: ["scratch", sf.filename, "working-memory"],
      });
      const key = `${empName}→${nodeName}`;
      if (!seenEdge.has(key)) {
        seenEdge.add(key);
        edges.push({ from: empName, to: nodeName, bidirectional: false });
      }
    }

    // Memory cards — small yellow nodes, capped at MEMORY_CARDS_PER_EMPLOYEE.
    for (const card of memoryCards) {
      const nodeName = `memory:${emp.id}:${card.id}`;
      nodes.push({
        name: nodeName,
        tokens: Math.max(20, Math.round((card.preview ?? "").length / 4)),
        confidence: 0.7,
        lastUpdated: card.createdAt,
        sources: ["memory"],
        linkedFiles: [],
        tags: ["memory", card.preview ?? "recall", "short-term"],
      });
      const key = `${empName}→${nodeName}`;
      if (!seenEdge.has(key)) {
        seenEdge.add(key);
        edges.push({ from: empName, to: nodeName, bidirectional: false });
      }
    }
  }

  return { nodes, edges };
}

/** Read all .md files in data/scratch/<employeeId>/ — sorted newest-first. */
type ScratchFile = { filename: string; body: string; mtime: string };
function readScratchFiles(employeeId: string): ScratchFile[] {
  const dir = path.join(process.cwd(), "data", "scratch", employeeId);
  try {
    if (!fs.existsSync(dir)) return [];
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"));
    const out: ScratchFile[] = [];
    for (const e of entries) {
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

/** Read the last N memory cards from data/memory/<employeeId>/cards.jsonl.
 *  We only pull the tail to keep the graph readable — working memory is
 *  recent recall, not the full archive. */
type MemoryCardLite = {
  id: string;
  preview: string;
  createdAt: string;
};
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
    // Walk from the tail so we capture the most recent.
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const card = JSON.parse(lines[i]) as {
          id?: string;
          question?: string;
          answerPreview?: string;
          createdAt?: string;
        };
        const id = card.id ?? `c-${i}`;
        const preview = (card.question ?? card.answerPreview ?? "").slice(0, 80);
        if (!preview) continue;
        out.push({
          id,
          preview,
          createdAt: card.createdAt ?? "",
        });
      } catch {
        /* skip malformed line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Stats for UI summaries — not used in render, but useful for badges. */
export function brainGraphStats(): {
  brainNodeCount: number;
  edgeCount: number;
  employeesLinkedIn: number;
  orphanBrainNodes: number;
} {
  const graph = buildOrgBrainGraph();
  const brainCount = graph.nodes.filter((n) => n.name.startsWith("brain:")).length;
  const empCount = graph.nodes.filter((n) => n.name.startsWith("emp:")).length;

  const connected = new Set<string>();
  for (const e of graph.edges) {
    connected.add(e.from);
    connected.add(e.to);
  }
  const orphans = graph.nodes
    .filter((n) => n.name.startsWith("brain:"))
    .filter((n) => !connected.has(n.name)).length;

  return {
    brainNodeCount: brainCount,
    edgeCount: graph.edges.length,
    employeesLinkedIn: empCount,
    orphanBrainNodes: orphans,
  };
}
