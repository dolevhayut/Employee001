"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { useRoster } from "@/components/ex/roster-context";
import { useWorkspaceMode } from "@/components/ex/workspace-mode-context";
import { AutonomyEmptyState } from "@/components/ex/autonomy-empty-state";
import { LoadErrorPanel, RefreshMiss } from "@/components/ex/load-error";
import { useT } from "@/components/ex/i18n-context";
import { formatDateTime, formatRelativeTime } from "@/lib/i18n/format";
import type { Locale, MessageKey } from "@/lib/i18n/messages";

type FeedSource =
  | { kind: "shift"; employeeId: string; runId: string }
  | { kind: "routine"; employeeId: string; runId: string; routineId: string; routineName: string }
  | { kind: "task-run"; employeeId: string; runId: string; task: string }
  | { kind: "twin-task"; taskId: string; fromId: string; toId: string }
  | { kind: "approval"; employeeId: string; runId: string; toolName: string; input: Record<string, unknown> }
  | { kind: "off-track"; departmentId: string; metric: string };

type FeedType = "update" | "alert" | "needs-review" | "task-handoff";
type FeedStatus = "open" | "resolved" | "dismissed";

type FeedItem = {
  id: string;
  ts: string;
  source: FeedSource;
  type: FeedType;
  title: string;
  detail?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  status: FeedStatus;
  resolvedAt?: string;
  resolution?: string;
};

type FilterKey = "all" | FeedType;

const TYPE_META: Record<FeedType, { label: MessageKey; color: string; bg: string }> = {
  "update":        { label: "inbox.type.update", color: "var(--text-subtle)", bg: "color-mix(in oklch, var(--text-subtle) 12%, transparent)" },
  "alert":         { label: "inbox.type.alert",  color: "var(--danger)", bg: "color-mix(in oklch, var(--danger) 12%, transparent)" },
  "needs-review":  { label: "inbox.type.review", color: "var(--warn)", bg: "color-mix(in oklch, var(--warn) 12%, transparent)" },
  "task-handoff":  { label: "inbox.type.handoff", color: "var(--twin)", bg: "color-mix(in oklch, var(--twin) 12%, transparent)" },
};

const FILTERS: { key: FilterKey; label: MessageKey }[] = [
  { key: "all", label: "inbox.filter.all" },
  { key: "update", label: "inbox.filter.updates" },
  { key: "alert", label: "inbox.filter.alerts" },
  { key: "needs-review", label: "inbox.filter.review" },
  { key: "task-handoff", label: "inbox.filter.handoffs" },
];

function relTime(ts: string | undefined, locale: Locale): string {
  return formatRelativeTime(ts, locale, { dateAfterMs: 7 * 86_400_000 });
}

function TypeBadge({ type }: { type: FeedType }) {
  const { t } = useT();
  const m = TYPE_META[type];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        background: m.bg,
        color: m.color,
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {t(m.label)}
    </span>
  );
}

function EmpAvatar({ employeeId, size = 22 }: { employeeId: string; size?: number }) {
  const emp = useRoster().find((e) => e.id === employeeId);
  const initials = emp?.initials ?? employeeId.slice(0, 2).toUpperCase();
  const color = emp?.avatarColor ?? "var(--surface)";
  return (
    <div
      title={emp?.name ?? employeeId}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        display: "grid",
        placeItems: "center",
        fontSize: size <= 20 ? 9 : 10,
        fontWeight: 700,
        color: "var(--text)",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initials}
    </div>
  );
}

function SourceLine({ source }: { source: FeedSource }) {
  const roster = useRoster();
  const { t, locale } = useT();
  const rtl = locale === "he";
  if (source.kind === "shift") {
    const emp = roster.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          <bdi>{emp?.firstName ?? source.employeeId}</bdi>
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>· {t("inbox.source.shift")}</span>
      </div>
    );
  }
  if (source.kind === "routine") {
    const emp = roster.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          <bdi>{emp?.firstName ?? source.employeeId}</bdi>
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
          · {t("inbox.source.routine")} · <bdi>{source.routineName}</bdi>
        </span>
      </div>
    );
  }
  if (source.kind === "task-run") {
    const emp = roster.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          <bdi>{emp?.firstName ?? source.employeeId}</bdi>
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>· {t("inbox.source.task")}</span>
      </div>
    );
  }
  if (source.kind === "twin-task") {
    const fromEmp = roster.find((e) => e.id === source.fromId);
    const toEmp = roster.find((e) => e.id === source.toId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-5)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
        <span style={{ fontWeight: 500 }}><bdi>{fromEmp?.firstName ?? source.fromId}</bdi></span>
        <Icons.Arrow
          size={10}
          style={{ color: "var(--text-subtle)", transform: rtl ? "scaleX(-1)" : undefined }}
        />
        <span style={{ fontWeight: 500 }}><bdi>{toEmp?.firstName ?? source.toId}</bdi></span>
      </div>
    );
  }
  if (source.kind === "approval") {
    const emp = roster.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          <bdi>{emp?.firstName ?? source.employeeId}</bdi>
        </span>
        <code
          style={{
            fontSize: "var(--fs-xs)",
            fontFamily: "var(--font-mono, monospace)",
            background: "var(--bg-sunken)",
            padding: "1px 5px",
            borderRadius: 3,
            color: "var(--text-muted)",
          }}
        >
          <bdi>{source.toolName}</bdi>
        </code>
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-5)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
      <span style={{ fontWeight: 500 }}><bdi>{source.departmentId}</bdi></span>
      <span style={{ color: "var(--text-subtle)" }}>·</span>
      <span><bdi>{source.metric}</bdi></span>
    </div>
  );
}

