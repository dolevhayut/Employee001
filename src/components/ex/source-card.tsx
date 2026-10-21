"use client";

// One source of the company's answer (the company brain, the connected
// systems, or a twin), shown live. While it works, a shine runs around the
// border (magicui "Shine Border") and every lookup lands in a task tray
// (after "Agent Status" on 21st.dev): finished lookups get a check, the
// current one spins. When the source is done, the border flashes green and
// its brief reveals point by point. Lit when the answer cites it under the
// cursor.

import "./source-card.css";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { useT } from "@/components/ex/i18n-context";

export type SourceLookup = { label: string; detail?: string; logo?: string };

export type SourceCardData = {
  id: string;
  kind: "brain" | "systems" | "twin";
  name: string;
  title: string;
  initials?: string;
  color?: string;
  status: "working" | "done" | "empty" | "error";
  lookups: SourceLookup[];
  brief: string;
};

const mono = "var(--font-mono, ui-monospace, monospace)";
const EASE = [0.23, 1, 0.32, 1] as const;
const TRAY_ROWS = 4;
const BRIEF_POINTS = 4;

/** "- a\n- b" (or one paragraph) → points. */
function points(brief: string): string[] {
  const lines = brief
    .replace(/\*\*/g, "")
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : [];
}

function KindBadge({ kind }: { kind: SourceCardData["kind"] }) {
  const { t } = useT();
  const label = kind === "brain" ? t("org.kind.brain") : kind === "systems" ? t("org.kind.systems") : t("org.kind.twin");
  return (
    <span style={{ fontSize: 10, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-subtle)", padding: "2px 6px", borderRadius: 5, border: "1px solid var(--hairline)" }}>
      {label}
    </span>
  );
}

export function SourceCard({ s, lit, onOpen, index = 0 }: { s: SourceCardData; lit: boolean; onOpen?: () => void; index?: number }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const working = s.status === "working";
  const done = s.status === "done";
  const dim = s.status === "empty" || s.status === "error";
  const tray = s.lookups.slice(-TRAY_ROWS);
  const hidden = s.lookups.length - tray.length;
  const all = points(s.brief);
  const shown = expanded ? all : all.slice(0, BRIEF_POINTS);

  return (
    <motion.div
      layout
      className={`sc-card${working ? " sc-shine" : ""}`}
      initial={{ opacity: 0, y: 16, scale: 0.97, filter: "blur(4px)" }}
      animate={{ opacity: dim ? 0.55 : 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.5, delay: index * 0.07, ease: EASE, layout: { duration: 0.35, ease: EASE } }}
      style={{
        borderRadius: 18,
        padding: 18,
        background: lit
          ? "radial-gradient(120% 120% at 0% 0%, color-mix(in oklab, var(--accent) 10%, var(--surface)) 0%, var(--surface) 60%)"
          : "var(--surface)",
        border: `1px solid ${lit ? "color-mix(in oklab, var(--accent) 70%, transparent)" : "var(--hairline)"}`,
        boxShadow: lit
          ? "0 0 0 4px color-mix(in oklab, var(--accent) 14%, transparent), 0 18px 40px -22px color-mix(in oklab, var(--accent) 60%, transparent)"
          : working
            ? "0 14px 34px -24px color-mix(in oklab, var(--accent) 55%, transparent)"
            : "0 1px 0 color-mix(in oklab, var(--text) 4%, transparent)",
        transition: "border-color .3s, box-shadow .3s, background .3s",
      }}
    >
      {/* green flash when the brief lands */}
      <AnimatePresence>
        {done && (
          <motion.span
            key="flash"
            aria-hidden="true"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            style={{ position: "absolute", inset: -1, borderRadius: 18, border: "1.5px solid var(--success)", boxShadow: "0 0 24px color-mix(in oklab, var(--success) 45%, transparent)", pointerEvents: "none", zIndex: 2 }}
          />
        )}
      </AnimatePresence>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
          {working && (
            <motion.span
              animate={{ scale: [1, 1.5], opacity: [0.45, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
              style={{ position: "absolute", inset: 0, borderRadius: s.kind === "twin" ? "50%" : 12, border: "2px solid var(--accent)" }}
            />
          )}
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: s.kind === "twin" ? "50%" : 12,
              display: "grid",
              placeItems: "center",
              fontSize: "var(--fs-sm)",
              fontWeight: 700,
              color: s.kind === "twin" ? "var(--text)" : "var(--accent-deep)",
              background: s.kind === "twin" ? s.color : "linear-gradient(140deg, color-mix(in oklab, var(--accent) 18%, var(--bg-sunken)), var(--bg-sunken))",
              border: s.kind === "twin" ? "2px solid var(--surface)" : "1px solid var(--hairline)",
              boxShadow: s.kind === "twin" ? "0 0 0 1px var(--hairline)" : "none",
            }}
          >
            {s.kind === "twin" ? s.initials : s.kind === "brain" ? <Icons.Database size={19} /> : <Icons.Plug size={19} />}
          </span>
          <AnimatePresence>
            {done && (
              <motion.span
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 22 }}
                style={{ position: "absolute", bottom: -3, insetInlineEnd: -3, width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--success)", color: "var(--bg)", border: "2px solid var(--surface)" }}
              >
                <Icons.Check size={10} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "var(--fs-base)", fontWeight: 650, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <bdi>{s.name}</bdi>
            </span>
            <KindBadge kind={s.kind} />
          </div>
          <div style={{ marginTop: 2, fontSize: "var(--fs-xs)", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <bdi>{s.title}</bdi>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={working ? "w" : s.status}
            initial={{ opacity: 0, y: 4, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.92 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              borderRadius: 999,
              fontSize: "var(--fs-xs)",
              fontWeight: 650,
              whiteSpace: "nowrap",
              color: done ? "var(--success)" : working ? "var(--accent-deep)" : "var(--text-subtle)",
              background: done ? "color-mix(in oklab, var(--success) 12%, transparent)" : working ? "color-mix(in oklab, var(--accent) 12%, transparent)" : "var(--bg-sunken)",
            }}
          >
            {working ? (
              <>
                <span className="sc-spin" style={{ display: "inline-flex" }}>
                  <Icons.Loader size={12} />
                </span>
                {s.lookups.length ? t("org.source.tools", { count: s.lookups.length }) : t("org.source.working")}
              </>
            ) : done ? (
              t("org.source.done")
            ) : (
              t("org.source.empty")
            )}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* the task tray: one row per lookup */}
      <AnimatePresence initial={false}>
        {working && s.lookups.length > 0 && (
          <motion.ul
            key="tray"
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 14 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            style={{ listStyle: "none", margin: 0, padding: 6, borderRadius: 12, background: "var(--bg-sunken)", display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}
          >
            {hidden > 0 && (
              <li style={{ padding: "2px 8px", fontSize: 11, color: "var(--text-subtle)" }}>{t("org.source.earlier", { count: hidden })}</li>
            )}
            <AnimatePresence initial={false}>
              {tray.map((l, i) => {
                const running = i === tray.length - 1;
                return (
                  <motion.li
                    key={hidden + i}
                    layout
                    initial={{ opacity: 0, x: -10, filter: "blur(3px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 8, background: running ? "var(--surface)" : "transparent", fontSize: "var(--fs-sm)" }}
                  >
                    <span style={{ width: 16, display: "grid", placeItems: "center", color: running ? "var(--accent-deep)" : "var(--success)", flexShrink: 0 }}>
                      {running ? (
                        <span className="sc-spin" style={{ display: "inline-flex" }}>
                          <Icons.Loader size={12} />
                        </span>
                      ) : (
                        <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ display: "inline-flex" }}>
                          <Icons.Check size={12} />
                        </motion.span>
                      )}
                    </span>
                    <span style={{ width: 20, height: 20, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--surface)", border: "1px solid var(--hairline)", flexShrink: 0, color: "var(--accent-deep)" }}>
                      {l.logo ? <ToolkitIcon slug={l.logo} size={13} /> : <Icons.Search size={11} />}
                    </span>
                    <span style={{ fontWeight: 600, color: running ? "var(--text)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{l.label}</span>
                    {l.detail && (
                      <span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.detail}</span>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>

      {/* the brief, point by point */}
      {done && shown.length > 0 && (
        <motion.ul
          initial="hidden"
          animate="shown"
          variants={{ shown: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } } }}
          style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
        >
          {shown.map((p, i) => (
            <motion.li
              key={i}
              dir="auto"
              variants={{ hidden: { opacity: 0, y: 6, filter: "blur(4px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.4, ease: EASE } } }}
              style={{ display: "flex", gap: 10, fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "var(--text-muted)" }}
            >
              <span style={{ marginTop: 8, width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: s.kind === "twin" ? s.color : "var(--accent)" }} />
              <span style={{ minWidth: 0 }}>{p}</span>
            </motion.li>
          ))}
        </motion.ul>
      )}

      {(all.length > BRIEF_POINTS || (s.kind === "twin" && onOpen && !working)) && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 16 }}>
          {done && all.length > BRIEF_POINTS && (
            <button
              onClick={() => setExpanded((e) => !e)}
              style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--text-muted)" }}
            >
              {expanded ? t("org.source.less") : t("org.source.more", { count: all.length - BRIEF_POINTS })}
            </button>
          )}
          {s.kind === "twin" && onOpen && !working && (
            <motion.button
              onClick={onOpen}
              whileHover={{ x: 3 }}
              style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: 0, border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 650, color: "var(--accent-deep)" }}
            >
              {t("org.source.talk", { name: s.name })} <Icons.Arrow size={11} />
            </motion.button>
          )}
        </div>
      )}
    </motion.div>
  );
}
