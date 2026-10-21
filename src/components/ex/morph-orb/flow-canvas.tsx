"use client";

// Flow Canvas: the twin's run drawn like an n8n workflow around the orb.
// The orb in the middle is the agent node. A Question node feeds it from the
// left and an Answer node takes its output on the right. Every source the
// twin reaches for appears as a node above or below the orb, wired to it;
// MCP servers fan out into the tools pulled through them ("CompanySim" →
// get person, search tickets). Wires are dashed with dots flowing along them,
// and a small orb hops along the wire to whatever the twin is doing now.
// The flowing-dot wires follow 21st.dev's "AI Agent Pipeline" (SVG
// animateMotion); the node look follows n8n. When the answer card opens, a
// wave runs out from it and gently pushes the nodes clear of it, nearest
// first.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
const EASE = [0.23, 1, 0.32, 1] as const;
/** The push: a soft spring with a little overshoot, like a wave lifting it. */
const PUSH = { type: "spring" as const, stiffness: 170, damping: 15, mass: 0.9 };
/** Seconds per pixel of distance from the card: the wave's travel time. */
const WAVE_SPEED = 0.0011;
const CARD_MARGIN = 26;

type Rect = { l: number; t: number; r: number; b: number };

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

/** A cubic wire between two points, bending vertically (n8n style for sub-nodes). */
function wireV(x0: number, y0: number, x1: number, y1: number): string {
  const my = (y0 + y1) / 2;
  return `M ${x0},${y0} C ${x0},${my} ${x1},${my} ${x1},${y1}`;
}
function wireH(x0: number, y0: number, x1: number, y1: number): string {
  const mx = (x0 + x1) / 2;
  return `M ${x0},${y0} C ${mx},${y0} ${mx},${y1} ${x1},${y1}`;
}

function Wire({ d, live, done, delay = 0 }: { d: string; live: boolean; done: boolean; delay?: number }) {
  return (
    <g>
      <motion.path
        fill="none"
        stroke={done ? "var(--success)" : live ? "var(--accent)" : "var(--text)"}
        strokeOpacity={done ? 0.55 : live ? 0.7 : 0.18}
        strokeWidth={live ? 1.8 : 1.4}
        strokeDasharray="4 5"
        initial={{ pathLength: 0, opacity: 0, d }}
        animate={{ pathLength: 1, opacity: 1, d }}
        transition={{ duration: 0.6, delay, ease: EASE, d: PUSH }}
      />
      {live &&
        [0, 0.5].map((b) => (
          <circle key={b} r={2.6} fill="var(--accent)">
            <animateMotion dur="1.4s" begin={`${b * 1.4}s`} repeatCount="indefinite" path={d} />
          </circle>
        ))}
    </g>
  );
}

