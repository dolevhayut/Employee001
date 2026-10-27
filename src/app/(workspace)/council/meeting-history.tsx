"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { useT } from "@/components/ex/i18n-context";
import type { EmployeeWithTwin } from "@/lib/employees";
import { SendToRoomate, type RoomateAction } from "./send-to-roomate";

// Team Meeting history: a drawer that lists stored meetings and opens one
// read-only, with its summary on top, an .md export and "Continue".

export type HistoryDecision = {
  decision: string;
  actions: RoomateAction[];
  open: string[];
  /** Absent on meetings summarized before stances were recorded. */
  stances?: { employeeId: string; stance: "accept" | "object"; turn: number }[];
};

export type HistorySummary = HistoryDecision & { generatedAt: number; throughTurn: number };

export type HistoryTurn =
  | { kind: "ceo"; text: string; ts: number }
  | {
      kind: "twin";
      employeeId: string;
      employeeName: string;
      text: string;
      ts: number;
      delegatedFromId?: string;
      delegatedFromName?: string;
    };

export type HistorySharedFile = {
  id: string;
  filename: string;
  summary: string;
  sharedById: string;
  sharedByName: string;
  sharedAt: number;
  sizeBytes: number;
  contentType: string;
  kind: "text" | "image";
};

type Participant = { id: string; name: string };

type HistoryItem = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  participants: Participant[];
  turnCount: number;
  hasSummary: boolean;
  decision?: string;
};

export type HistoryDetail = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  participants: Participant[];
  transcript: HistoryTurn[];
  sharedFiles: HistorySharedFile[];
  summary: HistorySummary | null;
};

