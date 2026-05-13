"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Xmark } from "iconoir-react";
import { Markdown } from "@/components/ex/markdown";
import type { RealNode } from "@/lib/profile-graph-real";

type Props = {
  employeeId: string;
  fileName: string | null;
  onClose: () => void;
  onOpenFile: (name: string) => void;
};

type FileContent = {
  frontmatter: RealNode;
  body: string;
};

export function RealFileDrawer({
  employeeId,
  fileName,
  onClose,
  onOpenFile,
}: Props) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Look up the brain-area portal target on mount + whenever the file
  // name changes (the element may not have existed at first paint).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("brain-area");
    setPortalTarget(el);
  }, [fileName]);

  // Esc-to-close — quality-of-life keyboard shortcut.
  useEffect(() => {
    if (!fileName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fileName, onClose]);

  useEffect(() => {
    if (!fileName) return;
    let cancelled = false;
    setLoading(true);
    setContent(null);

    fetch(
      `/api/employees/${encodeURIComponent(employeeId)}/file/${encodeURIComponent(fileName)}`
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: FileContent) => {
        if (!cancelled) setContent(data);
      })
      .catch(() => {
        if (!cancelled) setContent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId, fileName]);

  // Strip wikilinks → plain links so Markdown can render them
  const renderedBody =
    content?.body.replace(
      /\[\[([A-Z_]+\.md)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
      (_, target, alias) => `[${alias ?? target}](#${target})`
    ) ?? "";

  // Sticky-note tint for memory + scratch popups — visually links them
  // back to their yellow nodes in the graph.
  const isMemory = fileName?.startsWith("memory:") ?? false;
  const isScratch = fileName?.startsWith("scratch:") ?? false;
  const isSticky = isMemory || isScratch;

  if (!portalTarget) return null;

  return createPortal(
    <AnimatePresence>
      {fileName && (
        <>
          {/* Backdrop — covers only the brain area, not the whole page */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(15, 12, 8, 0.32)",
              backdropFilter: "blur(3px)",
              zIndex: 30,
            }}
          />

          {/* Positioner — non-animated, owns the centering transform.
              framer-motion below would otherwise overwrite our `transform`
              with its own (scale/y) and the popup would jump off-center.
              data-graph-zoom-skip tells ObsidianGraph's wheel handler to
              ignore wheel events inside this popup, so scrolling the
              content doesn't zoom the graph behind. */}
          <div
            data-graph-zoom-skip="true"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(560px, 88%)",
              maxHeight: "82%",
              zIndex: 31,
              display: "flex",
              flexDirection: "column",
            }}
          >
          {/* Centered popup over the brain — feels like the node itself
              expanded into a card. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            style={{
              width: "100%",
              maxHeight: "100%",
              background: isSticky
                ? "linear-gradient(180deg, #fff8d8 0%, #fde8a3 100%)"
                : "var(--bg-elevated)",
              border: isSticky
                ? "1px solid #e8c87a"
                : "1px solid var(--hairline-strong)",
              borderRadius: 12,
              boxShadow: isSticky
                ? "0 24px 60px rgba(180, 140, 30, 0.28), 0 0 0 1px rgba(0,0,0,0.04)"
                : "0 24px 50px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              // Sticky cards have a fixed cream background — lock theme tokens
              // to dark-on-cream values so nested children stay readable when
              // the rest of the app is in dark mode.
              ...(isSticky
                ? ({
                    "--text": "#3a2b15",
                    "--text-muted": "#6b5530",
                    "--text-subtle": "#9a8155",
                    "--bg-sunken": "rgba(180, 140, 30, 0.10)",
                    "--bg-elevated": "rgba(255, 248, 216, 0.6)",
                    "--surface": "rgba(255, 252, 235, 0.85)",
                    "--hairline": "rgba(180, 140, 30, 0.22)",
                    "--hairline-strong": "rgba(180, 140, 30, 0.38)",
                  } as React.CSSProperties)
                : null),
            }}
          >
            {/* Header */}
            <div
              style={{
                flexShrink: 0,
                padding: "14px 18px",
                borderBottom: "1px solid var(--hairline)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--sp-8)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "var(--fs-xs)",
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: fileName?.startsWith("memory:") || fileName?.startsWith("scratch:")
                      ? "#b08a25"
                      : "var(--text-subtle)",
                    marginBottom: "var(--sp-2)",
                  }}
                >
                  {fileName?.startsWith("memory:")
                    ? "Memory card · working memory"
                    : fileName?.startsWith("scratch:")
                    ? "Scratch note · agent-written"
                    : "Profile file"}
                </div>
                <div
                  style={{
                    fontSize: "var(--fs-body)",
                    fontWeight: 600,
                    color: "var(--text)",
                    fontFamily: fileName?.startsWith("memory:")
                      ? "inherit"
                      : "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={fileName ?? ""}
                >
                  {fileName?.startsWith("memory:")
                    ? `Card ${fileName.slice("memory:".length, "memory:".length + 8)}…`
                    : fileName?.startsWith("scratch:")
                    ? fileName.slice("scratch:".length).replace(/\.md$/, "")
                    : fileName}
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: "1px solid var(--hairline)",
                  background: "var(--surface)",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  flexShrink: 0,
                }}
              >
                <Xmark width={12} height={12} strokeWidth={1.5} />
              </button>
            </div>

            {/* Frontmatter pills */}
            {content && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                style={{
                  flexShrink: 0,
                  padding: "10px 18px",
                  borderBottom: "1px solid var(--hairline)",
                  background: "var(--bg-sunken)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--sp-6)",
                }}
              >
                <Pill
                  label="confidence"
                  value={`${Math.round(content.frontmatter.confidence * 100)}%`}
                  tone={
                    content.frontmatter.confidence >= 0.85
                      ? "success"
                      : content.frontmatter.confidence >= 0.7
                      ? "warn"
                      : "danger"
                  }
                />
                <Pill
                  label="updated"
                  value={content.frontmatter.lastUpdated || "—"}
                />
                <Pill
                  label="tokens"
                  value={`~${content.frontmatter.tokens}`}
                />
                {content.frontmatter.sources.map((s) => (
                  <Pill key={s} label="source" value={s} />
                ))}
                {content.frontmatter.tags.map((t) => (
                  <Pill key={t} label="tag" value={t} tone="accent" />
                ))}
              </motion.div>
            )}

            {/* Body */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "18px 22px 28px",
                fontSize: "var(--fs-ui)",
                lineHeight: 1.65,
                color: "var(--text)",
              }}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.tagName === "A") {
                  const href = target.getAttribute("href") || "";
                  if (href.startsWith("#") && href.endsWith(".md")) {
                    e.preventDefault();
                    onOpenFile(href.slice(1));
                  }
                }
              }}
            >
              {loading && (
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  style={{ color: "var(--text-subtle)" }}
                >
                  Loading…
                </motion.div>
              )}
              {!loading && content && <Markdown>{renderedBody}</Markdown>}
              {!loading && !content && (
                <div style={{ color: "var(--text-subtle)" }}>
                  Could not load this file.
                </div>
              )}
            </div>

            {/* Linked files (footer) */}
            {content && content.frontmatter.linkedFiles.length > 0 && (
              <div
                style={{
                  flexShrink: 0,
                  padding: "10px 18px",
                  borderTop: "1px solid var(--hairline)",
                  background: "var(--bg-sunken)",
                }}
              >
                <div
                  style={{
                    fontSize: "var(--fs-xs)",
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text-subtle)",
                    marginBottom: "var(--sp-6)",
                  }}
                >
                  Links to
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-6)" }}>
                  {content.frontmatter.linkedFiles.map((l) => (
                    <button
                      key={l}
                      onClick={() => onOpenFile(l)}
                      style={{
                        fontSize: "var(--fs-meta)",
                        fontWeight: 500,
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--hairline)",
                        background: "var(--surface)",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        transition: "background .12s, color .12s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-sunken)";
                        e.currentTarget.style.color = "var(--text)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--surface)";
                        e.currentTarget.style.color = "var(--text-muted)";
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    portalTarget
  );
}

function Pill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warn" | "danger" | "accent";
}) {
  const colors: Record<typeof tone, { bg: string; fg: string }> = {
    default: { bg: "var(--surface)", fg: "var(--text-muted)" },
    success: { bg: "rgba(46,140,80,0.1)", fg: "var(--success)" },
    warn: { bg: "rgba(180,140,60,0.12)", fg: "var(--warn)" },
    danger: { bg: "rgba(180,80,60,0.12)", fg: "var(--danger)" },
    accent: { bg: "var(--accent-soft)", fg: "var(--accent-deep)" },
  };
  const c = colors[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        fontSize: "var(--fs-xs)",
        fontWeight: 500,
        padding: "2px 7px",
        borderRadius: 10,
        background: c.bg,
        color: c.fg,
        border: "1px solid var(--hairline)",
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-2xs)",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          opacity: 0.6,
        }}
      >
        {label}
      </span>
      <span>{value}</span>
    </span>
  );
}
