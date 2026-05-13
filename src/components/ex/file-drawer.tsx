"use client";

import { useEffect } from "react";
import { Icons } from "@/components/ex/icons";
import { Glyphs, type GlyphId } from "@/components/ex/glyphs";
import {
  PROFILE_FILES,
  SAMPLE_CONTENT,
  type ContentLine,
  type ProfileFile,
} from "@/lib/ex-profile-files";
import { getBacklinks, getOutlinks } from "@/lib/profile-graph";

type Props = {
  fileName: string | null;
  onClose: () => void;
  onOpenFile: (name: string) => void;
};

function getFile(name: string): ProfileFile | undefined {
  return PROFILE_FILES.find((f) => f.name === name);
}

function renderContentLine(line: ContentLine, idx: number, onLink: (n: string) => void) {
  // Replace [[FILENAME.md]] with clickable spans.
  const parts: (string | { link: string; label: string })[] = [];
  const re = /\[\[([A-Z_]+\.md)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line.v)) !== null) {
    if (m.index > last) parts.push(line.v.slice(last, m.index));
    parts.push({ link: m[1], label: m[2] ?? m[1] });
    last = m.index + m[0].length;
  }
  if (last < line.v.length) parts.push(line.v.slice(last));

  const rendered = parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <button
        key={i}
        onClick={() => onLink(p.link)}
        style={{
          color: "var(--accent-deep)",
          background: "var(--accent-soft)",
          border: "none",
          padding: "0 4px",
          borderRadius: 3,
          fontSize: "inherit",
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        {p.label}
      </button>
    )
  );

  switch (line.t) {
    case "h1":
      return (
        <h1
          key={idx}
          style={{ fontSize: "var(--fs-h4)", fontWeight: 600, margin: "0 0 8px", letterSpacing: "-0.015em" }}
        >
          {rendered}
        </h1>
      );
    case "h2":
      return (
        <h2
          key={idx}
          style={{
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
            margin: "14px 0 6px",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {rendered}
        </h2>
      );
    case "li":
      return (
        <li key={idx} style={{ margin: "4px 0", lineHeight: 1.5, fontSize: "var(--fs-ui)" }}>
          {rendered}
        </li>
      );
    case "q":
      return (
        <blockquote
          key={idx}
          style={{
            margin: "8px 0",
            padding: "6px 10px",
            borderLeft: "2px solid var(--accent)",
            color: "var(--text-muted)",
            fontStyle: "italic",
            fontSize: "var(--fs-ui)",
            background: "var(--surface-soft)",
            borderRadius: 3,
          }}
        >
          {rendered}
        </blockquote>
      );
    case "p":
    default:
      return (
        <p key={idx} style={{ margin: "6px 0", lineHeight: 1.5, fontSize: "var(--fs-ui)" }}>
          {rendered}
        </p>
      );
  }
}

export function FileDrawer({ fileName, onClose, onOpenFile }: Props) {
  useEffect(() => {
    if (!fileName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fileName, onClose]);

  const open = fileName != null;
  const file = fileName ? getFile(fileName) : undefined;
  const content = file ? SAMPLE_CONTENT[file.name] ?? SAMPLE_CONTENT.default : [];
  const backlinks = file ? getBacklinks(file.name) : [];
  const outlinks = file ? getOutlinks(file.name) : [];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(26, 24, 22, 0.18)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity .18s",
          zIndex: 30,
        }}
      />
      {/* Drawer */}
      <aside
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--hairline)",
          boxShadow: "var(--shadow-lg)",
          transform: open ? "translateX(0)" : "translateX(110%)",
          transition: "transform .22s ease",
          zIndex: 31,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {file && (
          <>
            <header
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--hairline)",
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--sp-10)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="mono"
                  style={{
                    fontSize: "var(--fs-ui)",
                    fontWeight: 600,
                    color: "var(--text)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {file.name}
                </div>
                <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: "var(--sp-3)" }}>
                  {file.desc}
                </div>
              </div>
              <button
                className="btn ghost sm"
                onClick={onClose}
                style={{ padding: "var(--sp-4)", height: 24, width: 24, justifyContent: "center" }}
                title="Close"
              >
                <Icons.X size={12} />
              </button>
            </header>

            {/* Frontmatter */}
            <section
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid var(--hairline)",
                background: "var(--surface-soft)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-8)",
              }}
            >
              <div className="row" style={{ gap: "var(--sp-6)", flexWrap: "wrap" }}>
                <span
                  className="badge accent"
                  title="Confidence"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  conf {((file.frontmatter?.confidence ?? 0.85) * 100).toFixed(0)}%
                </span>
                <span className="badge">{(file.tokens || 0).toLocaleString()} tokens</span>
                <span className="badge">updated {file.frontmatter?.last_updated}</span>
                {file.frontmatter?.tags?.map((t) => (
                  <span key={t} className="badge" style={{ fontSize: "var(--fs-xs)" }}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="row" style={{ gap: "var(--sp-6)" }}>
                <span className="section-title" style={{ fontSize: "var(--fs-xs)" }}>
                  Sources
                </span>
                <div style={{ display: "flex", gap: "var(--sp-4)" }}>
                  {file.frontmatter?.sources?.map((s) => {
                    const G = Glyphs[s as GlyphId];
                    return G ? <G key={s} size={20} /> : null;
                  })}
                </div>
              </div>
            </section>

            {/* Content */}
            <div
              className="scrollbar"
              style={{
                padding: "14px 18px",
                overflowY: "auto",
                flex: 1,
                color: "var(--text)",
              }}
            >
              {content.length === 0 ? (
                <div className="muted" style={{ fontSize: "var(--fs-ui)" }}>
                  No content yet.
                </div>
              ) : (
                content.map((line, idx) =>
                  line.t === "li" ? (
                    <ul key={idx} style={{ margin: 0, paddingLeft: "var(--sp-18)" }}>
                      {renderContentLine(line, idx, onOpenFile)}
                    </ul>
                  ) : (
                    renderContentLine(line, idx, onOpenFile)
                  )
                )
              )}

              {/* Backlinks panel */}
              <div
                style={{
                  marginTop: "var(--sp-22)",
                  paddingTop: "var(--sp-14)",
                  borderTop: "1px solid var(--hairline)",
                }}
              >
                <div className="section-title" style={{ marginBottom: "var(--sp-6)" }}>
                  Linked from
                </div>
                {backlinks.length === 0 ? (
                  <div className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
                    No backlinks
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)" }}>
                    {backlinks.map((b) => (
                      <button
                        key={b}
                        className="btn sm"
                        onClick={() => onOpenFile(b)}
                        style={{ fontFamily: "var(--font)" }}
                      >
                        <span className="mono" style={{ fontSize: "var(--fs-meta)" }}>
                          {b}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: "var(--sp-16)" }}>
                <div className="section-title" style={{ marginBottom: "var(--sp-6)" }}>
                  Links to
                </div>
                {outlinks.length === 0 ? (
                  <div className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
                    No outlinks
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)" }}>
                    {outlinks.map((b) => (
                      <button
                        key={b}
                        className="btn sm"
                        onClick={() => onOpenFile(b)}
                        style={{ fontFamily: "var(--font)" }}
                      >
                        <span className="mono" style={{ fontSize: "var(--fs-meta)" }}>
                          {b}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
