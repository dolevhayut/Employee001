"use client";

// An answer with inline source chips beside each claim. Hovering (or
// focusing) a chip shows a preview card of the cited source; a collapsible
// source list sits below. Ported from kokonutui's "AI Citations"
// (MIT, https://kokonutui.com, via 21st.dev) to inline styles + theme tokens +
// framer-motion. Sources here are twins: the chip is their avatar and name,
// the preview is the brief they wrote.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import type { AnswerPart } from "@/lib/org-answer";

export type CitedSource = {
  id: string;
  /** Short name on the chip, e.g. the twin's first name. */
  name: string;
  /** Second line in the preview and the list, e.g. the role. */
  title: string;
  initials: string;
  color: string;
  /** The passage that backs the claim, shown in the preview. */
  snippet?: string;
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const CARD_WIDTH = 300;
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 90;
/** After a preview closes, the next one within this window opens at once. */
const WARM_MS = 400;

function Avatar({ source, size = 16 }: { source: CitedSource; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        display: "inline-grid",
        placeItems: "center",
        background: source.color,
        color: "var(--text)",
        fontSize: Math.max(8, size * 0.5),
        fontWeight: 700,
      }}
    >
      {source.initials.charAt(0)}
    </span>
  );
}

type Preview = { part: number; x: number; y: number; w: number };

/** Opens a preview after a short hover and lets it glide from chip to chip. */
function usePreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warm, setWarm] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClosed = useRef(0);

  const clear = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const show = useCallback(
    (next: Preview, immediate = false) => {
      clear();
      const isWarm = preview !== null || Date.now() - lastClosed.current < WARM_MS;
      if (immediate || isWarm) {
        setWarm(preview !== null);
        setPreview(next);
        return;
      }
      openTimer.current = setTimeout(() => {
        setWarm(false);
        setPreview(next);
      }, OPEN_DELAY_MS);
    },
    [preview, clear],
  );

  const hide = useCallback(
    (immediate = false) => {
      clear();
      const close = () => {
        lastClosed.current = Date.now();
        setPreview(null);
      };
      if (immediate) close();
      else closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);
  return { preview, warm, show, hide };
}

