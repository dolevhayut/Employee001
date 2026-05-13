"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Icons } from "@/components/ex/icons";

export type EmployeeCanvas = {
  artifactId: string;
  type: "html" | "svg";
  title: string;
  content: string;
};

const MAX_CANVAS_CHARS = 120_000;

function buildSrcDoc(content: string, type: "html" | "svg", tooLarge: boolean) {
  const body = tooLarge
    ? `<div style="padding:"var(--sp-16)"px;font-size:13px;line-height:1.5">This canvas is too large to preview safely.</div>`
    : type === "svg"
      ? `<div style="display:flex;justify-content:center;align-items:center;padding:"var(--sp-8)"px">${content}</div>`
      : content;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>html,body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#1a1a1a;background:transparent}*{box-sizing:border-box}</style></head><body>${body}</body></html>`;
}

function CanvasFullscreenPortal({
  canvas,
  srcDoc,
  onClose,
}: {
  canvas: EmployeeCanvas;
  srcDoc: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--sp-24)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1100,
          height: "90vh",
          background: "var(--surface)",
          borderRadius: 14,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-8)",
            padding: "10px 16px",
            borderBottom: "1px solid var(--hairline)",
            flexShrink: 0,
          }}
        >
          <Icons.Sparkle2 size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", flex: 1 }}>
            {canvas.title}
          </span>
          <span
            style={{
              fontSize: 9,
              color: "var(--text-subtle)",
              border: "1px solid var(--hairline)",
              padding: "1px 5px",
              borderRadius: 3,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {canvas.type}
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 10,
              padding: "2px 8px",
              fontFamily: "inherit",
              marginLeft: "var(--sp-4)",
            }}
          >
            Close
          </button>
        </div>
        {/* content */}
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          title={canvas.title}
          style={{
            flex: 1,
            width: "100%",
            border: "none",
            display: "block",
            background: "#fff",
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Renders an HTML or SVG canvas emitted by an employee's create_artifact tool.
 * Markup is isolated in a sandboxed iframe so canvas styling cannot leak into
 * the host app, while still allowing best-effort height measurement.
 */
export function EmployeeCanvasPanel({ canvas }: { canvas: EmployeeCanvas }) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [height, setHeight] = useState(220);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tooLarge = canvas.content.length > MAX_CANVAS_CHARS;

  const srcDoc = useMemo(
    () => buildSrcDoc(canvas.content, canvas.type, tooLarge),
    [canvas.content, canvas.type, tooLarge],
  );

  const onLoad = () => {
    const el = iframeRef.current;
    if (!el || !el.contentDocument) return;
    const docEl = el.contentDocument.documentElement;
    const h = Math.min(800, Math.max(120, docEl.scrollHeight + 16));
    setHeight(h);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          marginBottom: "var(--sp-8)",
          border: "1px solid var(--accent-soft)",
          borderRadius: 10,
          background: "var(--bg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-6)",
            padding: "6px 10px",
            background: "var(--surface)",
            borderBottom: collapsed ? "none" : "1px solid var(--hairline)",
            fontSize: 11,
          }}
        >
          <Icons.Sparkle2 size={11} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: "var(--text)" }}>{canvas.title}</span>
          <span
            style={{
              fontSize: 9,
              color: tooLarge ? "var(--warn)" : "var(--text-subtle)",
              border: "1px solid var(--hairline)",
              padding: "1px 5px",
              borderRadius: 3,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {tooLarge ? "too large" : canvas.type}
          </span>
          <div className="spacer" style={{ flex: 1 }} />
          {!tooLarge && (
            <button
              onClick={() => setFullscreen(true)}
              title="Open fullscreen"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 10,
                padding: "2px 6px",
                fontFamily: "inherit",
              }}
            >
              Fullscreen
            </button>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 10,
              padding: "2px 6px",
              fontFamily: "inherit",
            }}
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
        {!collapsed && (
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            onLoad={onLoad}
            sandbox="allow-same-origin"
            title={canvas.title}
            style={{
              width: "100%",
              height,
              border: "none",
              display: "block",
              background: "transparent",
            }}
          />
        )}
      </motion.div>

      {fullscreen && (
        <CanvasFullscreenPortal
          canvas={canvas}
          srcDoc={srcDoc}
          onClose={() => setFullscreen(false)}
        />
      )}
    </>
  );
}
