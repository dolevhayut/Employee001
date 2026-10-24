"use client";

import { useState } from "react";

// The handover package, as the departing employee and an admin review it:
// every captured item with its quote from the interview, an unconfirmed flag
// when the quote isn't in the transcript word for word, and edit / remove.

export type CapturedItem = { id: string; title: string; body: string; evidenceQuote?: string; verified?: boolean };
export type ToolingRef = { id: string; system: string; location: string; accessVia: string; ownedBy?: string; evidenceQuote?: string; verified?: boolean };
export type HandoverPackage = {
  generated_at: string;
  status: string;
  review?: { approvedAt: string; approvedBy?: string };
  decision_rules: CapturedItem[];
  playbooks: CapturedItem[];
  contact_graph: CapturedItem[];
  edge_cases: CapturedItem[];
  tooling_map: ToolingRef[];
  glossary: CapturedItem[];
  open_loops: CapturedItem[];
};

export type Message = { role: "user" | "assistant"; content: string };

/** GET /api/relay/[employeeId] */
export type HandoverState = {
  employeeId: string;
  name: string;
  role: string;
  lifecycle: "active" | "handover" | "retired";
  retention?: { grantedAt: string; onBehalf?: boolean };
  retentionDeclinedAt?: string;
  messages: Message[];
  package: HandoverPackage | null;
  packageDigest: string | null;
  model: { ok: boolean; reason?: string };
};

export const FIELDS = [
  ["decision_rules", "Decision rules"],
  ["playbooks", "How things are done"],
  ["contact_graph", "Who to go to"],
  ["edge_cases", "Watch out for"],
  ["tooling_map", "Systems and access"],
  ["glossary", "Glossary"],
  ["open_loops", "Open at handover"],
] as const;
type Field = (typeof FIELDS)[number][0];

export const itemCount = (p: HandoverPackage) => FIELDS.reduce((n, [f]) => n + p[f].length, 0);

const btn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "2px 8px",
  fontSize: "var(--fs-sm)",
  color: "var(--text-muted)",
  cursor: "pointer",
};

export function PackageReview({
  pkg,
  editable,
  onEdit,
}: {
  pkg: HandoverPackage;
  editable: boolean;
  onEdit: (edit: { op: "remove" | "update"; field: Field; itemId: string; title?: string; body?: string }) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const total = itemCount(pkg);
  const unconfirmed = FIELDS.reduce((n, [f]) => n + (pkg[f] as Array<{ verified?: boolean }>).filter((i) => i.verified === false).length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-12)" }}>
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
        {total} items{unconfirmed ? `, ${unconfirmed} not confirmed word for word in the interview` : ""}.{" "}
        {pkg.review ? `Approved ${pkg.review.approvedAt.slice(0, 10)}.` : "Not approved yet."}
      </div>
      {total === 0 && <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>Nothing was captured. Answer a few more questions and build the notes again.</div>}
      {FIELDS.map(([field, label]) => {
        const items = pkg[field] as Array<CapturedItem | ToolingRef>;
        if (!items.length) return null;
        return (
          <section key={field} style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: "var(--sp-12) var(--sp-16)" }}>
            <h3 style={{ margin: "0 0 var(--sp-8)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 600 }}>
              {label} · {items.length}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-12)" }}>
              {items.map((it) => {
                const title = "system" in it ? it.system : it.title;
                const body = "system" in it ? [it.location, it.accessVia && `access: ${it.accessVia}`, it.ownedBy && `owner: ${it.ownedBy}`].filter(Boolean).join(" · ") : it.body;
                const isEditing = editing === it.id;
                return (
                  <div key={it.id} style={{ borderInlineStart: "2px solid var(--hairline)", paddingInlineStart: "var(--sp-12)" }}>
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ fontSize: "var(--fs-ui)", padding: 6, borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--surface-soft)", color: "var(--text)" }} />
                        <textarea value={draft.body} rows={3} onChange={(e) => setDraft({ ...draft, body: e.target.value })} style={{ fontSize: "var(--fs-ui)", padding: 6, borderRadius: 6, border: "1px solid var(--hairline)", background: "var(--surface-soft)", color: "var(--text)", fontFamily: "inherit", resize: "vertical" }} />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button style={btn} onClick={async () => { await onEdit({ op: "update", field, itemId: it.id, title: draft.title, body: draft.body }); setEditing(null); }}>Save</button>
                          <button style={btn} onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: "var(--sp-8)", alignItems: "baseline" }}>
                          <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, flex: 1 }}>{title}</div>
                          {editable && (
                            <>
                              <button style={btn} onClick={() => { setEditing(it.id); setDraft({ title, body: "system" in it ? it.location : it.body }); }}>Edit</button>
                              <button style={btn} onClick={() => onEdit({ op: "remove", field, itemId: it.id })}>Remove</button>
                            </>
                          )}
                        </div>
                        {body && <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 2 }}>{body}</div>}
                        {it.evidenceQuote && (
                          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)", marginTop: 4, fontStyle: "italic" }}>“{it.evidenceQuote}”</div>
                        )}
                        {it.verified === false && <div style={{ fontSize: "var(--fs-sm)", color: "var(--warn)", marginTop: 2 }}>Not confirmed word for word in the interview. Check it.</div>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