/** GET one stored meeting; null when it's gone or unreadable. */
export async function fetchMeetingDetail(id: string): Promise<HistoryDetail | null> {
  try {
    const res = await fetch(`/api/council/meetings/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as HistoryDetail;
  } catch {
    return null;
  }
}

const FOCUSABLE = 'button:not([disabled]), a[href], select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const sectionLabel = {
  fontSize: "var(--fs-xs)",
  fontWeight: 650,
  color: "var(--text-subtle)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
};

export function MeetingHistoryDrawer({
  currentMeetingId,
  busy,
  empById,
  onClose,
  onContinue,
}: {
  currentMeetingId: string | null;
  /** A run is streaming: continuing another meeting now would cut it off. */
  busy: boolean;
  empById: Record<string, EmployeeWithTwin>;
  onClose: () => void;
  onContinue: (detail: HistoryDetail) => void;
}) {
  const { t, locale } = useT();
  const rtl = locale === "he";
  const asideRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [summarizing, setSummarizing] = useState<"idle" | "loading" | "error">("idle");
  const [deleteError, setDeleteError] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [flashTurn, setFlashTurn] = useState<number | null>(null);

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(locale === "he" ? "he-IL" : "en-US", {
      month: "short",
      day: "numeric",
      year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/council/meetings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { meetings: HistoryItem[] }) => {
        if (!cancelled) setItems(data.meetings);
      })
      .catch(() => {
        if (!cancelled) setListError(true);
      });
    // Delete is admin-only on the server; only offer it to admins.
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((me: { user?: { role?: string } | null }) => {
        if (!cancelled) setCanDelete(me.user?.role === "admin" || me.user?.role === "owner");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Move focus into the dialog when it opens and when the view changes.
  useEffect(() => {
    headingRef.current?.focus();
  }, [selectedId, detail?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep Tab inside the dialog.
  function trapTab(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab" || !asideRef.current) return;
    const nodes = Array.from(asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(false);
    setSummarizing("idle");
    setDeleteError(false);
    void fetchMeetingDetail(id).then((d) => {
      if (d) setDetail(d);
      else setDetailError(true);
    });
  }

  function back() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(false);
  }

  async function summarize() {
    if (!detail) return;
    setSummarizing("loading");
    try {
      const res = await fetch("/api/council/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: detail.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const summary = (await res.json()) as HistorySummary;
      setDetail((d) => (d && d.id === detail.id ? { ...d, summary } : d));
      setItems((list) =>
        list?.map((it) => (it.id === detail.id ? { ...it, hasSummary: true, decision: summary.decision } : it)) ?? list,
      );
      setSummarizing("idle");
    } catch {
      setSummarizing("error");
    }
  }

  async function remove() {
    if (!detail || !window.confirm(t("meeting.deleteConfirm"))) return;
    setDeleteError(false);
    const res = await fetch(`/api/council/meetings/${encodeURIComponent(detail.id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setDeleteError(true);
      return;
    }
    setItems((list) => list?.filter((it) => it.id !== detail.id) ?? list);
    back();
  }

  const nameOf = (id: string, fallback?: string) => empById[id]?.firstName ?? fallback ?? id;

  // Only stances whose turn is still in the transcript can be linked.
  const stances = (detail?.summary?.stances ?? []).filter((s) => detail?.transcript[s.turn]?.kind === "twin");

  function jumpToTurn(turn: number) {
    const el = asideRef.current?.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
    setFlashTurn(turn);
    window.setTimeout(() => setFlashTurn((cur) => (cur === turn ? null : cur)), 1800);
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        aria-hidden
        style={{ position: "fixed", inset: 0, background: "color-mix(in oklch, var(--text) 32%, transparent)", zIndex: 100 }}
      />
      <motion.aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-history-heading"
        onKeyDown={trapTab}
        initial={{ x: rtl ? -560 : 560 }}
        animate={{ x: 0 }}
        exit={{ x: rtl ? -560 : 560 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: "fixed",
          top: 0,
          insetInlineEnd: 0,
          bottom: 0,
          width: 560,
          maxWidth: "94vw",
          background: "var(--bg-elevated)",
          borderInlineStart: "1px solid var(--hairline-strong)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          color: "var(--text)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: "var(--sp-12)" }}>
          {selectedId && (
            <button type="button" className="btn sm ghost" onClick={back} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ display: "inline-flex", transform: rtl ? "scaleX(-1)" : undefined }}>
                <Icons.ChevronLeft size={12} />
              </span>
              {t("meeting.allMeetings")}
            </button>
          )}
          <h2
            id="meeting-history-heading"
            ref={headingRef}
            tabIndex={-1}
            dir="auto"
            style={{ flex: 1, minWidth: 0, margin: 0, fontSize: "var(--fs-ui)", fontWeight: 700, outline: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {selectedId ? detail?.title || t("meeting.untitled") : t("meeting.historyTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("meeting.close")}
            style={{ background: "transparent", border: "1px solid var(--hairline)", borderRadius: 8, padding: "4px 10px", fontSize: "var(--fs-sm)", cursor: "pointer", color: "var(--text)" }}
          >
            ✕
          </button>
        </div>

        <div className="scrollbar" style={{ flex: 1, overflowY: "auto", padding: "12px 16px 24px" }}>
          {!selectedId ? (
            /* ─── List ─── */
            listError ? (
              <p role="alert" style={{ color: "var(--danger)", fontSize: "var(--fs-sm)" }}>{t("meeting.historyError")}</p>
            ) : items === null ? (
              <p style={{ color: "var(--text-subtle)", fontSize: "var(--fs-sm)" }}>{t("meeting.historyLoading")}</p>
            ) : items.length === 0 ? (
              <p style={{ color: "var(--text-subtle)", fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>{t("meeting.historyEmpty")}</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => open(m.id)}
                      style={{
                        width: "100%",
                        textAlign: "start",
                        font: "inherit",
                        cursor: "pointer",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${m.id === currentMeetingId ? "var(--accent)" : "var(--hairline)"}`,
                        background: "var(--surface)",
                        color: "var(--text)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%" }}>
                        <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-sm)", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.title || t("meeting.untitled")}
                        </span>
                        {m.id === currentMeetingId && (
                          <span style={{ fontSize: 11, fontWeight: 650, color: "var(--accent-deep)" }}>{t("meeting.current")}</span>
                        )}
                        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>{fmt(m.updatedAt)}</span>
                      </span>
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                        <bdi>{m.participants.map((p) => nameOf(p.id, p.name)).join(", ")}</bdi>
                        {" · "}
                        {t("meeting.messages", { count: m.turnCount })}
                      </span>
                      {m.decision && (
                        <span dir="auto" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: "var(--fs-xs)", color: "var(--text)", lineHeight: 1.45 }}>
                          <span style={{ color: "var(--success)", display: "inline-flex", marginTop: 2 }}>
                            <Icons.CheckCircle size={11} />
                          </span>
                          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{m.decision}</span>
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : detailError ? (
            <p role="alert" style={{ color: "var(--danger)", fontSize: "var(--fs-sm)" }}>{t("meeting.loadError")}</p>
          ) : !detail ? (
            <p style={{ color: "var(--text-subtle)", fontSize: "var(--fs-sm)" }}>{t("meeting.historyLoading")}</p>
          ) : (
            /* ─── One meeting ─── */
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                {fmt(detail.createdAt)} · <bdi>{detail.participants.map((p) => nameOf(p.id, p.name)).join(", ")}</bdi>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={busy || detail.id === currentMeetingId}
                  onClick={() => onContinue(detail)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Icons.MessageSquare size={12} /> {t("meeting.continue")}
                </button>
                <a
                  className="btn sm"
                  href={`/api/council/export?meetingId=${encodeURIComponent(detail.id)}&download=1`}
                  download
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                >
                  <Icons.ArrowDown size={12} /> {t("meeting.exportMd")}
                </a>
                {canDelete && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={remove}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--danger)", marginInlineStart: "auto" }}
                  >
                    <Icons.Trash size={12} /> {t("meeting.delete")}
                  </button>
                )}
              </div>
              {deleteError && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--fs-xs)" }}>{t("meeting.deleteError")}</p>}

              {/* Summary first: the decision is what people come back for. */}
              <section
                aria-label={t("meeting.decision")}
                style={{ borderRadius: "var(--radius-xl)", border: `1px solid ${detail.summary ? "color-mix(in oklab, var(--success) 45%, var(--hairline))" : "var(--hairline)"}`, background: "var(--surface)", overflow: "hidden" }}
              >
                {detail.summary ? (
                  <>
                    <div style={{ padding: "12px 14px", background: "color-mix(in oklab, var(--success) 8%, var(--surface))", borderBottom: "1px solid var(--hairline)" }}>
                      <div style={{ ...sectionLabel, color: "var(--success)", display: "flex", alignItems: "center", gap: 6 }}>
                        <Icons.CheckCircle size={12} /> {t("meeting.decision")}
                      </div>
                      <div dir="auto" style={{ marginTop: 6, fontSize: "var(--fs-base)", fontWeight: 600, lineHeight: 1.5 }}>{detail.summary.decision}</div>
                    </div>
                    {stances.length > 0 && (
                      <div style={{ padding: "10px 14px 4px" }}>
                        <div style={sectionLabel}>{t("meeting.stances")}</div>
                        <ul aria-label={t("meeting.stances")} style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {stances.map((s) => {
                            const accepted = s.stance === "accept";
                            const color = accepted ? "var(--success)" : "var(--danger)";
                            const name = nameOf(s.employeeId);
                            const label = t(accepted ? "meeting.accepted" : "meeting.objected");
                            return (
                              <li key={s.employeeId}>
                                <button
                                  type="button"
                                  onClick={() => jumpToTurn(s.turn)}
                                  aria-label={t("meeting.jumpToTurn", { name, stance: label, n: s.turn + 1 })}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "3px 10px",
                                    borderRadius: 999,
                                    border: `1px solid color-mix(in oklab, ${color} 45%, var(--hairline))`,
                                    background: `color-mix(in oklab, ${color} 10%, var(--surface))`,
                                    color: "var(--text)",
                                    font: "inherit",
                                    fontSize: "var(--fs-xs)",
                                    cursor: "pointer",
                                  }}
                                >
                                  <span style={{ color, display: "inline-flex" }}>
                                    {accepted ? <Icons.Check size={11} /> : <span aria-hidden>✕</span>}
                                  </span>
                                  <b><bdi>{name}</bdi></b>
                                  <span style={{ color: "var(--text-muted)" }}>{label} · <bdi>#{s.turn + 1}</bdi></span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {detail.summary.actions.length > 0 && (
                      <div style={{ padding: "10px 14px 4px" }}>
                        <div style={sectionLabel}>{t("meeting.nextSteps")}</div>
                        <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>
                          {detail.summary.actions.map((a, i) => (
                            <li key={i} dir="auto" style={{ marginBottom: 6 }}>
                              <b><bdi>{nameOf(a.employeeId)}</bdi></b> — {a.action}
                              {a.due && <span style={{ color: "var(--text-subtle)" }}> · {a.due}</span>}
                              <SendToRoomate
                                meetingId={detail.id}
                                index={i}
                                action={a}
                                ownerName={nameOf(a.employeeId)}
                                ownerLeft={empById[a.employeeId]?.lifecycle === "retired"}
                                inDialog
                                onSummary={(summary) => setDetail((d) => (d && d.id === detail.id ? { ...d, summary } : d))}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {detail.summary.open.length > 0 && (
                      <div style={{ padding: "10px 14px 4px" }}>
                        <div style={sectionLabel}>{t("meeting.open")}</div>
                        <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: "var(--fs-sm)", lineHeight: 1.5, color: "var(--text-muted)" }}>
                          {detail.summary.open.map((q, i) => (
                            <li key={i} dir="auto">{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div style={{ padding: "8px 14px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{fmt(detail.summary.generatedAt)}</span>
                      {detail.summary.throughTurn < detail.transcript.length && (
                        <>
                          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{t("meeting.summaryStale")}</span>
                          <button type="button" className="btn sm" onClick={summarize} disabled={summarizing === "loading"}>
                            {summarizing === "loading" ? t("meeting.deciding") : t("meeting.summarizeAgain")}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>{t("meeting.noSummary")}</span>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={summarize}
                      disabled={summarizing === "loading" || detail.transcript.length < 2}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <Icons.CheckCircle size={12} /> {summarizing === "loading" ? t("meeting.deciding") : t("meeting.summarize")}
                    </button>
                  </div>
                )}
                {summarizing === "error" && (
                  <p role="alert" style={{ margin: 0, padding: "0 14px 12px", fontSize: "var(--fs-xs)", color: "var(--danger)" }}>{t("meeting.decideError")}</p>
                )}
              </section>

              {/* Read-only transcript */}
              <section aria-label={t("meeting.transcript")} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={sectionLabel}>{t("meeting.transcript")}</div>
                {detail.transcript.map((turn, i) =>
                  turn.kind === "ceo" ? (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
                        {t("meeting.ceo")} · {fmt(turn.ts)}
                      </span>
                      <div dir="auto" style={{ maxWidth: "85%", padding: "8px 12px", borderRadius: 12, background: "var(--text)", color: "var(--bg)", fontSize: "var(--fs-sm)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                        {turn.text}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      data-turn={i}
                      tabIndex={-1}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        outline: flashTurn === i ? "2px solid var(--accent)" : "none",
                        outlineOffset: 4,
                        borderRadius: 12,
                      }}
                    >
                      <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
                        <b style={{ color: "var(--text)" }}><bdi>{nameOf(turn.employeeId, turn.employeeName)}</bdi></b>
                        {turn.delegatedFromName && (
                          <>
                            {" "}
                            ({t("meeting.calledInBy")} <bdi>{turn.delegatedFromId ? nameOf(turn.delegatedFromId, turn.delegatedFromName) : turn.delegatedFromName}</bdi>)
                          </>
                        )}
                        {" · "}
                        {fmt(turn.ts)}
                      </span>
                      <div dir="auto" style={{ padding: "8px 12px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--hairline)", fontSize: "var(--fs-sm)", lineHeight: 1.55 }}>
                        <Markdown>{turn.text}</Markdown>
                      </div>
                    </div>
                  ),
                )}
              </section>

              {detail.sharedFiles.length > 0 && (
                <section aria-label={t("meeting.sharedFiles")} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={sectionLabel}>{t("meeting.sharedFiles")}</div>
                  {detail.sharedFiles.map((f) => (
                    <a
                      key={f.id}
                      href={`/api/council/file?meetingId=${encodeURIComponent(detail.id)}&filename=${encodeURIComponent(f.filename)}&download=1`}
                      download={f.filename}
                      style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "var(--fs-sm)", color: "var(--text)", textDecoration: "none", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)" }}
                    >
                      <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontWeight: 600 }}>{f.filename}</span>
                      <span dir="auto" style={{ flex: 1, minWidth: 0, color: "var(--text-subtle)", fontSize: "var(--fs-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.summary} · <bdi>{f.sharedByName}</bdi>
                      </span>
                    </a>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}
