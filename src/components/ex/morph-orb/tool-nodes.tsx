"use client";

// Tool nodes around the thinking orb: every tool, MCP server or knowledge
// source a twin touches becomes a node on a ring around the orb, wired to it
// by a line that draws in. The node in use glows; earlier ones settle. One
// node per source (repeated calls bump a counter and update the last action).

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";

export type ToolNodeStep = {
  id: number;
  kind: "read" | "search" | "tool" | "web" | "brain" | "skill" | "delegate" | "blocked";
  label: string;
  detail?: string;
  logo?: string;
};

export const base = (p: unknown) => (typeof p === "string" ? p.split("/").filter(Boolean).pop() ?? p : "");
export const words = (s: string) => s.replace(/[_-]+/g, " ").trim();

/** One readable line per tool call. */
export function describeToolCall(name: string, args: Record<string, unknown> = {}): Omit<ToolNodeStep, "id"> {
  if (name === "Read") {
    const path = String(args.file_path ?? "");
    if (path.includes("/handover/")) return { kind: "read", label: "Recalled from handover notes", detail: "reviewed notes" };
    if (path.includes("/profile/")) return { kind: "read", label: "Recalled from profile", detail: base(path).replace(/\.md$/, "") };
    if (path.includes("org-brain")) return { kind: "brain", label: "Read company brain", detail: base(path).replace(/\.md$/, "") };
    return { kind: "read", label: "Read", detail: base(path) };
  }
  if (name === "Grep" || name === "Glob") {
    return { kind: "search", label: "Searched", detail: String(args.pattern ?? args.path ?? "") };
  }
  if (name === "WebSearch") return { kind: "web", label: "Searched the web", detail: String(args.query ?? "") };
  if (name === "WebFetch") return { kind: "web", label: "Fetched", detail: String(args.url ?? "") };
  if (name === "ToolSearch") return { kind: "tool", label: "Looked up tools" };
  if (name.startsWith("subagent:")) return { kind: "delegate", label: "Delegated to a researcher", detail: String(args.label ?? args.description ?? "") };
  if (name.endsWith("consult_twin")) return { kind: "delegate", label: "Consulted a colleague", detail: String(args.employeeId ?? args.twin ?? "") };
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) {
    if (mcp[1] === "composio") {
      // Composio actions are TOOLKIT_VERB_OBJECT: the toolkit is the logo.
      const toolkit = mcp[2].split("_")[0].toLowerCase();
      return { kind: "tool", label: toolkit.charAt(0).toUpperCase() + toolkit.slice(1), detail: words(mcp[2].slice(toolkit.length)).toLowerCase(), logo: toolkit };
    }
    if (mcp[1] === "org_brain") return { kind: "brain", label: "Company brain", detail: words(mcp[2]).toLowerCase() };
    const server = mcp[1] === "companysim" ? "CompanySim" : words(mcp[1]);
    return { kind: "tool", label: server, detail: words(mcp[2]).toLowerCase(), logo: mcp[1].toLowerCase() };
  }
  return { kind: "tool", label: words(name) };
}


type Node = {
  key: string;
  kind: ToolNodeStep["kind"];
  label: string;
  detail?: string;
  logo?: string;
  count: number;
  lastId: number;
};

// Slots on an ellipse around the orb (degrees; 0 = right, 90 = down). The
// straight-down slot is left free for the "Thinking…" label.
const SLOTS = [-150, -30, -100, -80, 165, 15, 130, 50, -125, -55];
const RX = 270;
const RY = 175;

const ICON: Record<ToolNodeStep["kind"], (size: number) => ReactNode> = {
  read: (s) => <Icons.Doc size={s} />,
  search: (s) => <Icons.Search size={s} />,
  tool: (s) => <Icons.Plug size={s} />,
  web: (s) => <Icons.Eye size={s} />,
  brain: (s) => <Icons.Flow size={s} />,
  skill: (s) => <Icons.Spark size={s} />,
  delegate: (s) => <Icons.Team size={s} />,
  blocked: (s) => <Icons.Lock size={s} />,
};

