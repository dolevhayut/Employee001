"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
import type { FocusPrefetch, FocusConfig } from "@/lib/twin-focus";

const SUGGESTIONS: { slug: string; args: Record<string, unknown>; label: string }[] = [
  { slug: "GITHUB_LIST_PULL_REQUESTS", args: { state: "open" }, label: "My open PRs" },
  { slug: "LINEAR_LIST_ISSUES", args: { limit: 10 }, label: "Linear queue" },
  { slug: "GMAIL_FETCH_EMAILS", args: { max_results: 10, query: "is:unread" }, label: "Unread email" },
  { slug: "SLACK_LIST_CHANNELS", args: {}, label: "Slack channels" },
  { slug: "GOOGLECALENDAR_LIST_EVENTS", args: { max_results: 10 }, label: "Upcoming calendar" },
];

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function FocusPage() {
  const ready = EMPLOYEES_WITH_TWIN.filter((e) => e.twinStatus === "ready");
  const [employeeId, setEmployeeId] = useState<string>(ready[0]?.id ?? "");
  const [config, setConfig] = useState<FocusConfig>({ prefetches: [] });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; seed?: Partial<FocusPrefetch> } | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    const r = await fetch(`/api/twin-focus/${id}`, { cache: "no-store" });
    setConfig(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load(employeeId);
  }, [employeeId, load]);

  async function save(prefetches: FocusPrefetch[]) {
    const r = await fetch(`/api/twin-focus/${employeeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefetches }),
    });
    if (r.ok) {
      await load(employeeId);
    }
  }

  async function remove(idx: number) {
    if (!confirm("Delete this prefetch?")) return;
    const next = config.prefetches.filter((_, i) => i !== idx);
    await save(next);
  }

  async function upsert(p: FocusPrefetch, idx: number | null) {
    const next = [...config.prefetches];
    if (idx === null) next.push(p);
    else next[idx] = p;
    await save(next);
  }

  const employee = EMPLOYEES_WITH_TWIN.find((e) => e.id === employeeId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={["Focus"]}
        actions={
          employeeId ? (
            <button
              className="btn primary sm"
              onClick={() => setEditing({ index: null })}
              style={{ height: 28 }}
            >
              <Icons.Plus size={12} /> Add prefetch
            </button>
          ) : null
        }
      />

      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <div style={{ maxWidth: 880 }}>
          <PageHead
            icon="Eye"
            title="Focus"
            subtitle="Configure what each twin prefetches (PRs, Linear, Gmail, Slack) before every shift — so turn 1 starts with real world-state."
            style={{ marginBottom: "var(--sp-16)" }}
          />
          {/* Twin selector */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--sp-6)",
              marginBottom: "var(--sp-20)",
              paddingBottom: "var(--sp-16)",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            {ready.map((e) => {
              const selected = e.id === employeeId;
              return (
                <button
                  key={e.id}
                  onClick={() => setEmployeeId(e.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--sp-8)",
                    padding: "5px 12px 5px 5px",
                    borderRadius: 999,
                    border: "1px solid var(--hairline)",
                    background: selected ? "var(--text)" : "var(--surface)",
                    color: selected ? "var(--bg)" : "var(--text-muted)",
                    fontSize: "var(--fs-sm)",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: e.avatarColor,
                      display: "grid",
                      placeItems: "center",
                      fontSize: "var(--fs-2xs)",
                      fontWeight: 700,
                      color: "var(--text)",
                    }}
                  >
                    {e.initials}
                  </span>
                  {e.firstName ?? e.name}
                </button>
              );
            })}
          </div>

          {/* Intro / explainer */}
          <div style={{ marginBottom: "var(--sp-18)" }}>
            <h2 style={{ fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>
              Pre-shift focus
            </h2>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
              Run Composio tool calls automatically before each shift to pre-load
              {employee ? ` ${employee.firstName ?? employee.name}'s` : ""} world state.
              Cached results feed straight into the agent's first turn.
            </p>
          </div>

          {/* Empty state */}
          {!loading && employeeId && config.prefetches.length === 0 && (
            <div
              style={{
                padding: "32px 24px",
                textAlign: "center",
                background: "var(--surface)",
                border: "1px dashed var(--hairline)",
                borderRadius: 10,
                marginBottom: "var(--sp-24)",
              }}
            >
              <Icons.Refresh size={24} style={{ opacity: 0.3, marginBottom: "var(--sp-10)" }} />
              <h3 style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text)", margin: "0 0 6px" }}>
                No prefetches yet
              </h3>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.55 }}>
                Add a prefetch to load tool results before the shift starts. Pick one from the
                suggestions below or build a custom one.
              </p>
              <button className="btn primary sm" onClick={() => setEditing({ index: null })}>
                <Icons.Plus size={12} /> Add prefetch
              </button>
            </div>
          )}

          {/* Cards list */}
          {config.prefetches.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)", marginBottom: "var(--sp-24)" }}>
              {config.prefetches.map((p, idx) => (
                <motion.div
                  key={`${idx}-${p.toolSlug}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 10,
                    padding: "var(--sp-14)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-10)", marginBottom: "var(--sp-8)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text)" }}>
                        {p.label}
                      </div>
                      <div
                        style={{
                          fontFamily: MONO_FONT,
                          fontSize: "var(--fs-meta)",
                          color: "var(--text-muted)",
                          marginTop: "var(--sp-3)",
                        }}
                      >
                        {p.toolSlug}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--fs-meta)",
                          color: "var(--text-subtle)",
                          marginTop: "var(--sp-4)",
                          display: "flex",
                          gap: "var(--sp-10)",
                        }}
                      >
                        <span>max {p.maxItems ?? 5}</span>
                        <span>·</span>
                        <span>cache {Math.round((p.cacheTtlMs ?? 300_000) / 60_000)}m</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setEditing({ index: idx })}
                      className="btn sm"
                      style={{ height: 26 }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(idx)}
                      className="btn ghost sm"
                      style={{ height: 26, color: "var(--danger)" }}
                      title="Delete"
                    >
                      <Icons.X size={11} />
                    </button>
                  </div>

                  <pre
                    style={{
                      margin: 0,
                      padding: "8px 10px",
                      background: "var(--bg-sunken)",
                      borderRadius: 6,
                      fontFamily: MONO_FONT,
                      fontSize: "var(--fs-meta)",
                      color: "var(--text-muted)",
                      maxHeight: 80,
                      overflow: "auto",
                      lineHeight: 1.5,
                    }}
                    className="scrollbar"
                  >
                    {JSON.stringify(p.arguments, null, 2)}
                  </pre>
                </motion.div>
              ))}

              <div>
                <button
                  className="btn sm"
                  onClick={() => setEditing({ index: null })}
                  style={{ height: 28 }}
                >
                  <Icons.Plus size={11} /> Add prefetch
                </button>
              </div>
            </div>
          )}

          {/* Suggestions */}
          {employeeId && (
            <div
              style={{
                padding: "var(--sp-14)",
                background: "var(--bg-sunken)",
                borderRadius: 10,
                border: "1px solid var(--hairline)",
              }}
            >
              <div
                style={{
                  fontSize: "var(--fs-meta)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: "var(--sp-10)",
                }}
              >
                💡 Common prefetches
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-6)" }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.slug}
                    onClick={() =>
                      setEditing({
                        index: null,
                        seed: { label: s.label, toolSlug: s.slug, arguments: s.args },
                      })
                    }
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--hairline)",
                      background: "var(--surface)",
                      color: "var(--text)",
                      fontFamily: MONO_FONT,
                      fontSize: "var(--fs-meta)",
                      cursor: "pointer",
                    }}
                  >
                    {s.slug}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <PrefetchModal
            initial={
              editing.index !== null
                ? config.prefetches[editing.index]
                : (editing.seed as FocusPrefetch | undefined)
            }
            onClose={() => setEditing(null)}
            onSave={async (p) => {
              await upsert(p, editing.index);
              setEditing(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PrefetchModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: Partial<FocusPrefetch>;
  onClose: () => void;
  onSave: (p: FocusPrefetch) => Promise<void>;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [toolSlug, setToolSlug] = useState(initial?.toolSlug ?? "");
  const [argsText, setArgsText] = useState(
    initial?.arguments ? JSON.stringify(initial.arguments, null, 2) : "{}"
  );
  const [maxItems, setMaxItems] = useState(initial?.maxItems ?? 5);
  const [cacheMinutes, setCacheMinutes] = useState(
    Math.round((initial?.cacheTtlMs ?? 300_000) / 60_000)
  );
  const [submitting, setSubmitting] = useState(false);

  let argsValid = true;
  let argsParsed: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(argsText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      argsValid = false;
    } else {
      argsParsed = parsed as Record<string, unknown>;
    }
  } catch {
    argsValid = false;
  }

  const canSave = label.trim().length > 0 && toolSlug.trim().length > 0 && argsValid;

  async function submit() {
    if (!canSave) return;
    setSubmitting(true);
    await onSave({
      label: label.trim(),
      toolSlug: toolSlug.trim(),
      arguments: argsParsed,
      maxItems: Math.max(1, Number(maxItems) || 5),
      cacheTtlMs: Math.max(1, Number(cacheMinutes) || 5) * 60_000,
    });
    setSubmitting(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,18,24,0.45)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: "var(--sp-24)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg-elevated)",
          borderRadius: 12,
          border: "1px solid var(--hairline)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          padding: "var(--sp-22)",
          maxHeight: "90vh",
          overflow: "auto",
        }}
        className="scrollbar"
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--sp-18)" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {initial?.toolSlug && initial.label ? "Edit prefetch" : "New prefetch"}
          </h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="btn ghost sm" style={{ height: 26 }}>
            <Icons.X size={12} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-12)" }}>
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My open PRs"
              style={inputStyle}
            />
          </Field>

          <Field label="Tool slug">
            <input
              value={toolSlug}
              onChange={(e) => setToolSlug(e.target.value)}
              placeholder="GITHUB_LIST_PULL_REQUESTS"
              style={{ ...inputStyle, fontFamily: MONO_FONT }}
            />
            <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", marginTop: "var(--sp-4)" }}>
              Composio action slug. Find at{" "}
              <a
                href="https://docs.composio.dev/toolkits"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)" }}
              >
                docs.composio.dev/toolkits
              </a>
            </div>
          </Field>

          <Field label="Arguments (JSON)">
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder='{ "state": "open" }'
              rows={5}
              style={{
                ...inputStyle,
                fontFamily: MONO_FONT,
                resize: "vertical",
                lineHeight: 1.5,
                borderColor: argsValid ? "var(--hairline)" : "var(--danger)",
              }}
            />
            {!argsValid && (
              <div style={{ fontSize: "var(--fs-meta)", color: "var(--danger)", marginTop: "var(--sp-4)" }}>
                Invalid JSON — must be a JSON object, e.g. {`{ "state": "open" }`}
              </div>
            )}
          </Field>

          <div style={{ display: "flex", gap: "var(--sp-12)" }}>
            <div style={{ flex: 1 }}>
              <Field label="Max items">
                <input
                  type="number"
                  min={1}
                  value={maxItems}
                  onChange={(e) => setMaxItems(parseInt(e.target.value, 10) || 1)}
                  style={inputStyle}
                />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Cache TTL (minutes)">
                <input
                  type="number"
                  min={1}
                  value={cacheMinutes}
                  onChange={(e) => setCacheMinutes(parseInt(e.target.value, 10) || 1)}
                  style={inputStyle}
                />
              </Field>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "var(--sp-8)", justifyContent: "flex-end", marginTop: "var(--sp-20)" }}>
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={submit} disabled={!canSave || submitting} className="btn primary">
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: "var(--fs-ui)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  background: "var(--surface)",
  color: "var(--text)",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <span
        style={{
          fontSize: "var(--fs-meta)",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
