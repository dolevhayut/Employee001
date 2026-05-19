"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { useRoster } from "@/components/ex/roster-context";

// ─── Types ───────────────────────────────────────────────────────────────────

type LiveApproval = {
  kind: "live";
  approvalId: string;
  runId: string;
  employeeId: string;
  employeeName?: string;
  toolName: string;
  bareName?: string;
  input: Record<string, unknown>;
  reason: string;
  createdAt: number;
  surface: "chat" | "background";
  context?: { type: "routine"; routineId: string; routineName: string };
};

type FeedReviewSource =
  | { kind: "shift"; employeeId: string; runId: string }
  | { kind: "routine"; employeeId: string; runId: string; routineId: string; routineName: string }
  | { kind: "task-run"; employeeId: string; runId: string; task: string }
  | { kind: "twin-task"; taskId: string; fromId: string; toId: string }
  | { kind: "approval"; employeeId: string; runId: string; toolName: string; input: Record<string, unknown> }
  | { kind: "off-track"; departmentId: string; metric: string };

type FeedReview = {
  kind: "feed";
  id: string;
  ts: string;
  title: string;
  detail?: string;
  source: FeedReviewSource;
};

type PendingItem = LiveApproval | FeedReview;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function describeTool(toolName: string): string {
  const stripped = toolName.replace(/^mcp__[a-z_]+__/, "");
  const parts = stripped.split("_");
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[0].slice(1).toLowerCase()}: ${parts.slice(1).join(" ").toLowerCase()}`;
  }
  return stripped;
}

function employeeIdOf(item: PendingItem): string | null {
  if (item.kind === "live") return item.employeeId;
  const src = item.source;
  if ("employeeId" in src) return src.employeeId;
  if (src.kind === "twin-task") return src.toId;
  return null;
}

function itemKey(item: PendingItem): string {
  return item.kind === "live" ? item.approvalId : item.id;
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

export function GlobalApprovalOverlay() {
  const roster = useRoster();
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [editedJson, setEditedJson] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Poll both sources every 2s — live approval-bus + persistent feed
  // needs-review items. Every CEO approval must surface in the main app shell
  // regardless of which subsystem produced it.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [liveRes, feedRes] = await Promise.all([
          fetch("/api/approvals/pending", { cache: "no-store" }),
          fetch("/api/feed?status=open&type=needs-review", { cache: "no-store" }),
        ]);
        const liveRaw = liveRes.ok ? ((await liveRes.json()) as Omit<LiveApproval, "kind">[]) : [];
        const feedRaw = feedRes.ok ? ((await feedRes.json()) as Omit<FeedReview, "kind">[]) : [];
        const live: PendingItem[] = liveRaw.map((a) => ({ ...a, kind: "live" }));
        const feed: PendingItem[] = feedRaw.map((f) => ({ ...f, kind: "feed" }));
        // Live approvals first (they block an in-flight agent), then feed items
        if (!cancelled) setPending([...live, ...feed]);
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const resolveLive = useCallback(
    async (approvalId: string, action: "allow" | "deny", updatedInput?: Record<string, unknown>) => {
      setBusyId(approvalId);
      try {
        await fetch("/api/council/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalId,
            action,
            ...(updatedInput !== undefined ? { updatedInput } : {}),
          }),
        });
        setPending((p) => p.filter((a) => itemKey(a) !== approvalId));
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const resolveFeed = useCallback(
    async (feedId: string, resolution: "approved" | "rejected" | "dismissed") => {
      setBusyId(feedId);
      try {
        await fetch(`/api/feed/${feedId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution }),
        });
        setPending((p) => p.filter((a) => itemKey(a) !== feedId));
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  if (!mounted) return null;
  if (pending.length === 0) return null;

  const current = pending[0];
  const key = itemKey(current);
  const empId = employeeIdOf(current);
  const employee = empId ? roster.find((e) => e.id === empId) : undefined;
  const busy = busyId === key;

  const isLive = current.kind === "live";
  const isEditing = isLive && !!editing[key];
  const editedText = isLive
    ? editedJson[key] ?? JSON.stringify((current as LiveApproval).input, null, 2)
    : "";

  const title = isLive ? "Approval needed" : "Needs review";
  const subContext =
    isLive && (current as LiveApproval).context?.type === "routine"
      ? (current as LiveApproval).context!.routineName
      : !isLive && (current as FeedReview).source.kind === "routine"
        ? (current as FeedReview & { source: { kind: "routine"; routineName: string } }).source.routineName
        : !isLive && (current as FeedReview).source.kind === "shift"
          ? "shift"
          : !isLive && (current as FeedReview).source.kind === "task-run"
            ? "task"
            : null;

  const empLabel = isLive
    ? (current as LiveApproval).employeeName ?? employee?.name ?? empId
    : employee?.name ?? empId;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="overlay-bg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 18, 24, 0.55)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--sp-24)",
        }}
      >
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            width: "100%",
            maxWidth: 520,
            background: "var(--bg-elevated, #fff)",
            border: "1.5px solid var(--warn)",
            borderRadius: 14,
            padding: "var(--sp-22)",
            boxShadow:
              "0 20px 60px rgba(0,0,0,0.25), 0 0 0 6px color-mix(in srgb, var(--warn) 14%, transparent)",
          }}
        >
          {pending.length > 1 && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-6)",
                fontSize: "var(--fs-meta)",
                color: "var(--text-muted)",
                background: "var(--surface)",
                padding: "3px 8px",
                borderRadius: 999,
                marginBottom: "var(--sp-10)",
              }}
            >
              <span>{pending.length - 1} more pending</span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-4)" }}>
            <Icons.Lock size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--text)" }}>
              {title}
            </h2>
          </div>

          {(empLabel || subContext) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-8)",
                fontSize: "var(--fs-sm)",
                color: "var(--text-muted)",
                marginBottom: "var(--sp-14)",
              }}
            >
              {employee && (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: employee.avatarColor,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 8,
                    fontWeight: 700,
                    color: "var(--text)",
                    flexShrink: 0,
                  }}
                >
                  {employee.initials}
                </span>
              )}
              {empLabel && <span>{empLabel}</span>}
              {subContext && (
                <>
                  <span style={{ color: "var(--text-subtle)" }}>·</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    <Icons.Refresh size={11} />
                    {subContext}
                  </span>
                </>
              )}
            </div>
          )}

          {isLive ? (
            <>
              <div
                style={{
                  fontSize: "var(--fs-ui)",
                  fontWeight: 600,
                  color: "var(--text)",
                  marginBottom: "var(--sp-6)",
                }}
              >
                {describeTool((current as LiveApproval).toolName)}
              </div>
              <p
                style={{
                  fontSize: "var(--fs-sm)",
                  color: "var(--text-muted)",
                  margin: "0 0 14px",
                  lineHeight: 1.5,
                }}
              >
                {(current as LiveApproval).reason}
              </p>
              {Object.keys((current as LiveApproval).input).length > 0 && (
                <div style={{ marginBottom: "var(--sp-14)" }}>
                  {isEditing ? (
                    <textarea
                      value={editedText}
                      onChange={(e) =>
                        setEditedJson((m) => ({ ...m, [key]: e.target.value }))
                      }
                      rows={8}
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "var(--fs-meta)",
                        padding: "var(--sp-10)",
                        border: "1px solid var(--hairline)",
                        borderRadius: 6,
                        background: "var(--bg-sunken)",
                        color: "var(--text)",
                        resize: "vertical",
                        boxSizing: "border-box",
                        outline: "none",
                      }}
                    />
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        padding: "10px 12px",
                        background: "var(--bg-sunken)",
                        borderRadius: 6,
                        fontSize: "var(--fs-meta)",
                        fontFamily: "var(--font-mono, monospace)",
                        color: "var(--text-muted)",
                        overflow: "auto",
                        maxHeight: 200,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        lineHeight: 1.55,
                      }}
                    >
                      {JSON.stringify((current as LiveApproval).input, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: "var(--sp-8)" }}>
                <button
                  onClick={() => {
                    if (isEditing) {
                      try {
                        const parsed = JSON.parse(editedText);
                        resolveLive(key, "allow", parsed);
                      } catch {
                        alert("Invalid JSON");
                      }
                    } else {
                      resolveLive(key, "allow");
                    }
                  }}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "8px 14px",
                    background: "var(--text)",
                    color: "var(--bg)",
                    border: "none",
                    borderRadius: 6,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 600,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--sp-6)",
                  }}
                >
                  <Icons.Check size={13} />
                  Approve
                </button>
                <button
                  onClick={() => setEditing((m) => ({ ...m, [key]: !m[key] }))}
                  disabled={busy}
                  style={{
                    padding: "8px 14px",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 6,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {isEditing ? "Cancel edit" : "Edit args"}
                </button>
                <button
                  onClick={() => resolveLive(key, "deny")}
                  disabled={busy}
                  style={{
                    padding: "8px 14px",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 6,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 500,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  Skip
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: "var(--fs-ui)",
                  fontWeight: 600,
                  color: "var(--text)",
                  marginBottom: "var(--sp-6)",
                  lineHeight: 1.4,
                }}
              >
                {(current as FeedReview).title}
              </div>
              {(current as FeedReview).detail && (
                <p
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--text-muted)",
                    margin: "0 0 14px",
                    lineHeight: 1.5,
                  }}
                >
                  {(current as FeedReview).detail}
                </p>
              )}

              <div style={{ display: "flex", gap: "var(--sp-8)" }}>
                <button
                  onClick={() => resolveFeed(key, "approved")}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "8px 14px",
                    background: "var(--text)",
                    color: "var(--bg)",
                    border: "none",
                    borderRadius: 6,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 600,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--sp-6)",
                  }}
                >
                  <Icons.Check size={13} />
                  Approve
                </button>
                <button
                  onClick={() => resolveFeed(key, "rejected")}
                  disabled={busy}
                  style={{
                    padding: "8px 14px",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 6,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Reject
                </button>
                <button
                  onClick={() => resolveFeed(key, "dismissed")}
                  disabled={busy}
                  style={{
                    padding: "8px 14px",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 6,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 500,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  Dismiss
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

// ─── Bell with badge ──────────────────────────────────────────────────────────

export function NotificationBell() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [liveRes, feedRes] = await Promise.all([
          fetch("/api/approvals/pending", { cache: "no-store" }),
          fetch("/api/feed?status=open&type=needs-review", { cache: "no-store" }),
        ]);
        const live = liveRes.ok ? ((await liveRes.json()) as unknown[]) : [];
        const feed = feedRes.ok ? ((await feedRes.json()) as unknown[]) : [];
        if (!cancelled) setCount(live.length + feed.length);
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <button
      className="btn ghost"
      style={{ height: 22, width: 22, padding: 0, justifyContent: "center", position: "relative" }}
      title={count > 0 ? `${count} pending approval${count === 1 ? "" : "s"}` : "Notifications"}
    >
      <Icons.Bell size={13} />
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            minWidth: 14,
            height: 14,
            padding: "0 3px",
            borderRadius: 999,
            background: "var(--warn)",
            color: "white",
            fontSize: "var(--fs-2xs)",
            fontWeight: 700,
            display: "grid",
            placeItems: "center",
            boxShadow: "0 0 0 2px var(--bg-elevated)",
          }}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}