function toNodes(steps: ToolNodeStep[]): Node[] {
  const byKey = new Map<string, Node>();
  for (const step of steps) {
    const key = step.logo ?? `${step.kind}:${step.label}`;
    const prev = byKey.get(key);
    byKey.set(key, {
      key,
      kind: step.kind,
      label: step.label,
      detail: step.detail ?? prev?.detail,
      logo: step.logo,
      count: (prev?.count ?? 0) + 1,
      lastId: step.id,
    });
  }
  return [...byKey.values()];
}

export function ToolNodes({
  steps,
  visible,
  rx = RX,
  ry = RY,
  cy = 46,
}: {
  steps: ToolNodeStep[];
  visible: boolean;
  /** Ellipse radii in px; smaller stages pass their own. */
  rx?: number;
  ry?: number;
  /** Vertical centre of the ring, % of the stage height. */
  cy?: number;
}) {
  const nodes = toNodes(steps).slice(0, SLOTS.length);
  const latest = steps[steps.length - 1]?.id;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }} aria-hidden="true">
      <AnimatePresence>
        {visible &&
          nodes.map((node, i) => {
            const rad = (SLOTS[i] * Math.PI) / 180;
            const x = Math.cos(rad) * rx;
            const y = Math.sin(rad) * ry;
            const len = Math.hypot(x, y);
            const lit = node.lastId === latest;
            const danger = node.kind === "blocked";
            const tone = danger ? "var(--danger)" : "var(--accent)";
            return (
              <motion.div key={node.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
                {/* the wire: from the orb's edge out to the node */}
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: `${cy}%`,
                    width: len,
                    height: 1,
                    transformOrigin: "0 50%",
                    rotate: `${Math.atan2(y, x)}rad`,
                    background: `linear-gradient(90deg, transparent 0 26%, color-mix(in oklab, ${tone} ${lit ? 70 : 30}%, transparent) 60%, color-mix(in oklab, ${tone} ${lit ? 80 : 35}%, transparent))`,
                    transition: "background 0.4s",
                  }}
                />
                {/* a spark travelling along the wire while the node is in use */}
                {lit && (
                  <motion.span
                    key={`spark-${node.lastId}`}
                    initial={{ x: 0, y: 0, opacity: 0 }}
                    animate={{ x: [x * 0.3, x], y: [y * 0.3, y], opacity: [0, 1, 0] }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      left: "calc(50% - 3px)",
                      top: `calc(${cy}% - 3px)`,
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: tone,
                      boxShadow: `0 0 12px ${tone}`,
                    }}
                  />
                )}
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: lit ? 1.04 : 1, opacity: lit ? 1 : 0.78 }}
                  transition={{ type: "spring", stiffness: 380, damping: 24 }}
                  style={{
                    position: "absolute",
                    left: `calc(50% + ${x}px)`,
                    top: `calc(${cy}% + ${y}px)`,
                    translateX: "-50%",
                    translateY: "-50%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px 6px 6px",
                    borderRadius: 999,
                    background: "var(--surface)",
                    border: `1px solid ${lit ? tone : "var(--hairline)"}`,
                    boxShadow: lit
                      ? `0 0 0 4px color-mix(in oklab, ${tone} 14%, transparent), 0 8px 24px color-mix(in oklab, ${tone} 22%, transparent)`
                      : "0 4px 14px color-mix(in oklab, var(--text) 7%, transparent)",
                    whiteSpace: "nowrap",
                    transition: "border-color 0.3s, box-shadow 0.3s",
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: node.logo ? "var(--bg-elevated)" : `color-mix(in oklab, ${tone} 14%, var(--surface))`,
                      color: tone,
                      overflow: "hidden",
                    }}
                  >
                    {node.logo ? <ToolkitIcon slug={node.logo} size={18} /> : ICON[node.kind](14)}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: danger ? "var(--danger)" : "var(--text)" }}>
                      {node.label}
                      {node.count > 1 && (
                        <span style={{ marginInlineStart: 6, fontSize: 10.5, fontWeight: 600, color: "var(--text-subtle)" }}>×{node.count}</span>
                      )}
                    </span>
                    {node.detail && (
                      <span
                        style={{
                          maxWidth: 170,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontSize: 10.5,
                          fontFamily: "var(--font-mono, ui-monospace, monospace)",
                          color: "var(--text-subtle)",
                        }}
                      >
                        {node.detail}
                      </span>
                    )}
                  </span>
                </motion.div>
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
}