function ResolutionChip({ resolution, resolvedAt }: { resolution: string; resolvedAt?: string }) {
  const { t, locale } = useT();
  const lower = resolution.toLowerCase();
  const isNegative = lower.includes("reject") || lower.includes("dismiss") || lower.includes("denied");
  const symbol = isNegative ? "✗" : "✓";
  const color = isNegative ? "var(--text-muted)" : "var(--success)";
  const label =
    lower === "approved"
      ? t("inbox.resolution.approved")
      : lower.includes("reject")
        ? t("inbox.resolution.rejected")
        : lower.includes("dismiss")
          ? t("inbox.resolution.dismissed")
          : lower.includes("denied")
            ? t("inbox.resolution.denied")
            : resolution;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        fontSize: 10.5,
        color: "var(--text-subtle)",
        fontWeight: 500,
      }}
    >
      <span style={{ color }}>{symbol}</span>
      <span>{label === resolution ? <bdi>{resolution}</bdi> : label}</span>
      {resolvedAt && <span style={{ color: "var(--text-subtle)" }}>· <bdi>{relTime(resolvedAt, locale)}</bdi></span>}
    </span>
  );
}

export default function InboxPage() {
  const { t, locale } = useT();
  const { mode, loaded: modeLoaded } = useWorkspaceMode();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [hideResolved, setHideResolved] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = new URLSearchParams();
    if (hideResolved) params.set("status", "open");
    try {
      const res = await fetch(`/api/feed?${params}`, { cache: "no-store" });
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        setLoadError("Couldn't load approvals.");
        return;
      }
      const data = (await res.json()) as FeedItem[];
      if (seq !== loadSeq.current) return;
      setItems(Array.isArray(data) ? data : []);
      setLoadError(null);
      setHasLoaded(true);
    } catch {
      if (seq !== loadSeq.current) return;
      setLoadError("Couldn't load approvals.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [hideResolved]);

  useEffect(() => {
    const id = setInterval(load, 4000);
    void (async () => {
      await load();
    })();
    return () => clearInterval(id);
  }, [load]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.type === filter);
  }, [items, filter]);

  async function resolve(id: string, resolution: "approved" | "rejected" | "dismissed") {
    setResolvingId(id);
    try {
      await fetch(`/api/feed/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      await load();
    } finally {
      setResolvingId(null);
    }
  }

  async function runRoutineAgain(itemId: string, routineId: string) {
    setRerunningId(itemId);
    try {
      const run = await fetch(`/api/routines/${routineId}/run`, { method: "POST" });
      if (!run.ok) return;
      const resolved = await fetch(`/api/feed/${itemId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: "approved", note: t("inbox.routineStarted") }),
      });
      if (resolved.ok) await load();
    } finally {
      setRerunningId(null);
    }
  }

  const isEmpty = hasLoaded && !loading && filteredItems.length === 0;
  const showAutonomyEmpty =
    modeLoaded && mode === "base" && hasLoaded && !loading && items.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={[t("nav.approvals")]}
        actions={
          <button className="btn ghost sm" onClick={load} title={t("inbox.refresh")} style={{ height: 28 }}>
            <Icons.Refresh
              size={13}
              style={loading ? { animation: "spin 1s linear infinite" } : undefined}
            />
          </button>
        }
      />

      {/* Filter chip row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
          padding: "10px 24px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg)",
          flexShrink: 0,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
        className="scrollbar"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: "5px 12px",
                fontSize: "var(--fs-sm)",
                fontWeight: 500,
                borderRadius: 999,
                border: "1px solid var(--hairline)",
                background: active ? "var(--text)" : "var(--surface)",
                color: active ? "var(--bg)" : "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
                transition: "background .12s, color .12s",
              }}
            >
              {t(f.label)}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <button
          onClick={() => {
            setLoading(true);
            setHideResolved((v) => !v);
          }}
          style={{
            padding: "5px 12px",
            fontSize: "var(--fs-sm)",
            fontWeight: 500,
            borderRadius: 999,
            border: "1px solid var(--hairline)",
            background: hideResolved ? "var(--surface)" : "var(--text)",
            color: hideResolved ? "var(--text-muted)" : "var(--bg)",
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-5)",
          }}
          title={hideResolved ? t("inbox.onlyOpen") : t("inbox.showingAllTitle")}
        >
          {hideResolved ? <Icons.Eye size={11} /> : <Icons.Check size={11} />}
          {hideResolved ? t("inbox.hideResolved") : t("inbox.showingAll")}
        </button>

        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", flexShrink: 0 }}>
          {loading ? "…" : (
            <>
              <bdi>{filteredItems.length}</bdi>{" "}
              {t(filteredItems.length === 1 ? "inbox.itemOne" : "inbox.itemMany")}
            </>
          )}
        </span>
      </div>

      {/* List */}
      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <PageHead
          icon="Inbox"
          title={t("inbox.title")}
          subtitle={t("inbox.subtitle")}
          style={{ marginBottom: "var(--sp-16)", maxWidth: 880 }}
        />
        {loadError && hasLoaded && <RefreshMiss />}
        {loadError && !hasLoaded ? (
          <LoadErrorPanel message={t("load.approvals")} onRetry={() => void load()} />
        ) : isEmpty ? (
          showAutonomyEmpty ? (
            <AutonomyEmptyState
              title={t("empty.approvals.title")}
              description={t("empty.approvals.description")}
            />
          ) : (
          <div
            style={{
              maxWidth: 520,
              margin: "60px auto 0",
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            <Icons.Bell
              size={28}
              style={{
                opacity: 0.25,
                display: "block",
                margin: "0 auto 12px",
              }}
            />
            <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color: "var(--text)", margin: "0 0 6px" }}>
              {filter === "all" && hideResolved
                ? t("inbox.empty.title")
                : t("inbox.empty.filter")}
            </h2>
            <p style={{ fontSize: "var(--fs-ui)", lineHeight: 1.55, margin: 0 }}>
              {t("inbox.empty.hint")}
            </p>
          </div>
          )
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)", maxWidth: 880 }}>
            <AnimatePresence initial={false}>
              {filteredItems.map((item) => {
                const isOpenReview = item.type === "needs-review" && item.status === "open";
                const isResolved = item.status !== "open";
                const routineSource = item.source.kind === "routine" ? item.source : null;
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.18 }}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--hairline)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      opacity: isResolved ? 0.7 : 1,
                    }}
                  >
                    {/* Top row */}
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-6)" }}>
                      <TypeBadge type={item.type} />
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "var(--text)",
                          lineHeight: 1.4,
                        }}
                      >
                        <bdi>{item.title}</bdi>
                      </div>
                      <span
                        style={{
                          fontSize: "var(--fs-meta)",
                          color: "var(--text-subtle)",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}
                        title={formatDateTime(item.ts, locale)}
                      >
                        <bdi>{relTime(item.ts, locale)}</bdi>
                      </span>
                    </div>

                    {/* Detail */}
                    {item.detail && (
                      <p
                        style={{
                          fontSize: 12.5,
                          color: "var(--text-muted)",
                          margin: "0 0 8px",
                          lineHeight: 1.5,
                          paddingInlineStart: "var(--sp-2)",
                        }}
                      >
                        <bdi>{item.detail}</bdi>
                      </p>
                    )}

                    {/* Source line */}
                    <div style={{ marginBottom: isOpenReview || isResolved ? 10 : 0 }}>
                      <SourceLine source={item.source} />
                    </div>

                    {/* Approval actions */}
                    {isOpenReview && (
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--sp-6)",
                          paddingTop: "var(--sp-8)",
                          borderTop: "1px solid var(--hairline)",
                        }}
                      >
                        {routineSource && (
                          <button
                            onClick={() => void runRoutineAgain(item.id, routineSource.routineId)}
                            disabled={rerunningId === item.id || resolvingId === item.id}
                            className="btn sm"
                            style={{ height: 26 }}
                          >
                            {rerunningId === item.id ? (
                              <Icons.Loader size={11} style={{ animation: "spin 1s linear infinite" }} />
                            ) : (
                              <Icons.Arrow size={11} />
                            )}
                            {rerunningId === item.id ? t("inbox.routineStarted") : t("inbox.runRoutineAgain")}
                          </button>
                        )}
                        <button
                          onClick={() => resolve(item.id, "approved")}
                          disabled={resolvingId === item.id}
                          className="btn sm"
                          style={{
                            height: 26,
                            background: "var(--success)",
                            borderColor: "var(--success)",
                            color: "var(--bg)",
                          }}
                        >
                          <Icons.Check size={11} /> {t("inbox.approve")}
                        </button>
                        <button
                          onClick={() => resolve(item.id, "rejected")}
                          disabled={resolvingId === item.id}
                          className="btn sm"
                          style={{
                            height: 26,
                            background: "color-mix(in oklch, var(--warn) 12%, transparent)",
                            borderColor: "var(--warn)",
                            color: "var(--warn)",
                          }}
                        >
                          <Icons.X size={11} /> {t("inbox.reject")}
                        </button>
                        <button
                          onClick={() => resolve(item.id, "dismissed")}
                          disabled={resolvingId === item.id}
                          className="btn ghost sm"
                          style={{ height: 26 }}
                        >
                          {t("inbox.dismiss")}
                        </button>
                      </div>
                    )}

                    {/* Resolution chip */}
                    {isResolved && item.resolution && (
                      <div
                        style={{
                          paddingTop: "var(--sp-8)",
                          borderTop: "1px solid var(--hairline)",
                        }}
                      >
                        <ResolutionChip resolution={item.resolution} resolvedAt={item.resolvedAt} />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
