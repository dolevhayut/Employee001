"use client";

// Flow Canvas: the twin's run drawn like an n8n workflow around the orb.
// The orb in the middle is the agent node. A Question node feeds it from the
// left and an Answer node takes its output on the right. Every source the
// twin reaches for appears as a node above or below the orb, wired to it;
// MCP servers fan out into the tools pulled through them ("CompanySim" →
// get person, search tickets). Wires are dashed with dots flowing along them.
// The flowing-dot wires follow 21st.dev's "AI Agent Pipeline" (SVG
// animateMotion); the node look follows n8n. When the answer card opens, a
// wave runs out from it and gently pushes the nodes clear of it, nearest
// first.
//
// Drawn with React Flow in a fixed 1:1 view (no pan, zoom, drag or
// selection), laid out in the stage's own pixels so the agent node sits
// exactly under MorphOrb's orb. Every node has real handles on its edges and
// every wire is an edge between two handles, so wires always land on the
// boxes. Handles sit outside the parts that scale in, so React Flow measures
// them where they end up.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, type AnimationPlaybackControls } from "framer-motion";
import {
  ReactFlow,
  Handle,
  Position,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { Icons } from "@/components/ex/icons";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import type { ToolNodeStep } from "@/components/ex/morph-orb/tool-nodes";

export type FlowStep = ToolNodeStep & { done?: boolean };

type Group = {
  key: string;
  kind: FlowStep["kind"];
  label: string;
  logo?: string;
  /** Distinct things done through this source (tools, files), in order. */
  items: { name: string; lastId: number; done: boolean }[];
  lastId: number;
  done: boolean;
};

const ORB_R = 104; // radius of the orb's ring, px
const CENTER_Y = 0.46; // the orb sits at 46% of the stage height
const NODE = 54;
const MAX_ITEMS = 3;
const MAX_GROUPS = 6;
/** Gap between a source node and the near edge of the chips it fans out to. */
const LEAF_GAP = 56;
const LEAF_H = 30;
const LEAF_STEP = 44;
const EASE = [0.23, 1, 0.32, 1] as const;
/** The push: a soft spring with a little overshoot, like a wave lifting it. */
const PUSH = { type: "spring" as const, stiffness: 170, damping: 15, mass: 0.9 };
/** Seconds per pixel of distance from the card: the wave's travel time. */
const WAVE_SPEED = 0.0011;
const CARD_MARGIN = 26;

type Rect = { l: number; t: number; r: number; b: number };
type XY = { x: number; y: number };
type Target = XY & { delay: number };

/** The icon inside a pulled item's chip: a file, a tool call, a search… */
const LEAF_ICON: Record<FlowStep["kind"], (s: number) => ReactNode> = {
  read: (s) => <Icons.Doc size={s} />,
  brain: (s) => <Icons.Doc size={s} />,
  search: (s) => <Icons.Search size={s} />,
  tool: (s) => <Icons.Zap size={s} />,
  web: (s) => <Icons.Eye size={s} />,
  skill: (s) => <Icons.Spark size={s} />,
  delegate: (s) => <Icons.Team size={s} />,
  blocked: (s) => <Icons.Lock size={s} />,
};

const KIND_ICON: Record<FlowStep["kind"], (s: number) => ReactNode> = {
  read: (s) => <Icons.Doc size={s} />,
  search: (s) => <Icons.Search size={s} />,
  tool: (s) => <Icons.Plug size={s} />,
  web: (s) => <Icons.Eye size={s} />,
  brain: (s) => <Icons.Database size={s} />,
  skill: (s) => <Icons.Spark size={s} />,
  delegate: (s) => <Icons.Team size={s} />,
  blocked: (s) => <Icons.Lock size={s} />,
};

function groupSteps(steps: FlowStep[]): Group[] {
  const map = new Map<string, Group>();
  for (const st of steps) {
    const key = st.logo ?? `${st.kind}:${st.label}`;
    const g = map.get(key) ?? { key, kind: st.kind, label: st.label, logo: st.logo, items: [], lastId: st.id, done: false };
    const name = (st.detail ?? "").trim();
    if (name) {
      const existing = g.items.find((i) => i.name === name);
      if (existing) {
        existing.lastId = st.id;
        existing.done = Boolean(st.done);
      } else g.items.push({ name, lastId: st.id, done: Boolean(st.done) });
    }
    g.lastId = st.id;
    g.done = Boolean(st.done);
    map.set(key, g);
  }
  return [...map.values()];
}

/** Slots around the orb: above and below, alternating, outward from the centre. */
function slot(i: number, w: number, h: number): { x: number; y: number; above: boolean } {
  const cx = w / 2;
  const cy = h * CENTER_Y;
  const above = i % 2 === 0;
  const k = Math.floor(i / 2); // 0,1,2… per row
  const spread = Math.min(290, (w - 2 * 230) / 2.2);
  const xs = [0, -spread, spread, -spread * 2, spread * 2];
  const x = cx + (xs[k] ?? (k % 2 ? -1 : 1) * spread * 2.6);
  const y = above ? cy - ORB_R - 150 : cy + ORB_R + 120;
  return { x, y, above };
}

/** Where slot i's wire leaves the orb: a point on its ring, leaning toward the slot. */
function port(i: number, w: number, h: number): XY & { above: boolean } {
  const s = slot(i, w, h);
  const dx = Math.max(-ORB_R * 0.7, Math.min(ORB_R * 0.7, (s.x - w / 2) * 0.35));
  const dy = Math.sqrt(ORB_R * ORB_R - dx * dx);
  return { x: ORB_R + dx, y: s.above ? ORB_R - dy : ORB_R + dy, above: s.above };
}

/** A cubic wire between two points, bending vertically (n8n style for sub-nodes). */
function wireV(x0: number, y0: number, x1: number, y1: number): string {
  const my = (y0 + y1) / 2;
  return `M ${x0},${y0} C ${x0},${my} ${x1},${my} ${x1},${y1}`;
}
function wireH(x0: number, y0: number, x1: number, y1: number): string {
  const mx = (x0 + x1) / 2;
  return `M ${x0},${y0} C ${mx},${y0} ${mx},${y1} ${x1},${y1}`;
}

/**
 * Node positions that spring to their targets (the wave's push), each after
 * its own delay. A node seen for the first time lands in place and pops in.
 */
function useSprung(targets: Record<string, Target>): Record<string, XY> {
  const [pos, setPos] = useState<Record<string, XY>>({});
  const live = useRef<Record<string, XY>>({});
  const goals = useRef<Record<string, XY>>({});
  const runs = useRef<Record<string, AnimationPlaybackControls[]>>({});
  const frame = useRef(0);

  useEffect(() => {
    const flush = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setPos({ ...live.current });
      });
    };
    for (const [id, t] of Object.entries(targets)) {
      const goal = goals.current[id];
      if (goal && goal.x === t.x && goal.y === t.y) continue;
      goals.current[id] = { x: t.x, y: t.y };
      runs.current[id]?.forEach((r) => r.stop());
      const from = live.current[id];
      if (!from) {
        live.current[id] = { x: t.x, y: t.y };
        continue;
      }
      runs.current[id] = (["x", "y"] as const).map((axis) =>
        animate(from[axis], t[axis], {
          ...PUSH,
          delay: t.delay,
          onUpdate: (v) => {
            live.current[id] = { ...live.current[id], [axis]: v };
            flush();
          },
        }),
      );
    }
    for (const id of Object.keys(goals.current)) {
      if (id in targets) continue;
      runs.current[id]?.forEach((r) => r.stop());
      delete runs.current[id];
      delete goals.current[id];
      delete live.current[id];
    }
    flush();
  }, [targets]);

  useEffect(() => {
    const all = runs.current;
    return () => {
      cancelAnimationFrame(frame.current);
      Object.values(all).forEach((rs) => rs.forEach((r) => r.stop()));
    };
  }, []);

  return pos;
}

