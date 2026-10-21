// The organization as one brain graph, in the same shape as a twin's
// (EmployeeGraph), so BrainCosmos can render it unchanged: the company is the
// hub, every ready twin is a region, and the shared tools (company brain, web,
// enabled custom MCP servers) are nodes too. Twins are wired to the company,
// and to each other where one's PEOPLE.md names the other.

import fs from "fs";
import path from "path";
import type { EmployeeGraph, RealEdge, RealNode } from "@/lib/profile-graph-real";

export type OrgGraphTwin = { id: string; firstName: string; role: string; dir: string };

export type OrgGraphNodeRef =
  | { kind: "company" }
  | { kind: "twin"; id: string }
  | { kind: "tool"; key: string };

export type OrgGraph = EmployeeGraph & {
  /** Node name → what it stands for (twin id, tool key). */
  refs: Record<string, OrgGraphNodeRef>;
};

/** Lower-case alphanumerics: how tool calls are matched to tool nodes. */
export function toolKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const node = (name: string, tags: string[], tokens: number, linkedFiles: string[] = []): RealNode => ({
  name,
  tokens,
  confidence: 1,
  lastUpdated: new Date(0).toISOString(),
  sources: [],
  linkedFiles,
  tags,
});

export function buildOrgGraph(orgName: string, twins: OrgGraphTwin[], tools: string[]): OrgGraph {
  const refs: OrgGraph["refs"] = {};
  const nodes: RealNode[] = [];
  const edges: RealEdge[] = [];
  const hub = orgName.trim() || "Company";
  refs[hub] = { kind: "company" };

  // Unique, readable names for twins (first name; add the role on a clash).
  const taken = new Set<string>([hub]);
  const nameOf = new Map<string, string>();
  for (const t of twins) {
    let n = t.firstName;
    if (taken.has(n)) n = `${t.firstName} (${t.role})`;
    taken.add(n);
    nameOf.set(t.id, n);
    refs[n] = { kind: "twin", id: t.id };
  }

  for (const t of twins) {
    const name = nameOf.get(t.id)!;
    let people = "";
    try {
      people = fs.readFileSync(path.join(t.dir, "PEOPLE.md"), "utf8");
    } catch {
      // no PEOPLE.md: only wired to the company
    }
    const peers = twins.filter((o) => o.id !== t.id && new RegExp(`\\b${o.firstName}\\b`, "i").test(people)).map((o) => nameOf.get(o.id)!);
    nodes.push(node(name, ["twin", t.role], 4000, peers));
    edges.push({ from: hub, to: name, bidirectional: true });
    for (const p of peers) {
      if (!edges.some((e) => (e.from === p && e.to === name) || (e.from === name && e.to === p))) {
        edges.push({ from: name, to: p, bidirectional: true });
      }
    }
  }

  for (const tool of tools) {
    if (taken.has(tool)) continue;
    taken.add(tool);
    refs[tool] = { kind: "tool", key: toolKey(tool) };
    nodes.push(node(tool, ["tool"], 1500));
    edges.push({ from: hub, to: tool, bidirectional: true });
  }

  // The hub is the most connected node, which is how BrainCosmos picks it.
  nodes.unshift(node(hub, ["company"], 9000, nodes.map((n) => n.name)));
  return { nodes, edges, refs };
}
