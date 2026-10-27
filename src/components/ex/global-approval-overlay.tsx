"use client";

import { ApprovalArgs } from "@/components/ex/approval-args";
import { useState, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { useRoster } from "@/components/ex/roster-context";
import { useT } from "@/components/ex/i18n-context";
import {
  getPendingReviewPollSnapshot,
  optimisticallyRemovePendingReview,
  subscribePendingReviewPoll,
} from "@/components/ex/pending-review-poll";

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

// Client-only mount flag: false during SSR + hydration, true once mounted on the
// client. Lets us defer the createPortal(document.body) render until after hydration.
const subscribeNoop = () => () => {};
// One shared empty list: a new [] per call makes useSyncExternalStore loop.
const NO_PENDING: ReturnType<typeof pendingItemsSnapshot> = [];
const noPending = () => NO_PENDING;
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

let pendingItemsCacheVersion = -1;
let pendingItemsCache: PendingItem[] = [];

function pendingItemsSnapshot(): PendingItem[] {
  const { live, feed, version } = getPendingReviewPollSnapshot();
  if (version === pendingItemsCacheVersion) return pendingItemsCache;
  pendingItemsCacheVersion = version;
  const liveItems: PendingItem[] = live.map((a) => ({ ...a, kind: "live" }));
  const feedItems: PendingItem[] = feed.map((f) => ({
    ...f,
    kind: "feed",
    source: f.source as FeedReviewSource,
  }));
  pendingItemsCache = [...liveItems, ...feedItems];
  return pendingItemsCache;
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

export function GlobalApprovalOverlay() {
  const reducedMotion = useReducedMotion() ?? false;
  const { t } = useT();
  const roster = useRoster();
  const pending = useSyncExternalStore(subscribePendingReviewPoll, pendingItemsSnapshot, noPending);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [editedJson, setEditedJson] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const mounted = useMounted();

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
        optimisticallyRemovePendingReview(approvalId);
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
        optimisticallyRemovePendingReview(feedId);
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  // A routine run that was skipped or lost can't be "approved" after the
  // fact: the useful action is to start the routine again, then close the item.
  const rerunRoutine = useCallback(
    async (feedId: string, routineId: string) => {
      setBusyId(feedId);
      try {
        const run = await fetch(`/api/routines/${routineId}/run`, { method: "POST" });
        if (!run.ok) return;
        await fetch(`/api/feed/${feedId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution: "approved", note: t("inbox.routineStarted") }),
        });
        optimisticallyRemovePendingReview(feedId);
      } finally {
        setBusyId(null);
      }
    },
    [t]
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

  const title = isLive ? t("inbox.overlay.needed") : t("inbox.overlay.review");
  const routineName =
    isLive && (current as LiveApproval).context?.type === "routine"
      ? (current as LiveApproval).context!.routineName
      : !isLive && (current as FeedReview).source.kind === "routine"
        ? (current as FeedReview & { source: { kind: "routine"; routineName: string } }).source.routineName
        : null;
  const subContext = routineName
    ? routineName
    : !isLive && (current as FeedReview).source.kind === "shift"
      ? t("inbox.source.shift")
      : !isLive && (current as FeedReview).source.kind === "task-run"
        ? t("inbox.source.task")
        : null;

  const rerunRoutineId =
    !isLive && (current as FeedReview).source.kind === "routine"
      ? (current as FeedReview & { source: { kind: "routine"; routineId: string } }).source.routineId
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
            maxWidth: 560,
            background: "var(--bg-elevated)",
            border: "1px solid var(--hairline-strong)",
            borderRadius: 18,
            padding: "var(--sp-20)",
            boxShadow: "var(--shadow-dialog)",
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
              <span>
                {pending.length - 1 === 1
                  ? t("inbox.overlay.moreOne")
                  : (
                    <>
                      <bdi>{pending.length - 1}</bdi> {t("inbox.overlay.moreMany")}
                    </>
                  )}
              </span>
            </div>
          )}

          {/* Header after 21st.dev's "Tool Approval" (starc007): an icon tile,
              the title, and a status pill. */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-12)", marginBottom: "var(--sp-8)" }}>
            <span
              aria-hidden
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                border: "1px solid var(--hairline)",
                background: "var(--surface)",
                color: "var(--warn)",
              }}
            >
              <Icons.Lock size={15} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: "var(--fs-lg)", fontWeight: 650, color: "var(--text)", lineHeight: 1.3 }}>
                {title}
              </h2>
            </div>
            <span
              style={{
                flexShrink: 0,
                padding: "2px 9px",
                borderRadius: 999,
                fontSize: "var(--fs-2xs)",
                fontWeight: 600,
                color: "var(--warn)",
                border: "1px solid color-mix(in oklch, var(--warn) 35%, transparent)",
                background: "color-mix(in oklch, var(--warn) 10%, transparent)",
                whiteSpace: "nowrap",
              }}
            >
              Approval required
            </span>
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
              {empLabel && <span><bdi>{empLabel}</bdi></span>}
              {subContext && (
                <>
                  <span style={{ color: "var(--text-subtle)" }}>·</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    <Icons.Refresh size={11} />
                    {routineName ? <bdi>{routineName}</bdi> : subContext}
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
                  marginBottom: "var(--sp-2)",
                }}
              >
                <bdi>{describeTool((current as LiveApproval).toolName)}</bdi>
              </div>
              {describeTool((current as LiveApproval).toolName) !== (current as LiveApproval).toolName && (
              <div
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "var(--fs-2xs)",
                  color: "var(--text-subtle)",
                  marginBottom: "var(--sp-8)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={(current as LiveApproval).toolName}
              >
                {(current as LiveApproval).toolName}
              </div>
              )}
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
                    <ApprovalArgs input={(current as LiveApproval).input} />
                  )}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: "var(--sp-8)",
                  borderTop: "1px solid var(--hairline)",
                  margin: "var(--sp-4) calc(-1 * var(--sp-20)) 0",
                  padding: "var(--sp-14) var(--sp-20) 0",
                }}
              >
                <motion.button
                  whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  onClick={() => {
                    if (isEditing) {
                      try {
                        const parsed = JSON.parse(editedText);
                        resolveLive(key, "allow", parsed);
                      } catch {
                        alert(t("inbox.overlay.badJson"));
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
                    borderRadius: 10,
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
                  {t("inbox.approve")}
                </motion.button>
                <button
                  onClick={() => setEditing((m) => ({ ...m, [key]: !m[key] }))}
                  disabled={busy}
                  style={{
                    padding: "8px 14px",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 10,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {isEditing ? t("inbox.overlay.cancelEdit") : t("inbox.overlay.edit")}
                </button>
                <button
                  onClick={() => resolveLive(key, "deny")}
                  disabled={busy}
                  style={{
                    padding: "8px 14px",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 10,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 500,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {t("inbox.overlay.skip")}
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
                <bdi>{(current as FeedReview).title}</bdi>
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
                  <bdi>{(current as FeedReview).detail}</bdi>
                </p>
              )}

              <div style={{ display: "flex", gap: "var(--sp-8)" }}>
                <button
                  onClick={() =>
                    rerunRoutineId ? rerunRoutine(key, rerunRoutineId) : resolveFeed(key, "approved")
                  }
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
                  {rerunRoutineId ? <Icons.Arrow size={13} /> : <Icons.Check size={13} />}
                  {rerunRoutineId ? t("inbox.runRoutineAgain") : t("inbox.approve")}
                </button>
                {!rerunRoutineId && (
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
                    {t("inbox.reject")}
                  </button>
                )}
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
                  {t("inbox.dismiss")}
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

// Pending approvals = live tool-call approvals + open needs-review feed items.
// Shared poll with GlobalApprovalOverlay (pending-review-poll.ts).
export function usePendingApprovalCount(): number {
  return useSyncExternalStore(
    subscribePendingReviewPoll,
    () => getPendingReviewPollSnapshot().count,
    () => 0,
  );
}

export function NotificationBell({ count }: { count: number }) {
  const { t } = useT();
  const title =
    count === 0
      ? t("shell.bell.notifications")
      : count === 1
        ? t("shell.bell.pendingOne", { count })
        : t("shell.bell.pendingMany", { count });
  return (
    <button
      className="btn ghost"
      style={{ height: 22, width: 22, padding: 0, justifyContent: "center", position: "relative" }}
      title={title}
    >
      <Icons.Bell size={13} />
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            top: -3,
            insetInlineEnd: -3,
            minWidth: 14,
            height: 14,
            padding: "0 3px",
            borderRadius: 999,
            background: "var(--warn)",
            color: "var(--bg)",
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
