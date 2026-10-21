"use client";

// One source of the company's answer (the company brain, the connected
// systems, or a twin), shown live: while it works, every lookup it runs
// streams in with its logo; when it is done, its brief. Lit when the answer
// cites it under the cursor.

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

export function SourceCard({ s, lit, onOpen }: { s: SourceCardData; lit: boolean; onOpen?: () => void }) {
  const { t } = useT();
  const working = s.status === "working";
  const dim = s.status === "empty" || s.status === "error";
  const recent = s.lookups.slice(-5);
  const brief = s.brief.replace(/\*\*/g, "").trim();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: dim ? 0.55 : 1, y: 0, scale: lit ? 1.01 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      style={{
        position: "relative",
        borderRadius: 16,
        padding: 16,
        background: "var(--surface)",
        border: `1px solid ${lit ? "var(--accent)" : working ? "color-mix(in oklab, var(--accent) 40%, var(--hairline))" : "var(--hairline)"}`,
        boxShadow: lit ? "0 0 0 4px color-mix(in oklab, var(--accent) 16%, transparent)" : "none",
        transition: "border-color .25s, box-shadow .25s",
        overflow: "hidden",
      }}
    >
      {/* a light sweep across the card while the source works */}
      {working && (
        <motion.span
          aria-hidden="true"
          animate={{ x: ["-100%", "220%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "45%", background: "linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent) 9%, transparent), transparent)", pointerEvents: "none" }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
          {working && (
            <motion.span
              animate={{ scale: [1, 1.45], opacity: [0.5, 0] }}
              transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
              style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--accent)" }}
            />
          )}
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: "var(--fs-sm)",
              fontWeight: 700,
              color: s.kind === "twin" ? "var(--text)" : "var(--accent-deep)",
              background: s.kind === "twin" ? s.color : "var(--bg-sunken)",
              border: s.kind === "twin" ? "none" : "1px solid var(--hairline)",
            }}
          >
            {s.kind === "twin" ? s.initials : s.kind === "brain" ? <Icons.Database size={18} /> : <Icons.Plug size={18} />}
          </span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 650, color: "var(--text)" }}>
            <bdi>{s.name}</bdi>
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <bdi>{s.title}</bdi>
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            color: s.status === "done" ? "var(--success)" : working ? "var(--accent-deep)" : "var(--text-subtle)",
            background: s.status === "done" ? "color-mix(in oklab, var(--success) 12%, transparent)" : working ? "color-mix(in oklab, var(--accent) 12%, transparent)" : "var(--bg-sunken)",
          }}
        >
          {working && <motion.span animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />}
          {s.status === "done" ? <Icons.Check size={12} /> : null}
          {working
            ? s.lookups.length
              ? t("org.source.tools", { count: s.lookups.length })
              : t("org.source.working")
            : s.status === "done"
              ? t("org.source.done")
              : t("org.source.empty")}
        </span>
      </div>

      {/* live lookups */}
      {working && recent.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <AnimatePresence initial={false}>
            {recent.map((l, i) => {
              const latest = i === recent.length - 1;
              return (
                <motion.div
                  key={`${s.lookups.length - recent.length + i}`}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: latest ? 1 : 0.6, x: 0 }}
                  exit={{ opacity: 0 }}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)" }}
                >
                  <span style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--bg-sunken)", flexShrink: 0, color: "var(--accent-deep)" }}>
                    {l.logo ? <ToolkitIcon slug={l.logo} size={14} /> : <Icons.Search size={12} />}
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{l.label}</span>
                  {l.detail && <span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.detail}</span>}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* the brief, once in */}
      {s.status === "done" && brief && (
        <motion.div
          dir="auto"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          style={{ marginTop: 12, fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--text-muted)", whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 7, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {brief}
        </motion.div>
      )}

      {s.kind === "twin" && onOpen && s.status !== "working" && (
        <button
          onClick={onOpen}
          style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: 0, border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--accent-deep)" }}
        >
          {t("org.source.talk", { name: s.name })} <Icons.Arrow size={11} />
        </button>
      )}
    </motion.div>
  );
}
