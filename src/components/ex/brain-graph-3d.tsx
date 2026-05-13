"use client";

import { useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import type { EmployeeGraph } from "@/lib/profile-graph-real";

// react-force-graph-3d uses three.js + WebGL — must be client-only.
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

type Node3D = {
  id: string;
  label: string;
  type: string;
  kind: "brain" | "employee" | "scratch" | "memory";
  size: number;
  color: string;
  raw: {
    tokens: number;
    sources: string[];
    tags: string[];
  };
};

type Link3D = {
  source: string;
  target: string;
  bidirectional: boolean;
};

type Graph3D = {
  nodes: Node3D[];
  links: Link3D[];
};

const TYPE_COLORS: Record<string, string> = {
  document: "#5f82d2",
  decision: "#b46ec8",
  incident: "#dc5a50",
  policy: "#dca050",
  customer: "#6eb482",
  product: "#50aac8",
  process: "#b4b4b4",
  note: "#969696",
  employee: "#e8c87a",
  scratch: "#fde36b", // sticky-note yellow — agent's working memory
  memory: "#fde36b",  // same yellow for recent twin-memory cards
};

function colorFor(kind: string, type: string): string {
  if (kind === "employee") return TYPE_COLORS.employee;
  if (kind === "scratch" || kind === "memory") return TYPE_COLORS.scratch;
  return TYPE_COLORS[type] ?? TYPE_COLORS.note;
}

function buildGraph3D(graph: EmployeeGraph): Graph3D {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  const nodes: Node3D[] = graph.nodes.map((node) => {
    const isBrain = node.name.startsWith("brain:");
    const isEmployee = node.name.startsWith("emp:");
    const isScratch = node.name.startsWith("scratch:");
    const isMemory = node.name.startsWith("memory:");
    const kind: "brain" | "employee" | "scratch" | "memory" = isScratch
      ? "scratch"
      : isMemory
      ? "memory"
      : isEmployee
      ? "employee"
      : "brain";

    let label: string;
    if (isBrain) {
      label = node.name.replace(/^brain:/, "");
    } else if (isEmployee) {
      label = node.name.replace(/^emp:/, "");
    } else if (isScratch) {
      // scratch:<empId>:<filename> → just show filename without extension
      label = (node.name.split(":")[2] ?? node.name).replace(/\.md$/, "");
    } else if (isMemory) {
      // tags[1] is the preview text for memory cards.
      label = node.tags?.[1] ?? "memory";
    } else {
      label = node.name;
    }

    const type = node.tags?.[0] ?? "note";
    const deg = degree.get(node.name) ?? 0;

    // Sizing — sticky notes are smaller than brain/employee nodes.
    let size: number;
    if (isMemory) {
      size = 3 + Math.min((node.tokens ?? 0) / 300, 2.5);
    } else if (isScratch) {
      size = 5 + Math.min((node.tokens ?? 0) / 200, 4);
    } else {
      const baseSize = 4 + Math.min(node.tokens / 200, 8);
      size = baseSize + Math.min(deg * 1.5, 6);
    }

    return {
      id: node.name,
      label,
      type,
      kind,
      size,
      color: colorFor(kind, type),
      raw: {
        tokens: node.tokens,
        sources: node.sources,
        tags: node.tags,
      },
    };
  });

  const links: Link3D[] = graph.edges.map((e) => ({
    source: e.from,
    target: e.to,
    bidirectional: e.bidirectional,
  }));

  return { nodes, links };
}

type Props = {
  graph: EmployeeGraph | null;
  loading?: boolean;
  width: number;
  height: number;
  onNodeClick?: (id: string, kind: "brain" | "employee") => void;
};

export function BrainGraph3D({
  graph,
  loading,
  width,
  height,
  onNodeClick,
}: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  const data = useMemo(() => {
    if (!graph) return { nodes: [], links: [] } as Graph3D;
    return buildGraph3D(graph);
  }, [graph]);

  // Auto-zoom to fit once data is in.
  useEffect(() => {
    if (!fgRef.current || data.nodes.length === 0) return;
    const t = setTimeout(() => {
      try {
        fgRef.current?.zoomToFit?.(800, 60);
      } catch {
        /* noop */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [data]);

  if (loading) {
    return (
      <div
        style={{
          width,
          height,
          display: "grid",
          placeItems: "center",
          color: "var(--text-subtle)",
          fontSize: 12,
        }}
      >
        Loading graph…
      </div>
    );
  }
  if (data.nodes.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: "grid",
          placeItems: "center",
          color: "var(--text-subtle)",
          fontSize: 12,
        }}
      >
        No nodes yet — create some brain content first.
      </div>
    );
  }

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeLabel={(node: any) =>
        `<div style="background: rgba(20,20,20,0.92); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-family: -apple-system, sans-serif; max-width: 260px;">
          <div style="font-weight: 600; margin-bottom: 2px;">${escapeHtml(node.label)}</div>
          <div style="opacity: 0.7; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;">${escapeHtml(node.kind)} · ${escapeHtml(node.type)}</div>
        </div>`
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeThreeObject={(node: any) => {
        const isSticky = node.kind === "scratch" || node.kind === "memory";
        const emissiveIntensity =
          node.kind === "scratch"
            ? 0.7
            : node.kind === "memory"
            ? 0.55
            : node.kind === "employee"
            ? 0.45
            : 0.25;

        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(node.size, 24, 24),
          new THREE.MeshStandardMaterial({
            color: node.color,
            emissive: new THREE.Color(node.color),
            emissiveIntensity,
            roughness: isSticky ? 0.4 : 0.55,
            metalness: 0.15,
          })
        );

        // Only label brain + employee + scratch nodes — labelling all 1000+
        // memory cards would clutter the canvas to unreadable.
        if (node.kind !== "memory") {
          const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: createLabelTexture(
                node.label,
                node.kind === "employee" || node.kind === "scratch"
              ),
              transparent: true,
              depthWrite: false,
            })
          );
          sprite.scale.set(node.size * 4.5, node.size * 1.4, 1);
          sprite.position.set(0, node.size + 4, 0);
          sphere.add(sprite);
        }

        return sphere;
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkColor={(link: any) =>
        link.bidirectional ? "rgba(232, 200, 122, 0.6)" : "rgba(180, 180, 180, 0.35)"
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkWidth={(link: any) => (link.bidirectional ? 1.4 : 0.8)}
      linkDirectionalParticles={2}
      linkDirectionalParticleSpeed={0.005}
      linkDirectionalParticleWidth={1.6}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkDirectionalParticleColor={(link: any) =>
        link.bidirectional ? "#e8c87a" : "#9c9c9c"
      }
      enableNodeDrag={true}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onNodeClick={(node: any) => {
        if (onNodeClick) onNodeClick(node.id, node.kind);
      }}
      cooldownTicks={140}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createLabelTexture(text: string, bright: boolean): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bright ? "#ffe9b0" : "#dcdcdc";
  ctx.font = bright
    ? "600 44px -apple-system, BlinkMacSystemFont, sans-serif"
    : "500 38px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 8;
  // Truncate long labels.
  const display = text.length > 28 ? text.slice(0, 26) + "…" : text;
  ctx.fillText(display, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
