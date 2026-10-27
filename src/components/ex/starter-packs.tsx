"use client";

import { useState } from "react";
import { STARTER_PACKS, type StarterPack } from "@/lib/marketplace";

const FOCUS_RING = "2px solid var(--accent)";
const focusRing = {
  onFocus: (e: React.FocusEvent<HTMLElement>) => {
    e.currentTarget.style.outline = FOCUS_RING;
    e.currentTarget.style.outlineOffset = "2px";
  },
  onBlur: (e: React.FocusEvent<HTMLElement>) => {
    e.currentTarget.style.outline = "none";
  },
};

/** Gallery of labelled example twins. Starting from one hands the pack to the
 *  parent, which fills its normal form; nothing is created here. */
export function StarterPacks({ disabled, onStart }: { disabled: boolean; onStart: (pack: StarterPack) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  return (
    <section aria-labelledby="starter-packs-heading" style={{ display: "grid", gap: "var(--sp-10)" }}>
      <div>
        <h2 id="starter-packs-heading" style={{ margin: 0, fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>
          Not sure where to start? Try an example
        </h2>
        <p className="subtle" id="starter-packs-hint" style={{ margin: "var(--sp-4) 0 0", fontSize: "var(--fs-sm)" }}>
          Examples are made-up briefs, not real people. Starting from one fills the form below; rewrite it so it describes you.
        </p>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--sp-12)" }}>
        {STARTER_PACKS.map((p) => {
          const expanded = open === p.id;
          return (
            <li key={p.id} className="card" style={{ padding: "var(--sp-14)", display: "grid", gap: "var(--sp-8)", alignContent: "start" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", flexWrap: "wrap" }}>
                <h3 id={`${p.id}-title`} style={{ margin: 0, fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>{p.title}</h3>
                <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--accent-deep)", background: "var(--accent-soft)", borderRadius: 999, padding: "1px 8px" }}>
                  Example
                </span>
              </div>
              <p id={`${p.id}-summary`} className="subtle" style={{ margin: 0, fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>{p.summary}</p>
              {expanded && (
                <pre
                  id={`${p.id}-preview`}
                  tabIndex={0}
                  role="region"
                  aria-labelledby={`${p.id}-title`}
                  style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "var(--text-muted)", maxHeight: 260, overflow: "auto" }}
                >
                  {p.notes}
                </pre>
              )}
              <div style={{ display: "flex", gap: "var(--sp-8)", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  aria-expanded={expanded}
                  aria-controls={expanded ? `${p.id}-preview` : undefined}
                  aria-label={`${expanded ? "Hide preview of" : "Preview"} ${p.title} example`}
                  onClick={() => setOpen(expanded ? null : p.id)}
                  {...focusRing}
                >
                  {expanded ? "Hide preview" : "Preview"}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={disabled}
                  aria-label={`Start from the ${p.title} example`}
                  aria-describedby={`${p.id}-summary`}
                  onClick={() => { setStarted(p.id); onStart(p); }}
                  {...focusRing}
                >
                  Start from this
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div role="status" className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
        {started ? "Example added to the form below. Edit it so it describes you." : ""}
      </div>
    </section>
  );
}