export function CitedAnswer({
  parts,
  sources,
  streaming,
  onOpenSource,
  sourcesLabel,
}: {
  parts: AnswerPart[];
  sources: CitedSource[];
  streaming?: boolean;
  onOpenSource?: (id: string) => void;
  sourcesLabel: (count: number) => string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { preview, warm, show, hide } = usePreview();
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const previewId = useId();
  const listId = useId();

  const byId = new Map(sources.map((s) => [s.id, s]));
  // Sources numbered in the order the answer first cites them.
  const order: string[] = [];
  for (const part of parts) for (const id of part.cite ?? []) if (!order.includes(id) && byId.has(id)) order.push(id);
  const cited = order.map((id) => byId.get(id)).filter((s): s is CitedSource => Boolean(s));

  const place = (index: number, chip: HTMLElement): Preview => {
    const root = rootRef.current?.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    const width = Math.min(CARD_WIDTH, root?.width ?? CARD_WIDTH);
    const left = rect.left - (root?.left ?? 0) + rect.width / 2 - width / 2;
    const max = (root?.width ?? width) - width;
    return { part: index, x: Math.min(Math.max(0, left), Math.max(0, max)), y: rect.top - (root?.top ?? 0) - 8, w: width };
  };

  const active = preview ? parts[preview.part] : null;
  const activeSources = (active?.cite ?? []).map((id) => byId.get(id)).filter((s): s is CitedSource => Boolean(s));

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview, hide]);

  return (
    <MotionConfig reducedMotion="user">
      <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
        <div dir="auto" style={{ fontSize: 15.5, lineHeight: 1.75, color: "var(--text)", whiteSpace: "pre-wrap" }}>
          {parts.map((part, index) => {
            const partSources = (part.cite ?? []).map((id) => byId.get(id)).filter((s): s is CitedSource => Boolean(s));
            if (partSources.length === 0) return <span key={index}>{part.text}</span>;
            const first = partSources[0];
            const isActive = preview?.part === index;
            const isLinked = partSources.some((s) => s.id === hoveredSource);
            const lit = isActive || isLinked;
            return (
              <span key={index}>
                {/* The claim a chip supports lights up while it's previewed. */}
                <span
                  style={{
                    borderRadius: 3,
                    textDecorationLine: "underline",
                    textUnderlineOffset: 4,
                    textDecorationColor: lit ? "color-mix(in oklab, var(--accent) 70%, transparent)" : "transparent",
                    background: lit ? "color-mix(in oklab, var(--accent) 14%, transparent)" : "transparent",
                    transition: "background-color .15s, text-decoration-color .15s",
                  }}
                >
                  {part.text}
                </span>{" "}
                <button
                  type="button"
                  aria-describedby={isActive ? previewId : undefined}
                  aria-label={`Sources: ${partSources.map((s) => s.name).join(", ")}`}
                  onBlur={() => hide(true)}
                  onClick={(e) => show(place(index, e.currentTarget), true)}
                  onFocus={(e) => show(place(index, e.currentTarget), true)}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") show(place(index, e.currentTarget));
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") hide();
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    height: 20,
                    padding: "0 7px 0 2px",
                    transform: "translateY(-1px)",
                    verticalAlign: "middle",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    background: lit ? "var(--text)" : "var(--bg-sunken)",
                    color: lit ? "var(--bg)" : "var(--text-muted)",
                    transition: "background-color .15s, color .15s",
                  }}
                >
                  <Avatar source={first} />
                  <bdi>{first.name}</bdi>
                  {partSources.length > 1 && <span style={{ opacity: 0.6 }}>+{partSources.length - 1}</span>}
                </button>
              </span>
            );
          })}
          {streaming && (
            <motion.span
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              style={{ display: "inline-block", width: 7, height: 16, marginInlineStart: 2, verticalAlign: "text-bottom", borderRadius: 2, background: "var(--accent)" }}
            />
          )}
        </div>

        {/* One preview for every chip; it glides between chips once open. */}
        <AnimatePresence>
          {preview && activeSources.length > 0 && (
            <motion.div
              id={previewId}
              role="tooltip"
              initial={{ opacity: 0, scale: 0.97, x: preview.x, y: preview.y }}
              animate={{ opacity: 1, scale: 1, x: preview.x, y: preview.y }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{
                opacity: { duration: 0.14, ease: EASE_OUT },
                scale: { duration: 0.14, ease: EASE_OUT },
                x: warm ? { duration: 0.22, ease: EASE_OUT } : { duration: 0 },
                y: warm ? { duration: 0.22, ease: EASE_OUT } : { duration: 0 },
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                zIndex: 10,
                pointerEvents: "none",
                transformOrigin: "50% 0%",
                width: preview.w,
              }}
            >
              <div
                style={{
                  transform: "translateY(-100%)",
                  borderRadius: 12,
                  padding: 4,
                  background: "var(--surface)",
                  border: "1px solid var(--hairline)",
                  boxShadow: "0 12px 30px -10px color-mix(in oklab, var(--text) 30%, transparent)",
                }}
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={preview.part}
                    initial={{ opacity: 0, filter: "blur(2px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(2px)" }}
                    transition={{ duration: 0.16, ease: EASE_OUT }}
                  >
                    {activeSources.map((s) => (
                      <div key={s.id} style={{ padding: 10, borderRadius: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-subtle)" }}>
                          <Avatar source={s} />
                          <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>
                            <bdi>{s.name}</bdi>
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <bdi>{s.title}</bdi>
                          </span>
                          <span style={{ marginInlineStart: "auto", fontVariantNumeric: "tabular-nums" }}>{order.indexOf(s.id) + 1}</span>
                        </div>
                        {s.snippet && (
                          <p
                            dir="auto"
                            style={{
                              margin: "6px 0 0",
                              fontSize: 12,
                              lineHeight: 1.5,
                              color: "var(--text-muted)",
                              display: "-webkit-box",
                              WebkitLineClamp: 4,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {s.snippet}
                          </p>
                        )}
                      </div>
                    ))}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {cited.length > 0 && !streaming && (
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              aria-controls={listId}
              aria-expanded={listOpen}
              onClick={() => setListOpen((o) => !o)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 10px 4px 4px", borderRadius: 999, border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12, color: "var(--text-muted)" }}
            >
              <span style={{ display: "flex" }}>
                {cited.slice(0, 4).map((s, i) => (
                  <span key={s.id} style={{ marginInlineStart: i ? -4 : 0, borderRadius: "50%", boxShadow: "0 0 0 2px var(--bg)" }}>
                    <Avatar source={s} size={20} />
                  </span>
                ))}
              </span>
              {sourcesLabel(cited.length)}
              <motion.span animate={{ rotate: listOpen ? 180 : 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} style={{ display: "inline-flex", color: "var(--text-subtle)" }}>
                <Icons.ArrowDown size={12} />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {listOpen && (
                <motion.ol
                  id={listId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE_OUT }}
                  style={{ listStyle: "none", margin: 0, padding: 0, overflow: "hidden" }}
                >
                  {cited.map((s, i) => (
                    <li key={s.id} style={{ paddingTop: i ? 2 : 8 }}>
                      <button
                        type="button"
                        onClick={() => onOpenSource?.(s.id)}
                        onBlur={() => setHoveredSource(null)}
                        onFocus={() => setHoveredSource(s.id)}
                        onPointerEnter={() => setHoveredSource(s.id)}
                        onPointerLeave={() => setHoveredSource(null)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "none",
                          cursor: "pointer",
                          font: "inherit",
                          textAlign: "start",
                          background: hoveredSource === s.id ? "var(--bg-sunken)" : "transparent",
                          transition: "background-color .15s",
                        }}
                      >
                        <span style={{ width: 12, fontSize: 12, color: "var(--text-subtle)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                        <Avatar source={s} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <bdi>{s.name}</bdi> <span style={{ color: "var(--text-subtle)" }}>· <bdi>{s.title}</bdi></span>
                        </span>
                        <Icons.Arrow size={12} />
                      </button>
                    </li>
                  ))}
                </motion.ol>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