/** A handle pinned to an exact point on its node: the wire ends right there. */
function Port({ type, id, position, x, y }: { type: "source" | "target"; id: string; position: Position; x: number; y: number }) {
  return (
    <Handle
      type={type}
      id={id}
      position={position}
      isConnectable={false}
      style={{ left: x, top: y, right: "auto", bottom: "auto", width: 2, height: 2, minWidth: 0, minHeight: 0, transform: "translate(-50%, -50%)", border: "none", background: "transparent", opacity: 0, pointerEvents: "none" }}
    />
  );
}

// ── nodes ───────────────────────────────────────────────────────────────

type AgentData = { ports: (XY & { above: boolean })[] };
type BoxData = {
  live: boolean;
  done: boolean;
  label: string;
  sub?: string;
  icon: ReactNode;
  delay: number;
  /** Where the label sits, and which edge faces the orb. */
  above?: boolean;
  /** "question" | "answer" | a source fanning its chips out to side -1 / 1. */
  role: "question" | "answer" | "source";
  side?: -1 | 1;
};
type LeafData = { name: string; kind: FlowStep["kind"]; on: boolean; done: boolean; side: -1 | 1 };

/** The orb itself is drawn by MorphOrb; this node only carries its handles. */
function AgentNode({ id, data }: NodeProps<AgentData>) {
  const update = useUpdateNodeInternals();
  const sig = data.ports.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("|");
  useEffect(() => update(id), [id, sig, update]);
  return (
    <div style={{ width: ORB_R * 2, height: ORB_R * 2 }}>
      <Port type="target" id="q" position={Position.Left} x={0} y={ORB_R} />
      <Port type="source" id="a" position={Position.Right} x={ORB_R * 2} y={ORB_R} />
      {data.ports.map((p, i) => (
        <Port key={i} type="source" id={`p${i}`} position={p.above ? Position.Top : Position.Bottom} x={p.x} y={p.y} />
      ))}
    </div>
  );
}

