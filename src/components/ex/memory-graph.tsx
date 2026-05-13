"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";
import { PROFILE_FILES, type ProfileFile } from "@/lib/ex-profile-files";
import { getEdges } from "@/lib/profile-graph";

export type GraphState = {
  reading: Set<string>;
  recently_touched: Set<string>;
  cited: Set<string>;
};

type NodeData = {
  file: ProfileFile;
  reading: boolean;
  recently_touched: boolean;
  cited: boolean;
  dimmed: boolean;
  highlighted: boolean;
};

const CONFIDENCE_BUCKETS: { max: number; bg: string; border: string }[] = [
  { max: 0.6, bg: "color-mix(in oklch, var(--danger) 14%, var(--surface))", border: "color-mix(in oklch, var(--danger) 32%, var(--hairline-strong))" },
  { max: 0.7, bg: "color-mix(in oklch, var(--warn) 14%, var(--surface))", border: "color-mix(in oklch, var(--warn) 30%, var(--hairline-strong))" },
  { max: 0.8, bg: "var(--accent-soft)", border: "color-mix(in oklch, var(--accent) 35%, var(--hairline-strong))" },
  { max: 0.9, bg: "color-mix(in oklch, var(--success) 14%, var(--surface))", border: "color-mix(in oklch, var(--success) 30%, var(--hairline-strong))" },
  { max: 1.01, bg: "color-mix(in oklch, var(--success) 24%, var(--surface))", border: "color-mix(in oklch, var(--success) 45%, var(--hairline-strong))" },
];

function bucketFor(confidence: number) {
  for (const b of CONFIDENCE_BUCKETS) if (confidence < b.max) return b;
  return CONFIDENCE_BUCKETS[CONFIDENCE_BUCKETS.length - 1];
}

