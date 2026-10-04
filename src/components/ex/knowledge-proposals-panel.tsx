"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Proposal = {
  id: string;
  createdAt: string;
  file: string;
  markdown: string;
  reason: string;
};

/**
 * "Suggested updates" — knowledge additions a twin proposed after a Team
 * Meeting. Nothing is written until the CEO accepts; accepted text is appended
 * to the target knowledge file (its previous body stays in file history).
 */
export function KnowledgeProposalsPanel({
  employeeId,
  onAccepted,
}: {
  employeeId: string;
  onAccepted: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/employees/${employeeId}/knowledge/proposals`, { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { proposals?: Proposal[] };
      setProposals(data.proposals ?? []);
    } catch {
      /* keep the current list on a transient error */
    }
  }, [employeeId]);

  useEffect(() => {
    const id = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(id);
  }, [load]);

  async function decide(id: string, action: "accept" | "dismiss") {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/employees/${employeeId}/knowledge/proposals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setProposals((list) => list.filter((p) => p.id !== id));
      if (action === "accept") onAccepted();
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (proposals.length === 0) return null;

  return (
    <section
      style={{
        marginBottom: "var(--sp-16)",
        padding: "var(--sp-16)",
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        background: "color-mix(in oklch, var(--accent) 8%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-8)", marginBottom: "var(--sp-4)" }}>
        <h3 style={{ margin: 0, fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>
          Suggested updates ({proposals.length})
        </h3>
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
          From Team Meetings. Nothing is saved until you accept.
        </span>
      </div>
      {error && (
        <p style={{ margin: "var(--sp-8) 0 0", fontSize: "var(--fs-sm)", color: "var(--danger)" }}>{error}</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)", marginTop: "var(--sp-12)" }}>
        <AnimatePresence initial={false}>
          {proposals.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              style={{
                padding: "var(--sp-12)",
                background: "var(--surface)",
                border: "1px solid var(--hairline)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", marginBottom: "var(--sp-6)" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)", color: "var(--text)" }}>
                  knowledge/{p.file}
                </span>
                {p.reason && (
                  <span dir="auto" style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                    · {p.reason}
                  </span>
                )}
              </div>
              <pre
                dir="auto"
                style={{
                  margin: 0,
                  padding: "var(--sp-8) var(--sp-10)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-sm)",
                  lineHeight: 1.5,
                  color: "var(--text)",
                  background: "color-mix(in oklch, var(--success) 10%, transparent)",
                  borderRadius: 6,
                }}
              >
                {p.markdown}
              </pre>
              <div style={{ display: "flex", gap: "var(--sp-8)", marginTop: "var(--sp-10)" }}>
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={busyId !== null}
                  onClick={() => void decide(p.id, "accept")}
                >
                  {busyId === p.id ? "Saving…" : `Add to ${p.file}`}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busyId !== null}
                  onClick={() => void decide(p.id, "dismiss")}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