function BoxNode({ data }: NodeProps<BoxData>) {
  const { live, done, label, sub, icon, delay, above, role, side } = data;
  return (
    <div style={{ position: "relative", width: NODE, height: NODE }}>
      {role === "question" && <Port type="source" id="out" position={Position.Right} x={NODE} y={NODE / 2} />}
      {role === "answer" && <Port type="target" id="in" position={Position.Left} x={0} y={NODE / 2} />}
      {role === "source" && (
        <>
          <Port type="target" id="in" position={above ? Position.Bottom : Position.Top} x={NODE / 2} y={above ? NODE : 0} />
          <Port type="source" id="out" position={side === -1 ? Position.Left : Position.Right} x={side === -1 ? 0 : NODE} y={NODE / 2} />
        </>
      )}
      <motion.div
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 24, delay }}
        style={{ position: "absolute", inset: 0 }}
      >
        {live && (
          <motion.span
            animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
            style={{ position: "absolute", inset: 0, borderRadius: 14, border: "2px solid var(--accent)" }}
          />
        )}
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 14,
            display: "grid",
            placeItems: "center",
            background: "var(--surface)",
            color: "var(--accent-deep)",
            border: `1.5px solid ${live ? "var(--accent)" : done ? "color-mix(in oklab, var(--success) 70%, var(--hairline))" : "var(--hairline-strong)"}`,
            boxShadow: live ? "0 0 0 4px color-mix(in oklab, var(--accent) 14%, transparent), 0 10px 26px -12px var(--accent)" : "0 6px 18px -12px color-mix(in oklab, var(--text) 40%, transparent)",
            transition: "border-color .3s, box-shadow .3s",
          }}
        >
          {icon}
        </span>
        {done && !live && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--success)", color: "var(--bg)", border: "2px solid var(--bg)" }}
          >
            <Icons.Check size={10} />
          </motion.span>
        )}
        <span
          style={{
            position: "absolute",
            left: "50%",
            ...(above ? { bottom: `calc(100% + 7px)` } : { top: `calc(100% + 7px)` }),
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            lineHeight: 1.2,
            maxWidth: 150,
            textAlign: "center",
          }}
        >
          <span dir="auto" style={{ fontSize: 12.5, fontWeight: 650, color: "var(--text)", whiteSpace: "nowrap" }}>{label}</span>
          {sub && <span dir="auto" style={{ fontSize: 11, color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{sub}</span>}
        </span>
      </motion.div>
    </div>
  );
}