function NodeBox({
  x,
  y,
  live,
  done,
  label,
  sub,
  children,
  delay = 0,
  labelBelow = true,
  pushDelay = 0,
}: {
  x: number;
  y: number;
  live: boolean;
  done: boolean;
  label: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  delay?: number;
  labelBelow?: boolean;
  pushDelay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.4, left: x, top: y }}
      animate={{ opacity: 1, scale: 1, left: x, top: y }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: "spring", stiffness: 380, damping: 24, delay, left: { ...PUSH, delay: pushDelay }, top: { ...PUSH, delay: pushDelay } }}
      style={{ position: "absolute", translateX: "-50%", translateY: "-50%", display: "flex", flexDirection: labelBelow ? "column" : "column-reverse", alignItems: "center", gap: 7, pointerEvents: "none" }}
    >
      <span style={{ position: "relative", width: NODE, height: NODE }}>
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
          {children}
        </span>
        {done && !live && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            style={{ position: "absolute", top: -6, insetInlineEnd: -6, width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--success)", color: "var(--bg)", border: "2px solid var(--bg)" }}
          >
            <Icons.Check size={10} />
          </motion.span>
        )}
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.2, maxWidth: 150, textAlign: "center" }}>
        <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--text)", whiteSpace: "nowrap" }}>{label}</span>
        {sub && <span style={{ fontSize: 11, color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{sub}</span>}
      </span>
    </motion.div>
  );
}

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

  const groups = useMemo(() => groupSteps(steps).slice(0, 6), [steps]);
  const latest = steps[steps.length - 1];
  const { w, h } = size;
  const cx = w / 2;
  const cy = h * CENTER_Y;
  // Push a node (centre x,y, half-size hw,hh) clear of the open card.
  const ccx = card ? (card.l + card.r) / 2 : cx;
  const ccy = card ? (card.t + card.b) / 2 : cy;
  const push = (x: number, y: number, hw: number, hh: number, axis: "x" | "y"): { x: number; y: number; delay: number } => {
    if (!card) return { x, y, delay: 0 };
    const l = card.l - CARD_MARGIN, r = card.r + CARD_MARGIN, t = card.t - CARD_MARGIN, b = card.b + CARD_MARGIN;
    const overlaps = x + hw > l && x - hw < r && y + hh > t && y - hh < b;
    const delay = Math.hypot(x - ccx, y - ccy) * WAVE_SPEED;
    if (!overlaps) return { x, y, delay };
    if (axis === "x") return { x: x < ccx ? Math.max(hw + 8, l - hw) : Math.min(w - hw - 8, r + hw), y, delay };
    return { x, y: y < ccy ? Math.max(hh + 8, t - hh) : Math.min(h - hh - 8, b + hh), delay };
  };

  const q = push(Math.max(90, cx - ORB_R - 210), cy, NODE / 2 + 10, NODE / 2 + 22, "x");
  const a = push(Math.min(w - 90, cx + ORB_R + 210), cy, NODE / 2 + 10, NODE / 2 + 22, "x");
  const qx = q.x;
  const ax = a.x;

  // Geometry for every group node, its wire to the orb, and its tool leaves.
  const laid = groups.map((g, i) => {
    const base = slot(i, w, h);
    const moved = push(base.x, base.y, NODE / 2 + 12, NODE / 2 + 26, "y");
    const s = { ...base, x: moved.x, y: moved.y, delay: moved.delay };
    const fromY = s.above ? cy - ORB_R : cy + ORB_R;
    const fromX = cx + Math.max(-ORB_R * 0.7, Math.min(ORB_R * 0.7, (s.x - cx) * 0.35));
    const toY = s.above ? s.y + NODE / 2 : s.y - NODE / 2;
    const items = g.items.slice(-MAX_ITEMS);
    // Tools pulled through this source branch out sideways, away from the
    // centre, stacked in a column (n8n style).
    const side = s.x < cx - 1 ? -1 : 1;
    const leaves = items.map((it, j) => {
      const lx = s.x + side * (NODE / 2 + 96);
      const ly = s.y + (j - (items.length - 1) / 2) * 34;
      const d = wireH(s.x + side * (NODE / 2 + 2), s.y, lx - side * 66, ly);
      return { ...it, x: lx, y: ly, d };
    });
    return { g, s, d: wireV(fromX, fromY, s.x, toY), leaves };
  });
  const active = laid.find((l) => l.g.lastId === latest?.id && !latest?.done);
  const hopTarget = active ? (active.leaves.find((lf) => lf.lastId === latest?.id) ?? null) : null;

  return (
    <div ref={boxRef} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}>
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
              <svg width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
                <Wire d={wireH(qx + NODE / 2, cy, cx - ORB_R, cy)} live={!latest} done={Boolean(latest)} />
                <Wire d={wireH(cx + ORB_R, cy, ax - NODE / 2, cy)} live={false} done={answered} />
                {laid.map((l, i) => (
                  <g key={l.g.key}>
                    <Wire d={l.d} live={l === active} done={l.g.done && l !== active} delay={0.05 * i} />
                    {l.leaves.map((lf) => (
                      <Wire key={lf.name} d={lf.d} live={l === active && lf.lastId === latest?.id} done={lf.done} />
                    ))}
                  </g>
                ))}
              </svg>

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

              {/* the orb hopping to whatever the twin is doing now */}
              <AnimatePresence>
                {active && (
                  <motion.span
                    key={`hop-${latest?.id}`}
                    initial={{ offsetDistance: "0%", opacity: 0, scale: 0.6 }}
                    animate={{ offsetDistance: "100%", opacity: [0, 1, 1], scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.75, ease: EASE }}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: 16,
                      height: 16,
                      marginLeft: -8,
                      marginTop: -8,
                      borderRadius: "50%",
                      offsetPath: `path("${hopTarget ? `${active.d} ${hopTarget.d.replace(/^M/, "L")}` : active.d}")`,
                      offsetRotate: "0deg",
                      background: "radial-gradient(circle at 35% 35%, #fff 0%, var(--accent) 45%, var(--twin) 100%)",
                      boxShadow: "0 0 16px var(--accent), 0 0 30px color-mix(in oklab, var(--twin) 60%, transparent)",
                    }}
                  />
                )}
              </AnimatePresence>

              <NodeBox x={qx} y={cy} live={!latest} done={Boolean(latest)} label={questionLabel} pushDelay={q.delay}>
                <Icons.MessageSquare size={20} />
              </NodeBox>
              <NodeBox x={ax} y={cy} live={false} done={answered} label={answerLabel} delay={0.1} pushDelay={a.delay}>
                <Icons.Send size={19} />
              </NodeBox>

              {laid.map((l, i) => (
                <div key={l.g.key}>
                  <NodeBox
                    x={l.s.x}
                    y={l.s.y}
                    live={l === active}
                    done={l.g.done && l !== active}
                    label={l.g.label}
                    sub={l.g.items.length > MAX_ITEMS ? `+${l.g.items.length - MAX_ITEMS} more` : l.g.items.length ? `${l.g.items.length} pulled` : undefined}
                    labelBelow={!l.s.above}
                    delay={0.05 * i}
                    pushDelay={l.s.delay}
                  >
                    {l.g.logo ? <ToolkitIcon slug={l.g.logo} size={26} /> : KIND_ICON[l.g.kind](22)}
                  </NodeBox>
                  {/* the tools / files pulled through this source */}
                  <AnimatePresence>
                    {l.leaves.map((lf) => {
                      const on = l === active && lf.lastId === latest?.id;
                      return (
                        <motion.div
                          key={lf.name}
                          initial={{ opacity: 0, scale: 0.5, left: lf.x, top: lf.y }}
                          animate={{ opacity: 1, scale: 1, left: lf.x, top: lf.y }}
                          exit={{ opacity: 0 }}
                          transition={{ type: "spring", stiffness: 420, damping: 26, left: { ...PUSH, delay: l.s.delay + 0.04 }, top: { ...PUSH, delay: l.s.delay + 0.04 } }}
                          style={{
                            position: "absolute",
                            translateX: "-50%",
                            translateY: "-50%",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            maxWidth: 140,
                            padding: "5px 10px",
                            borderRadius: 8,
                            fontSize: 11.5,
                            fontFamily: "var(--font-mono, ui-monospace, monospace)",
                            whiteSpace: "nowrap",
                            color: on ? "var(--text)" : "var(--text-muted)",
                            background: "var(--surface)",
                            border: `1px solid ${on ? "var(--accent)" : lf.done ? "color-mix(in oklab, var(--success) 55%, var(--hairline))" : "var(--hairline)"}`,
                            boxShadow: on ? "0 0 0 3px color-mix(in oklab, var(--accent) 14%, transparent)" : "none",
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: on ? "var(--accent)" : lf.done ? "var(--success)" : "var(--hairline-strong)" }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{lf.name}</span>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