function nodeWidth(file: ProfileFile): number {
  const tokens = file.tokens || 800;
  return Math.min(200, Math.max(120, tokens / 30));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function FileNode({ data }: NodeProps<NodeData>) {
  const { file, reading, recently_touched, cited, dimmed, highlighted } = data;
  const confidence = file.frontmatter?.confidence ?? 0.85;
  const bucket = bucketFor(confidence);
  const width = nodeWidth(file);

  let borderColor = bucket.border;
  let borderWidth = 1;
  if (cited) {
    borderColor = "var(--accent)";
    borderWidth = 2;
  }
  if (highlighted) {
    borderColor = "var(--accent-deep)";
    borderWidth = 2;
  }

  const boxShadow = recently_touched
    ? "0 0 0 4px color-mix(in oklch, var(--accent) 18%, transparent), var(--shadow-sm)"
    : reading
    ? "0 0 0 4px color-mix(in oklch, var(--twin) 22%, transparent), var(--shadow-sm)"
    : "var(--shadow-sm)";

  return (
    <div
      className={reading ? "pulse" : ""}
      style={{
        width,
        background: bucket.bg,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 6,
        padding: "7px 9px",
        opacity: dimmed ? 0.3 : 1,
        transition: "opacity .18s, box-shadow .2s, border-color .2s",
        boxShadow,
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <div
        className="mono"
        style={{
          fontSize: "var(--fs-meta)",
          fontWeight: 600,
          color: "var(--text)",
          letterSpacing: "-0.01em",
          lineHeight: 1.2,
        }}
      >
        {file.name}
      </div>
      <div
        style={{
          fontSize: "var(--fs-xs)",
          color: "var(--text-muted)",
          marginTop: 3,
          lineHeight: 1.3,
        }}
      >
        {truncate(file.desc, 28)}
      </div>
      <div
        className="mono"
        style={{
          fontSize: "var(--fs-2xs)",
          color: "var(--text-subtle)",
          marginTop: 4,
          fontWeight: 500,
        }}
      >
        {(file.tokens || 0).toLocaleString()} tok
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

const nodeTypes = { file: FileNode };

/**
 * Compute a stable radial layout based on degree (most-connected in center).
 * Ring 0: center. Ring 1: high-degree. Ring 2: low-degree.
 */
function computeLayout(files: ProfileFile[], edges: { from: string; to: string }[]): Record<string, { x: number; y: number }> {
  const degree = new Map<string, number>();
  for (const f of files) degree.set(f.name, 0);
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const sorted = [...files].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0));

  const cx = 420;
  const cy = 320;
  const positions: Record<string, { x: number; y: number }> = {};

  // 1 in the center, 5 in inner ring, rest in outer ring.
  const innerCount = Math.min(5, Math.max(0, sorted.length - 1 - 6));
  const innerRingSize = innerCount > 0 ? innerCount : 4;
  const outerRingSize = sorted.length - 1 - innerRingSize;

  positions[sorted[0].name] = { x: cx, y: cy };

  const innerR = 170;
  const outerR = 300;

  for (let i = 0; i < innerRingSize; i++) {
    const f = sorted[1 + i];
    if (!f) break;
    const angle = (i / innerRingSize) * Math.PI * 2 - Math.PI / 2;
    positions[f.name] = {
      x: cx + Math.cos(angle) * innerR,
      y: cy + Math.sin(angle) * innerR,
    };
  }

  for (let i = 0; i < outerRingSize; i++) {
    const f = sorted[1 + innerRingSize + i];
    if (!f) break;
    const angle = (i / outerRingSize) * Math.PI * 2 - Math.PI / 2 + Math.PI / outerRingSize;
    positions[f.name] = {
      x: cx + Math.cos(angle) * outerR,
      y: cy + Math.sin(angle) * outerR,
    };
  }

  return positions;
}

type Props = {
  state: GraphState;
  onOpenFile: (name: string) => void;
};

export function MemoryGraph({ state, onOpenFile }: Props) {
  const layout = useMemo(() => computeLayout(PROFILE_FILES, getEdges()), []);
  const baseEdges = useMemo(() => getEdges(), []);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const initialNodes: Node<NodeData>[] = useMemo(
    () =>
      PROFILE_FILES.map((file) => {
        const pos = layout[file.name] ?? { x: 0, y: 0 };
        const w = nodeWidth(file);
        return {
          id: file.name,
          type: "file",
          position: { x: pos.x - w / 2, y: pos.y - 24 },
          data: {
            file,
            reading: false,
            recently_touched: false,
            cited: false,
            dimmed: false,
            highlighted: false,
          },
          draggable: true,
        };
      }),
    [layout]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      baseEdges.map((e, i) => ({
        id: `e-${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        animated: false,
        style: { stroke: "var(--hairline-strong)", strokeWidth: 1 },
      })),
    [baseEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync trace state -> nodes
  useEffect(() => {
    setNodes((curr) =>
      curr.map((n) => {
        const reading = state.reading.has(n.id);
        const recently_touched = state.recently_touched.has(n.id);
        const cited = state.cited.has(n.id);
        return {
          ...n,
          data: {
            ...n.data,
            reading,
            recently_touched,
            cited,
          },
        };
      })
    );
  }, [state.reading, state.recently_touched, state.cited, setNodes]);

  // Hover-based dimming + edge animation based on reading state
  useEffect(() => {
    const neighbors = new Set<string>();
    if (hoveredNode) {
      neighbors.add(hoveredNode);
      for (const e of baseEdges) {
        if (e.from === hoveredNode) neighbors.add(e.to);
        if (e.to === hoveredNode) neighbors.add(e.from);
      }
    }

    setNodes((curr) =>
      curr.map((n) => ({
        ...n,
        data: {
          ...n.data,
          dimmed: hoveredNode != null && !neighbors.has(n.id),
          highlighted: hoveredNode === n.id,
        },
      }))
    );

    setEdges((curr) =>
      curr.map((edge) => {
        const touchingHover =
          hoveredNode != null && (edge.source === hoveredNode || edge.target === hoveredNode);
        const bothReading =
          state.reading.has(edge.source) && state.reading.has(edge.target);
        const oneReading =
          state.reading.has(edge.source) || state.reading.has(edge.target);
        const oneTouched =
          state.recently_touched.has(edge.source) || state.recently_touched.has(edge.target);
        const cited =
          state.cited.has(edge.source) && state.cited.has(edge.target);

        let stroke = "var(--hairline-strong)";
        let strokeWidth = 1;
        let animated = false;

        if (bothReading) {
          stroke = "var(--accent)";
          strokeWidth = 1.5;
          animated = true;
        } else if (oneReading || oneTouched) {
          stroke = "var(--accent)";
          strokeWidth = 1.25;
          animated = true;
        } else if (cited) {
          stroke = "var(--accent-deep)";
          strokeWidth = 1.5;
        } else if (touchingHover) {
          stroke = "var(--text-muted)";
          strokeWidth = 1.25;
        }

        const dimmed =
          hoveredNode != null && !touchingHover ? 0.25 : 1;

        return {
          ...edge,
          animated,
          style: { stroke, strokeWidth, opacity: dimmed },
        };
      })
    );
  }, [hoveredNode, state.reading, state.recently_touched, state.cited, baseEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      onOpenFile(node.id);
    },
    [onOpenFile]
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_evt, node) => {
    setHoveredNode(node.id);
  }, []);

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setHoveredNode(null);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.4}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      panOnDrag
      zoomOnScroll
      style={{ background: "var(--bg)" }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="var(--hairline)"
      />
    </ReactFlow>
  );
}
