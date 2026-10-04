"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { useRoster } from "@/components/ex/roster-context";
import { useT } from "@/components/ex/i18n-context";
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
  const { t } = useT();
  const roster = useRoster();
  const ready = roster.filter((e) => e.twinStatus === "ready");
  const [selectedId, setSelectedId] = useState<string>("");
  // Honor an explicit selection, otherwise default to the first ready employee
  // once the roster hydrates. Derived during render to avoid a mount-time
  // setState.
  const employeeId = selectedId || ready[0]?.id || "";
  const [config, setConfig] = useState<FocusConfig>({ prefetches: [] });
  // Loading is true whenever there's a twin whose config we're about to fetch.
  const [loading, setLoading] = useState<boolean>(() => Boolean(employeeId));
  const [editing, setEditing] = useState<{ index: number | null; seed?: Partial<FocusPrefetch> } | null>(null);

  // Used by the mutation flows (save/remove/upsert) to refresh after a write.
  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    const r = await fetch(`/api/twin-focus/${id}`, { cache: "no-store" });
    setConfig(await r.json());
    setLoading(false);
  }, []);

  // Show the loading state as soon as the active twin changes (adjusting state
  // during render instead of synchronously inside the effect below).
  const [prevLoadId, setPrevLoadId] = useState(employeeId);
  if (employeeId !== prevLoadId) {
    setPrevLoadId(employeeId);
    setLoading(Boolean(employeeId));
  }

  // Fetch the active twin's config when it changes. setStates live in the
  // promise callback (async), so no synchronous setState in the effect body.
  useEffect(() => {
    if (!employeeId) return;
    fetch(`/api/twin-focus/${employeeId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: FocusConfig) => {
        setConfig(data);
        setLoading(false);
      });
  }, [employeeId]);

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
    if (!confirm(t("focus.deleteConfirm"))) return;
    const next = config.prefetches.filter((_, i) => i !== idx);
    await save(next);
  }

  async function upsert(p: FocusPrefetch, idx: number | null) {
    const next = [...config.prefetches];
    if (idx === null) next.push(p);
    else next[idx] = p;
    await save(next);
  }

  const employee = roster.find((e) => e.id === employeeId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={[t("shell.cmd.focus")]}
        actions={
          employeeId ? (
            <button
              className="btn primary sm"
              onClick={() => setEditing({ index: null })}
              style={{ height: 28 }}
            >
              <Icons.Plus size={12} /> {t("focus.add")}
            </button>
          ) : null
        }
      />

      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <div style={{ maxWidth: 880 }}>
          <PageHead
            icon="Eye"
            title={t("shell.cmd.focus")}
            subtitle={t("focus.subtitle")}
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
                  onClick={() => setSelectedId(e.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--sp-8)",
                    paddingBlock: 5,
                    paddingInlineStart: 5,
                    paddingInlineEnd: 12,
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
              {t("focus.heading")}
            </h2>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
              {employee ? (
                <>
                  {t("focus.introNamedBefore")}
                  <bdi>{employee.firstName ?? employee.name}</bdi>
                  {t("focus.introNamedAfter")}
                </>
              ) : (
                t("focus.intro")
              )}
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
                {t("focus.emptyTitle")}
              </h3>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.55 }}>
                {t("focus.emptyBody")}
              </p>
              <button className="btn primary sm" onClick={() => setEditing({ index: null })}>
                <Icons.Plus size={12} /> {t("focus.add")}
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
                        <bdi>{p.toolSlug}</bdi>
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
                        <span>{t("focus.max")} <bdi>{p.maxItems ?? 5}</bdi></span>
                        <span>·</span>
                        <span>{t("focus.cache")} <bdi>{Math.round((p.cacheTtlMs ?? 300_000) / 60_000)}</bdi> {t("routines.schedule.min")}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setEditing({ index: idx })}
                      className="btn sm"
                      style={{ height: 26 }}
                    >
                      {t("focus.edit")}
                    </button>
                    <button
                      onClick={() => remove(idx)}
                      className="btn ghost sm"
                      style={{ height: 26, color: "var(--danger)" }}
                      title={t("focus.delete")}
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
                  <Icons.Plus size={11} /> {t("focus.add")}
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
                💡 {t("focus.suggestions")}
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
                    <bdi>{s.slug}</bdi>
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
  const { t } = useT();
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
          boxShadow: "var(--shadow-lg)",
          padding: "var(--sp-22)",
          maxHeight: "90vh",
          overflow: "auto",
        }}
        className="scrollbar"
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--sp-18)" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {initial?.toolSlug && initial.label ? t("focus.modal.edit") : t("focus.modal.new")}
          </h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="btn ghost sm" style={{ height: 26 }}>
            <Icons.X size={12} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-12)" }}>
          <Field label={t("focus.field.label")}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("focus.field.labelPh")}
              style={inputStyle}
            />
          </Field>

          <Field label={t("focus.field.slug")}>
            <input
              value={toolSlug}
              onChange={(e) => setToolSlug(e.target.value)}
              placeholder="GITHUB_LIST_PULL_REQUESTS"
              dir="ltr"
              style={{ ...inputStyle, fontFamily: MONO_FONT }}
            />
            <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", marginTop: "var(--sp-4)" }}>
              {t("focus.field.slugHint")}{" "}
              <a
                href="https://docs.composio.dev/toolkits"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)" }}
              >
                <bdi>docs.composio.dev/toolkits</bdi>
              </a>
            </div>
          </Field>

          <Field label={t("focus.field.args")}>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder='{ "state": "open" }'
              dir="ltr"
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
                {t("focus.field.argsInvalid")} <bdi>{`{ "state": "open" }`}</bdi>
              </div>
            )}
          </Field>

          <div style={{ display: "flex", gap: "var(--sp-12)" }}>
            <div style={{ flex: 1 }}>
              <Field label={t("focus.field.max")}>
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
              <Field label={t("focus.field.cache")}>
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
          <button onClick={onClose} className="btn">{t("focus.cancel")}</button>
          <button onClick={submit} disabled={!canSave || submitting} className="btn primary">
            {submitting ? t("focus.saving") : t("focus.save")}
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