/** A pulled item: a 2px anchor at the chip's near edge; the chip runs away from its source. */
function LeafNode({ data }: NodeProps<LeafData>) {
  const { name, kind, on, done, side } = data;
  return (
    <div style={{ position: "relative", width: 2, height: LEAF_H }}>
      <Port type="target" id="in" position={side === 1 ? Position.Left : Position.Right} x={side === 1 ? 0 : 2} y={LEAF_H / 2} />
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        style={{
          position: "absolute",
          top: 0,
          ...(side === 1 ? { left: 0 } : { right: 0 }),
          transformOrigin: side === 1 ? "0 50%" : "100% 50%",
          boxSizing: "border-box",
          height: LEAF_H,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          maxWidth: 160,
          padding: "0 11px 0 9px",
          borderRadius: 9,
          fontSize: 11.5,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          whiteSpace: "nowrap",
          color: on ? "var(--text)" : "var(--text-muted)",
          background: "var(--surface)",
          border: `1px solid ${on ? "var(--accent)" : done ? "color-mix(in oklab, var(--success) 55%, var(--hairline))" : "var(--hairline)"}`,
          boxShadow: on ? "0 0 0 3px color-mix(in oklab, var(--accent) 14%, transparent)" : "none",
          transition: "border-color .3s, box-shadow .3s, color .3s",
        }}
      >
        <span style={{ display: "inline-flex", flexShrink: 0, color: on ? "var(--accent-deep)" : done ? "var(--success)" : "var(--text-subtle)", transition: "color .3s" }}>
          {LEAF_ICON[kind](13)}
        </span>
        <span dir="auto" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      </motion.div>
    </div>
  );
}

// ── edges ───────────────────────────────────────────────────────────────

type WireData = { live: boolean; done: boolean; delay: number };

function WireEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, data }: EdgeProps<WireData>) {
  const vertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
  const d = vertical ? wireV(sourceX, sourceY, targetX, targetY) : wireH(sourceX, sourceY, targetX, targetY);
  const live = Boolean(data?.live);
  const done = Boolean(data?.done);
  const mask = `mo-wire-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return (
    <>
      {/* the wire draws in under a solid mask, so it stays dashed while it does */}
      <mask id={mask} maskUnits="userSpaceOnUse" x={-1e4} y={-1e4} width={2e4} height={2e4}>
        <motion.path
          d={d}
          fill="none"
          stroke="#fff"
          strokeWidth={6}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, delay: data?.delay ?? 0, ease: EASE }}
        />
      </mask>
      <path
        d={d}
        mask={`url(#${mask})`}
        fill="none"
        stroke={done ? "var(--success)" : live ? "var(--accent)" : "var(--text)"}
        strokeOpacity={done ? 0.55 : live ? 0.7 : 0.18}
        strokeWidth={live ? 1.8 : 1.4}
        strokeDasharray="4 5"
        style={{ transition: "stroke .3s, stroke-opacity .3s" }}
      />
      {live &&
        [0, 0.5].map((b) => (
          <circle key={b} r={2.6} fill="var(--accent)">
            <animateMotion dur="1.4s" begin={`${b * 1.4}s`} repeatCount="indefinite" path={d} />
          </circle>
        ))}
    </>
  );
}

const nodeTypes = { agent: AgentNode, box: BoxNode, leaf: LeafNode };
const edgeTypes = { wire: WireEdge };
const NO_EVENTS = { pointerEvents: "none" } as const;

