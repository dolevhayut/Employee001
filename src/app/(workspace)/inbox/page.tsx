"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";

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

const TYPE_META: Record<FeedType, { label: string; color: string; bg: string }> = {
  "update":        { label: "Update",       color: "#64748b", bg: "#f1f5f9" },
  "alert":         { label: "Alert",        color: "#dc2626", bg: "#fee2e2" },
  "needs-review":  { label: "Needs review", color: "#b45309", bg: "#fef3c7" },
  "task-handoff":  { label: "Task handoff", color: "#6366f1", bg: "#e0e7ff" },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "update", label: "Updates" },
  { key: "alert", label: "Alerts" },
  { key: "needs-review", label: "Needs review" },
  { key: "task-handoff", label: "Task handoffs" },
];

function relTime(ts?: string): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const abs = Math.abs(diff);
  const sign = diff < 0 ? "in " : "";
  const suffix = diff < 0 ? "" : " ago";
  if (abs < 60_000) return diff < 0 ? "in <1 min" : "just now";
  if (abs < 3_600_000) return `${sign}${Math.floor(abs / 60_000)}m${suffix}`;
  if (abs < 86_400_000) return `${sign}${Math.floor(abs / 3_600_000)}h${suffix}`;
  if (abs < 7 * 86_400_000) return `${sign}${Math.floor(abs / 86_400_000)}d${suffix}`;
  return new Date(ts).toLocaleDateString();
}

function TypeBadge({ type }: { type: FeedType }) {
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
      {m.label}
    </span>
  );
}

function EmpAvatar({ employeeId, size = 22 }: { employeeId: string; size?: number }) {
  const emp = EMPLOYEES_WITH_TWIN.find((e) => e.id === employeeId);
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
  if (source.kind === "shift") {
    const emp = EMPLOYEES_WITH_TWIN.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          {emp?.firstName ?? source.employeeId}
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>· shift</span>
      </div>
    );
  }
  if (source.kind === "routine") {
    const emp = EMPLOYEES_WITH_TWIN.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          {emp?.firstName ?? source.employeeId}
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
          · routine · {source.routineName}
        </span>
      </div>
    );
  }
  if (source.kind === "task-run") {
    const emp = EMPLOYEES_WITH_TWIN.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          {emp?.firstName ?? source.employeeId}
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>· task</span>
      </div>
    );
  }
  if (source.kind === "twin-task") {
    const fromEmp = EMPLOYEES_WITH_TWIN.find((e) => e.id === source.fromId);
    const toEmp = EMPLOYEES_WITH_TWIN.find((e) => e.id === source.toId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-5)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
        <span style={{ fontWeight: 500 }}>{fromEmp?.firstName ?? source.fromId}</span>
        <Icons.Arrow size={10} style={{ color: "var(--text-subtle)" }} />
        <span style={{ fontWeight: 500 }}>{toEmp?.firstName ?? source.toId}</span>
      </div>
    );
  }
  if (source.kind === "approval") {
    const emp = EMPLOYEES_WITH_TWIN.find((e) => e.id === source.employeeId);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-6)" }}>
        <EmpAvatar employeeId={source.employeeId} size={18} />
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: 500 }}>
          {emp?.firstName ?? source.employeeId}
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
          {source.toolName}
        </code>
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-5)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
      <span style={{ fontWeight: 500 }}>{source.departmentId}</span>
      <span style={{ color: "var(--text-subtle)" }}>·</span>
      <span>{source.metric}</span>
    </div>
  );
}

function ResolutionChip({ resolution, resolvedAt }: { resolution: string; resolvedAt?: string }) {
  const lower = resolution.toLowerCase();
  const isNegative = lower.includes("reject") || lower.includes("dismiss") || lower.includes("denied");
  const symbol = isNegative ? "✗" : "✓";
  const color = isNegative ? "var(--text-muted)" : "#16a34a";
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
      <span>{resolution}</span>
      {resolvedAt && <span style={{ color: "var(--text-subtle)" }}>· {relTime(resolvedAt)}</span>}
    </span>
  );
}

export default function InboxPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [hideResolved, setHideResolved] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (hideResolved) params.set("status", "open");
    try {
      const res = await fetch(`/api/feed?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as FeedItem[];
        setItems(Array.isArray(data) ? data : []);
      }
    } catch {
      // swallow — polling will retry
    } finally {
      setLoading(false);
    }
  }, [hideResolved]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 4000);
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

  const isEmpty = !loading && filteredItems.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={["Inbox"]}
        actions={
          <button className="btn ghost sm" onClick={load} title="Refresh" style={{ height: 28 }}>
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
              {f.label}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setHideResolved((v) => !v)}
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
          title={hideResolved ? "Showing only open items" : "Showing all items"}
        >
          {hideResolved ? <Icons.Eye size={11} /> : <Icons.Check size={11} />}
          {hideResolved ? "Hide resolved" : "Showing all"}
        </button>

        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", flexShrink: 0 }}>
          {loading ? "…" : `${filteredItems.length} item${filteredItems.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* List */}
      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <PageHead
          icon="Inbox"
          title="Inbox"
          subtitle="A single feed for updates, alerts, task handoffs, and approvals across all twins."
          style={{ marginBottom: "var(--sp-16)", maxWidth: 880 }}
        />
        {isEmpty && (
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
                ? "No items in your inbox yet"
                : "Nothing matches the current filter"}
            </h2>
            <p style={{ fontSize: "var(--fs-ui)", lineHeight: 1.55, margin: 0 }}>
              Twins post updates and flags here when they run shifts.
            </p>
          </div>
        )}

        {!isEmpty && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)", maxWidth: 880 }}>
            <AnimatePresence initial={false}>
              {filteredItems.map((item) => {
                const isOpenReview = item.type === "needs-review" && item.status === "open";
                const isResolved = item.status !== "open";
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
                        {item.title}
                      </div>
                      <span
                        style={{
                          fontSize: "var(--fs-meta)",
                          color: "var(--text-subtle)",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}
                        title={new Date(item.ts).toLocaleString()}
                      >
                        {relTime(item.ts)}
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
                          paddingLeft: "var(--sp-2)",
                        }}
                      >
                        {item.detail}
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
                        <button
                          onClick={() => resolve(item.id, "approved")}
                          disabled={resolvingId === item.id}
                          className="btn sm"
                          style={{
                            height: 26,
                            background: "#16a34a",
                            borderColor: "#16a34a",
                            color: "white",
                          }}
                        >
                          <Icons.Check size={11} /> Approve
                        </button>
                        <button
                          onClick={() => resolve(item.id, "rejected")}
                          disabled={resolvingId === item.id}
                          className="btn sm"
                          style={{
                            height: 26,
                            background: "#fef3c7",
                            borderColor: "#fde68a",
                            color: "#b45309",
                          }}
                        >
                          <Icons.X size={11} /> Reject
                        </button>
                        <button
                          onClick={() => resolve(item.id, "dismissed")}
                          disabled={resolvingId === item.id}
                          className="btn ghost sm"
                          style={{ height: 26 }}
                        >
                          Dismiss
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