export function FlowCanvas({
  steps,
  visible,
  answered,
  questionLabel,
  answerLabel,
}: {
  steps: FlowStep[];
  visible: boolean;
  answered: boolean;
  questionLabel: string;
  answerLabel: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The answer card (MorphOrb's .mo-card) once it opens, in this box's
  // coordinates. Polled while the run is on screen: the card grows as it unfolds.
  const [card, setCard] = useState<Rect | null>(null);
  useEffect(() => {
    if (!visible || !answered) {
      const id = setTimeout(() => setCard(null), 0);
      return () => clearTimeout(id);
    }
    const read = () => {
      const box = boxRef.current;
      const root = box?.closest(".mo-root");
      const el = root?.querySelector(".mo-card");
      const phase = root?.getAttribute("data-phase");
      if (!box || !el || (phase !== "unfold" && phase !== "answered")) return;
      const b = box.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      if (c.width < 200) return; // still the pill
      const next = { l: c.left - b.left, t: c.top - b.top, r: c.right - b.left, b: c.bottom - b.top };
      setCard((prev) =>
        prev && Math.abs(prev.l - next.l) < 4 && Math.abs(prev.t - next.t) < 4 && Math.abs(prev.r - next.r) < 4 && Math.abs(prev.b - next.b) < 4 ? prev : next,
      );
    };
    const iv = setInterval(read, 120);
    read();
    return () => clearInterval(iv);
  }, [visible, answered]);

  const groups = useMemo(() => groupSteps(steps).slice(0, MAX_GROUPS), [steps]);
  const latest = steps[steps.length - 1];
  const { w, h } = size;
  const cx = w / 2;
  const cy = h * CENTER_Y;
  const ccx = card ? (card.l + card.r) / 2 : cx;
  const ccy = card ? (card.t + card.b) / 2 : cy;

  // Where every node wants to be (node centres, stage pixels), pushed clear
  // of the open card, and when the wave reaches it.
  const { targets, laid } = useMemo(() => {
    const push = (x: number, y: number, hw: number, hh: number, axis: "x" | "y"): Target => {
      if (!card) return { x, y, delay: 0 };
      const l = card.l - CARD_MARGIN, r = card.r + CARD_MARGIN, t = card.t - CARD_MARGIN, b = card.b + CARD_MARGIN;
      const overlaps = x + hw > l && x - hw < r && y + hh > t && y - hh < b;
      const delay = Math.hypot(x - ccx, y - ccy) * WAVE_SPEED;
      if (!overlaps) return { x, y, delay };
      if (axis === "x") return { x: x < ccx ? Math.max(hw + 8, l - hw) : Math.min(w - hw - 8, r + hw), y, delay };
      return { x, y: y < ccy ? Math.max(hh + 8, t - hh) : Math.min(h - hh - 8, b + hh), delay };
    };
    const targets: Record<string, Target> = {
      agent: { x: cx, y: cy, delay: 0 },
      question: push(Math.max(90, cx - ORB_R - 210), cy, NODE / 2 + 10, NODE / 2 + 22, "x"),
      answer: push(Math.min(w - 90, cx + ORB_R + 210), cy, NODE / 2 + 10, NODE / 2 + 22, "x"),
    };
    const laid = groups.map((g, i) => {
      const base = slot(i, w, h);
      const s = push(base.x, base.y, NODE / 2 + 12, NODE / 2 + 26, "y");
      targets[g.key] = s;
      // Items pulled through this source branch out sideways, away from the
      // centre, stacked in a column (n8n style).
      const side: -1 | 1 = base.x < cx - 1 ? -1 : 1;
      const items = g.items.slice(-MAX_ITEMS);
      const leaves = items.map((it, j) => {
        const id = `${g.key}::${it.name}`;
        targets[id] = { x: s.x + side * (NODE / 2 + LEAF_GAP + 1), y: s.y + (j - (items.length - 1) / 2) * LEAF_STEP, delay: s.delay + 0.04 };
        return { ...it, id };
      });
      return { g, i, above: base.above, side, leaves };
    });
    return { targets, laid };
  }, [groups, card, w, h, cx, cy, ccx, ccy]);

  const pos = useSprung(targets);
  const at = (id: string): XY => pos[id] ?? targets[id];

  // React Flow measures each node once; keep the sizes it reports, or a fresh
  // nodes array would hide them again until re-measured.
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const sized = changes.flatMap((c) => (c.type === "dimensions" && c.dimensions ? [{ id: c.id, ...c.dimensions }] : []));
    if (!sized.length) return;
    setDims((prev) => {
      const next = { ...prev };
      for (const { id, width, height } of sized) next[id] = { width, height };
      return next;
    });
  }, []);

  const active = laid.find((l) => l.g.lastId === latest?.id && !latest?.done);

  const ports = useMemo(() => Array.from({ length: MAX_GROUPS }, (_, i) => port(i, w, h)), [w, h]);
  const node = <T,>(id: string, type: string, data: T): Node<T> => ({
    id,
    type,
    data,
    position: at(id),
    ...dims[id],
    draggable: false,
    selectable: false,
    focusable: false,
    style: NO_EVENTS,
  });
  const nodes: Node[] = [
    node<AgentData>("agent", "agent", { ports }),
    node<BoxData>("question", "box", { role: "question", live: !latest, done: Boolean(latest), label: questionLabel, icon: <Icons.MessageSquare size={20} />, delay: 0 }),
    node<BoxData>("answer", "box", { role: "answer", live: false, done: answered, label: answerLabel, icon: <Icons.Send size={19} />, delay: 0.1 }),
  ];
  const wire = (id: string, source: string, sourceHandle: string, target: string, data: WireData): Edge<WireData> => ({
    id,
    source,
    sourceHandle,
    target,
    targetHandle: "in",
    type: "wire",
    data,
    focusable: false,
    style: NO_EVENTS,
  });
  const edges: Edge<WireData>[] = [
    { ...wire("e:q", "question", "out", "agent", { live: !latest, done: Boolean(latest), delay: 0 }), targetHandle: "q" },
    wire("e:a", "agent", "a", "answer", { live: false, done: answered, delay: 0 }),
  ];
  for (const l of laid) {
    const isActive = l === active;
    nodes.push(
      node<BoxData>(l.g.key, "box", {
        role: "source",
        live: isActive,
        done: l.g.done && !isActive,
        label: l.g.label,
        sub: l.g.items.length > MAX_ITEMS ? `+${l.g.items.length - MAX_ITEMS} more` : l.g.items.length ? `${l.g.items.length} pulled` : undefined,
        icon: l.g.logo ? <ToolkitIcon slug={l.g.logo} size={26} /> : KIND_ICON[l.g.kind](22),
        delay: 0.05 * l.i,
        above: l.above,
        side: l.side,
      }),
    );
    edges.push(
      wire(`e:${l.g.key}`, "agent", `p${l.i}`, l.g.key, {
        live: isActive,
        done: l.g.done && !isActive,
        delay: 0.05 * l.i,
      }),
    );
    for (const lf of l.leaves) {
      const on = isActive && lf.lastId === latest?.id;
      nodes.push(node<LeafData>(lf.id, "leaf", { name: lf.name, kind: l.g.kind, on, done: lf.done, side: l.side }));
      edges.push(
        wire(`e:${lf.id}`, l.g.key, "out", lf.id, {
          live: on,
          done: lf.done,
          delay: 0,
        }),
      );
    }
  }

  return (
    <div ref={boxRef} aria-hidden="true" className="mo-flow" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}>
      {/* n8n-style dot grid */}
      <motion.div
        animate={{ opacity: visible ? 1 : 0.35 }}
        transition={{ duration: 0.6 }}
        style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(color-mix(in oklab, var(--text) 13%, transparent) 1px, transparent 1.2px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(75% 70% at 50% 46%, #000 40%, transparent 100%)", WebkitMaskImage: "radial-gradient(75% 70% at 50% 46%, #000 40%, transparent 100%)" }}
      />
      {w > 0 && (
        <AnimatePresence>
          {visible && (
            <motion.div key="flow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }} style={{ position: "absolute", inset: 0 }}>
              {/* the wave: rings run out from the card as it opens */}
              <AnimatePresence>
                {card && (
                  <motion.div key="wave" initial={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                    {[0, 0.16, 0.32].map((d, k) => (
                      <motion.span
                        key={k}
                        initial={{ scale: 0.2, opacity: 0.55 - k * 0.12 }}
                        animate={{ scale: 1, opacity: 0 }}
                        transition={{ duration: 1.5, delay: d, ease: [0.16, 1, 0.3, 1] }}
                        style={{
                          position: "absolute",
                          left: ccx,
                          top: ccy,
                          width: Math.max(w, h) * 1.6,
                          height: Math.max(w, h) * 1.6,
                          marginLeft: -Math.max(w, h) * 0.8,
                          marginTop: -Math.max(w, h) * 0.8,
                          borderRadius: "50%",
                          border: `${2 - k * 0.5}px solid var(--accent)`,
                          background: k === 0 ? "radial-gradient(circle, transparent 55%, color-mix(in oklab, var(--accent) 10%, transparent) 68%, transparent 72%)" : "none",
                        }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Geometry is physical (Question left, Answer right) in every
                  language; labels keep their own direction (dir="auto"). */}
              <div dir="ltr" style={{ position: "absolute", inset: 0 }}>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  nodeOrigin={[0.5, 0.5]}
                  defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                  minZoom={1}
                  maxZoom={1}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  elementsSelectable={false}
                  panOnDrag={false}
                  panOnScroll={false}
                  zoomOnScroll={false}
                  zoomOnPinch={false}
                  zoomOnDoubleClick={false}
                  preventScrolling={false}
                  deleteKeyCode={null}
                  selectionKeyCode={null}
                  multiSelectionKeyCode={null}
                  panActivationKeyCode={null}
                  zoomActivationKeyCode={null}
                  disableKeyboardA11y
                  proOptions={{ hideAttribution: true }}
                  style={{ background: "transparent" }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
