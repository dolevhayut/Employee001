"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { PageHead } from "@/components/ex/page-head";
import { useRoster } from "@/components/ex/roster-context";
import { EmployeePicker } from "@/components/ex/employee-picker";
import type { Routine, Schedule, RoutineRunStatus } from "@/lib/routines";
import { isValidCron } from "@/lib/cron";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function describeSchedule(s: Schedule): string {
  if (s.type === "interval") return `every ${s.minutes} min${s.minutes === 1 ? "" : "s"}`;
  if (s.type === "daily") return `daily at ${s.time}`;
  if (s.type === "cron") return `cron: ${s.expr}`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[s.day]} at ${s.time}`;
}

function relTime(ts?: string): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const abs = Math.abs(diff);
  const sign = diff < 0 ? "in " : "";
  const suffix = diff < 0 ? "" : " ago";
  if (abs < 60_000) return diff < 0 ? "in <1 min" : "just now";
  if (abs < 3_600_000) return `${sign}${Math.floor(abs / 60_000)}m${suffix}`;
  if (abs < 86_400_000) return `${sign}${Math.floor(abs / 3_600_000)}h${suffix}`;
  return new Date(ts).toLocaleString();
}

const STATUS_META: Record<RoutineRunStatus, { label: string; color: string; bg: string }> = {
  ok:              { label: "Completed",       color: "#16a34a", bg: "#dcfce7" },
  needs_approval:  { label: "Awaiting CEO",    color: "#b45309", bg: "#fef3c7" },
  denied:          { label: "Declined",        color: "#9333ea", bg: "#f3e8ff" },
  error:           { label: "Failed",           color: "#dc2626", bg: "#fee2e2" },
  skipped:         { label: "Skipped",         color: "#64748b", bg: "#f1f5f9" },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RoutinesPage() {
  const roster = useRoster();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [detailRoutine, setDetailRoutine] = useState<Routine | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch("/api/routines", { cache: "no-store" });
    setRoutines(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/routines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this routine?")) return;
    await fetch(`/api/routines/${id}`, { method: "DELETE" });
    load();
  }

  // Track which routines are currently running. The POST returns immediately
  // (the routine runs fire-and-forget in the background), so without this the
  // button has no visible feedback and the list reloads before the run has
  // actually completed.
  const [running, setRunning] = useState<Set<string>>(new Set());

  async function runNow(id: string) {
    if (running.has(id)) return;
    setRunning((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/routines/${id}/run`, { method: "POST" });
    } catch {
      // Surface as toast? For now we silently drop — the polling below will
      // pick up whatever the routine actually wrote (status: error if it
      // bombed). The button stays in "running" until lastRunAt advances.
    }

    // Poll for completion: the routine emits text deltas + tool calls in the
    // background and only updates `lastRunAt` when it's done. We snapshot the
    // current lastRunAt, poll every 2.5s for up to 3 minutes, and clear the
    // running flag once we see a newer timestamp.
    const before = await fetch(`/api/routines`, { cache: "no-store" })
      .then((r) => r.json() as Promise<Routine[]>)
      .then((all) => all.find((r) => r.id === id)?.lastRunAt ?? null)
      .catch(() => null);
    const deadline = Date.now() + 3 * 60 * 1000;
    const tick = async () => {
      try {
        const list = (await fetch(`/api/routines`, { cache: "no-store" }).then(
          (r) => r.json(),
        )) as Routine[];
        const r = list.find((x) => x.id === id);
        if (r && r.lastRunAt && r.lastRunAt !== before) {
          setRunning((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          load();
          return;
        }
      } catch {
        // ignore transient errors; keep polling until the deadline
      }
      if (Date.now() < deadline) {
        setTimeout(tick, 2500);
      } else {
        // Give up — clear the spinner so the user can retry.
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        load();
      }
    };
    setTimeout(tick, 2500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={["Routines"]}
        actions={
          <button
            className="btn primary sm"
            onClick={() => setShowCreate(true)}
            style={{ height: 28 }}
          >
            <Icons.Plus size={12} /> New routine
          </button>
        }
      />

      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <PageHead
          icon="Refresh"
          title="Routines"
          subtitle="Schedule background work for a twin (tasks or autonomous shifts). Review last runs, statuses, and trigger a run now."
          style={{ marginBottom: "var(--sp-16)", maxWidth: 880 }}
        />
        {/* Empty / loading */}
        {!loading && routines.length === 0 && (
          <div
            style={{
              maxWidth: 560,
              margin: "60px auto 0",
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            <Icons.Refresh size={28} style={{ opacity: 0.3, marginBottom: "var(--sp-12)" }} />
            <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color: "var(--text)", margin: "0 0 6px" }}>
              No routines yet
            </h2>
            <p style={{ fontSize: "var(--fs-ui)", lineHeight: 1.55, margin: "0 0 16px" }}>
              Routines run a twin in the background on a schedule. Free-form task — the agent figures out
              which tools to use. Approvals are queued and surfaced as a global popup.
            </p>
            <button className="btn primary" onClick={() => setShowCreate(true)}>
              <Icons.Plus size={13} /> Create your first routine
            </button>
          </div>
        )}

        {/* Routines list */}
        {routines.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)", maxWidth: 880 }}>
            {routines.map((r) => {
              const employee = roster.find((e) => e.id === r.employeeId);
              const status = r.lastRunStatus ? STATUS_META[r.lastRunStatus] : null;
              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 10,
                    padding: "var(--sp-16)",
                    opacity: r.enabled ? 1 : 0.65,
                  }}
                >
                  {/* Header row */}
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-8)" }}>
                    {employee && (
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          background: employee.avatarColor,
                          display: "grid",
                          placeItems: "center",
                          fontSize: "var(--fs-xs)",
                          fontWeight: 700,
                          color: "var(--text)",
                          flexShrink: 0,
                        }}
                      >
                        {employee.initials}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text)" }}>
                        {r.name}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--fs-meta)",
                          color: "var(--text-muted)",
                          marginTop: "var(--sp-2)",
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--sp-8)",
                        }}
                      >
                        <span>{employee?.firstName ?? r.employeeId}</span>
                        <span style={{ color: "var(--text-subtle)" }}>·</span>
                        <span>{describeSchedule(r.schedule)}</span>
                        {r.kind === "shift" && (
                          <span
                            style={{
                              padding: "1px 6px",
                              fontSize: "var(--fs-2xs)",
                              fontWeight: 700,
                              borderRadius: 999,
                              background: "var(--bg-sunken)",
                              color: "var(--text-muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            shift
                          </span>
                        )}
                        <span style={{ color: "var(--text-subtle)" }}>·</span>
                        <span>next {relTime(r.nextRunAt)}</span>
                      </div>
                    </div>
                    {status && (
                      <span
                        style={{
                          padding: "2px 8px",
                          fontSize: "var(--fs-xs)",
                          fontWeight: 600,
                          borderRadius: 999,
                          background: status.bg,
                          color: status.color,
                        }}
                      >
                        {status.label}
                      </span>
                    )}
                  </div>

                  {/* Task */}
                  <p
                    style={{
                      fontSize: "var(--fs-sm)",
                      color: "var(--text-muted)",
                      margin: "0 0 10px",
                      padding: "8px 10px",
                      background: "var(--bg-sunken)",
                      borderRadius: 6,
                      lineHeight: 1.5,
                    }}
                  >
                    {r.task}
                  </p>

                  {/* Last run summary */}
                  {r.lastRunSummary && (
                    <button
                      onClick={() => setDetailRoutine(r)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: "6px 10px",
                        marginBottom: "var(--sp-10)",
                        borderLeft: "2px solid var(--hairline)",
                        cursor: "pointer",
                        position: "relative",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = "var(--accent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = "var(--hairline)"; }}
                    >
                      <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginBottom: "var(--sp-3)", display: "flex", alignItems: "center", gap: "var(--sp-6)" }}>
                        <strong style={{ color: "var(--text)" }}>Last run {relTime(r.lastRunAt)}</strong>
                        <span style={{ flex: 1 }} />
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", color: "var(--accent)" }}>
                          View details <Icons.Chevron size={9} />
                        </span>
                      </div>
                      <div
                        className="md-body md-compact"
                        style={{
                          fontSize: "var(--fs-sm)",
                          color: "var(--text-muted)",
                          lineHeight: 1.55,
                          maxHeight: 64,
                          overflow: "hidden",
                          maskImage: "linear-gradient(to bottom, black 60%, transparent)",
                          WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent)",
                        }}
                      >
                        <Markdown>{r.lastRunSummary}</Markdown>
                      </div>
                    </button>
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "var(--sp-6)", alignItems: "center" }}>
                    <button
                      onClick={() => runNow(r.id)}
                      className="btn sm"
                      disabled={running.has(r.id)}
                      style={{ height: 26, opacity: running.has(r.id) ? 0.7 : 1, cursor: running.has(r.id) ? "wait" : "pointer" }}
                    >
                      {running.has(r.id) ? (
                        <Icons.Loader size={11} style={{ animation: "spin 1s linear infinite" }} />
                      ) : (
                        <Icons.Arrow size={11} />
                      )}
                      {running.has(r.id) ? "Running…" : "Run now"}
                    </button>
                    <button
                      onClick={() => toggle(r.id, !r.enabled)}
                      className="btn sm"
                      style={{ height: 26 }}
                    >
                      {r.enabled ? "Pause" : "Resume"}
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      onClick={() => remove(r.id)}
                      className="btn ghost sm"
                      style={{ height: 26, color: "var(--danger)" }}
                    >
                      <Icons.X size={11} />
                      Delete
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <CreateRoutineModal
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              load();
            }}
          />
        )}
      </AnimatePresence>

      {/* Detail modal */}
      <AnimatePresence>
        {detailRoutine && (
          <RoutineDetailModal
            routine={detailRoutine}
            onClose={() => setDetailRoutine(null)}
            onRunNow={async () => {
              await runNow(detailRoutine.id);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Routine detail modal ─────────────────────────────────────────────────────

type ShiftOutput = {
  ts: string;
  tool: string;
  kind?: string;
  urls?: string[];
  path?: string;
  note?: string;
};
type ShiftArtifact = { name: string; relativePath: string; sizeBytes: number };
type ShiftManifest = {
  runId: string;
  trigger?: string;
  startedAt?: string;
  endedAt?: string;
  status?: string;
  summary?: string;
  outputCount?: number;
  costUsd?: number;
  turns?: number;
  approvals?: Array<{ tool: string; decision: string }>;
};
type ShiftArchiveData = {
  manifest: ShiftManifest | null;
  outputs: ShiftOutput[];
  artifacts: ShiftArtifact[];
};
type ArchiveEvent = {
  ts: string;
  kind: "meta" | "text" | "thinking" | "tool_use" | "tool_result" | "approval_request" | "approval" | "done";
  message?: string;
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  urls?: string[];
  reason?: string;
  decision?: string;
  summary?: string;
};

function RoutineDetailModal({
  routine,
  onClose,
  onRunNow,
}: {
  routine: Routine;
  onClose: () => void;
  onRunNow: () => Promise<void>;
}) {
  const employee = useRoster().find((e) => e.id === routine.employeeId);
  const status = routine.lastRunStatus ? STATUS_META[routine.lastRunStatus] : null;

  // Shift history + archive (shift-kind routines only)
  const [history, setHistory] = useState<ShiftManifest[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(routine.lastRunId);
  const [shiftData, setShiftData] = useState<ShiftArchiveData | null>(null);
  const [openArtifact, setOpenArtifact] = useState<{ name: string; content: string } | null>(null);
  const [events, setEvents] = useState<ArchiveEvent[] | null>(null);
  const [showLog, setShowLog] = useState(false);

  // Load the run history for this twin.
  useEffect(() => {
    if (routine.kind !== "shift") return;
    fetch(`/api/shifts?employeeId=${routine.employeeId}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ShiftManifest[]>) : []))
      .then((list) => {
        setHistory(list);
        setSelectedRunId((cur) => cur ?? list[0]?.runId);
      })
      .catch(() => {});
  }, [routine.kind, routine.employeeId]);

  // Load the archive for the selected run.
  useEffect(() => {
    if (routine.kind !== "shift" || !selectedRunId) return;
    setShiftData(null);
    fetch(`/api/shifts/${selectedRunId}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ShiftArchiveData>) : null))
      .then((d) => { if (d) setShiftData(d); })
      .catch(() => {});
  }, [routine.kind, selectedRunId]);

  // Reset the activity log when switching runs.
  useEffect(() => { setEvents(null); setShowLog(false); }, [selectedRunId]);

  async function loadEvents() {
    setShowLog(true);
    if (events || !selectedRunId) return;
    try {
      const r = await fetch(`/api/shifts/${selectedRunId}?events=1`, { cache: "no-store" });
      if (r.ok) { const d = await r.json() as { events: ArchiveEvent[] }; setEvents(d.events ?? []); }
    } catch { /* ignore */ }
  }

  const selectedManifest = shiftData?.manifest ?? history.find((h) => h.runId === selectedRunId);
  const displaySummary = selectedManifest?.summary ?? routine.lastRunSummary;

  async function viewArtifact(artifact: ShiftArtifact) {
    if (!selectedRunId) return;
    try {
      const r = await fetch(`/api/shifts/${selectedRunId}?artifact=${encodeURIComponent(artifact.name)}`);
      if (!r.ok) return;
      const { content } = await r.json() as { content: string };
      setOpenArtifact({ name: artifact.name, content });
    } catch { /* ignore */ }
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
          maxWidth: 720,
          maxHeight: "85vh",
          background: "var(--bg-elevated)",
          borderRadius: 12,
          border: "1px solid var(--hairline)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px 14px",
            borderBottom: "1px solid var(--hairline)",
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--sp-12)",
          }}
        >
          {employee && (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: employee.avatarColor,
                display: "grid",
                placeItems: "center",
                fontSize: "var(--fs-meta)",
                fontWeight: 700,
                color: "var(--text)",
                flexShrink: 0,
              }}
            >
              {employee.initials}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{routine.name}</h2>
            <div
              style={{
                fontSize: "var(--fs-sm)",
                color: "var(--text-muted)",
                marginTop: "var(--sp-4)",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-8)",
                flexWrap: "wrap",
              }}
            >
              <span>{employee?.name ?? routine.employeeId}</span>
              <span style={{ color: "var(--text-subtle)" }}>·</span>
              <span>{describeSchedule(routine.schedule)}</span>
              <span style={{ color: "var(--text-subtle)" }}>·</span>
              <span>last run {relTime(routine.lastRunAt)}</span>
              {status && (
                <span
                  style={{
                    padding: "1px 7px",
                    fontSize: "var(--fs-xs)",
                    fontWeight: 600,
                    borderRadius: 999,
                    background: status.bg,
                    color: status.color,
                  }}
                >
                  {status.label}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn ghost sm" style={{ height: 26, flexShrink: 0 }}>
            <Icons.X size={12} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "16px 24px 20px" }}>
          {/* Task / mandate */}
          <div style={{ marginBottom: "var(--sp-20)" }}>
            <div
              style={{
                fontSize: "var(--fs-meta)",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: "var(--sp-6)",
              }}
            >
              {routine.kind === "shift" ? "Mandate" : "Task"}
            </div>
            <div
              style={{
                fontSize: "var(--fs-ui)",
                color: routine.task?.trim() ? "var(--text)" : "var(--text-muted)",
                padding: "10px 12px",
                background: "var(--bg-sunken)",
                borderRadius: 6,
                lineHeight: 1.55,
                fontStyle: routine.task?.trim() ? "normal" : "italic",
              }}
            >
              {routine.task?.trim()
                ? routine.task
                : routine.kind === "shift"
                  ? `Autonomous shift — no fixed task. ${employee?.firstName ?? "The twin"} reviews its shift memory (context, decisions, learnings, pending tasks) and its profile, then picks its own actions each run.`
                  : "No task specified."}
            </div>
          </div>

          {/* Shift history */}
          {routine.kind === "shift" && history.length > 0 && (
            <div style={{ marginBottom: "var(--sp-20)" }}>
              <div
                style={{
                  fontSize: "var(--fs-meta)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: "var(--sp-6)",
                }}
              >
                Shift history
                <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6, opacity: 0.6 }}>
                  ({history.length})
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", maxHeight: 200, overflowY: "auto" }} className="scrollbar">
                {history.map((h) => {
                  const sel = h.runId === selectedRunId;
                  const st = h.status === "complete" ? { c: "#22C55E", l: "done" }
                    : h.status === "error" ? { c: "#EF4444", l: "error" }
                    : { c: "#F59E0B", l: h.status ?? "running" };
                  return (
                    <button
                      key={h.runId}
                      type="button"
                      onClick={() => setSelectedRunId(h.runId)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--sp-10)",
                        padding: "8px 10px",
                        background: sel ? "var(--bg-sunken)" : "transparent",
                        border: `1px solid ${sel ? "var(--hairline)" : "transparent"}`,
                        borderRadius: 6,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                        width: "100%",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = "var(--bg-sunken)"; }}
                      onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.c, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.summary ?? "(no summary)"}
                        </div>
                        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                          {relTime(h.startedAt)} · {st.l}
                          {h.trigger ? ` · ${h.trigger}` : ""}
                        </div>
                      </div>
                      {(h.outputCount ?? 0) > 0 && (
                        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", fontWeight: 600, flexShrink: 0 }}>
                          {h.outputCount} 📎
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected-run response */}
          {displaySummary && (
            <div>
              <div
                style={{
                  fontSize: "var(--fs-meta)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: "var(--sp-6)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-8)",
                }}
              >
                {selectedManifest && history.length > 1 ? "Run summary" : "Latest response"}
                {selectedManifest?.startedAt && (
                  <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-subtle)" }}>
                    · {relTime(selectedManifest.startedAt)}
                  </span>
                )}
              </div>
              <div
                style={{
                  padding: "14px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 8,
                  fontSize: "var(--fs-base)",
                  color: "var(--text)",
                  lineHeight: 1.6,
                }}
              >
                <Markdown>{displaySummary}</Markdown>
              </div>
            </div>
          )}

          {/* Deliverables — shift archive */}
          {routine.kind === "shift" && shiftData && (shiftData.outputs.length > 0 || shiftData.artifacts.length > 0) && (
            <div style={{ marginTop: "var(--sp-20)" }}>
              <div
                style={{
                  fontSize: "var(--fs-meta)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: "var(--sp-8)",
                }}
              >
                Deliverables
                <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6, opacity: 0.6 }}>
                  ({shiftData.outputs.length + shiftData.artifacts.length})
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
                {/* artifacts first (written docs) */}
                {shiftData.artifacts.map((a) => (
                  <button
                    key={a.relativePath}
                    type="button"
                    onClick={() => viewArtifact(a)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-10)",
                      padding: "10px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--hairline)",
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                      width: "100%",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-sunken)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" }}>
                        {a.name.replace(/\.md$/, "")}
                      </div>
                      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                        Markdown document · {(a.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--accent, var(--text-muted))", fontWeight: 600, flexShrink: 0 }}>
                      View →
                    </span>
                  </button>
                ))}
                {/* other outputs (urls, files, links) — exclude ones already
                    shown as openable artifacts above */}
                {shiftData.outputs
                  .filter((o) => !o.path || !shiftData.artifacts.some((a) => o.path === a.relativePath))
                  .map((o, i) => {
                    const kindEmoji = o.kind === "image" ? "🖼️" : o.kind === "video" ? "🎬" : o.kind === "link" ? "🔗" : o.kind === "document" ? "📄" : "📎";
                    const href = o.urls?.[0];
                    return (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--sp-10)",
                          padding: "10px 12px",
                          background: "var(--surface)",
                          border: "1px solid var(--hairline)",
                          borderRadius: 8,
                        }}
                      >
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{kindEmoji}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" }}>
                            {o.note ?? o.tool}
                          </div>
                          {(href ?? o.path) && (
                            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {href ?? o.path}
                            </div>
                          )}
                        </div>
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: "var(--fs-xs)", color: "var(--accent, var(--text-muted))", fontWeight: 600, flexShrink: 0, textDecoration: "none" }}
                          >
                            Open →
                          </a>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Activity log — full run timeline (thinking, tools, results) */}
          {routine.kind === "shift" && selectedRunId && (
            <div style={{ marginTop: "var(--sp-20)" }}>
              <button
                type="button"
                onClick={() => (showLog ? setShowLog(false) : loadEvents())}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-6)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "var(--fs-meta)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  fontFamily: "inherit",
                }}
              >
                <Icons.Chevron size={10} style={{ transform: showLog ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                Activity log
                <span style={{ fontWeight: 400, textTransform: "none", opacity: 0.6 }}>
                  — thinking, tools &amp; results
                </span>
              </button>

              {showLog && (
                <div
                  className="scrollbar"
                  style={{
                    marginTop: "var(--sp-10)",
                    maxHeight: 360,
                    overflowY: "auto",
                    borderLeft: "2px solid var(--hairline)",
                    paddingLeft: "var(--sp-12)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--sp-8)",
                  }}
                >
                  {events === null && (
                    <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>Loading…</div>
                  )}
                  {events?.length === 0 && (
                    <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>No activity recorded.</div>
                  )}
                  {events?.map((e, i) => <LogRow key={i} e={e} />)}
                </div>
              )}
            </div>
          )}

          {/* Artifact viewer overlay */}
          {openArtifact && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,18,24,0.7)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: "var(--sp-24)" }}
              onClick={() => setOpenArtifact(null)}
            >
              <div
                style={{ width: "100%", maxWidth: 760, maxHeight: "80vh", background: "var(--bg-elevated)", borderRadius: 12, border: "1px solid var(--hairline)", display: "flex", flexDirection: "column", overflow: "hidden" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>📄 {openArtifact.name.replace(/\.md$/, "")}</span>
                  <button onClick={() => setOpenArtifact(null)} className="btn ghost sm"><Icons.X size={12} /></button>
                </div>
                <div className="scrollbar md-body" style={{ flex: 1, overflow: "auto", padding: "16px 24px 20px" }}>
                  <Markdown>{openArtifact.content}</Markdown>
                </div>
              </div>
            </div>
          )}

          {!routine.lastRunSummary && (
            <p style={{ fontSize: "var(--fs-ui)", color: "var(--text-subtle)", margin: 0 }}>
              This routine hasn&apos;t produced a response yet. Click <strong>Run now</strong> to fire it.
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--hairline)",
            display: "flex",
            gap: "var(--sp-8)",
            background: "var(--bg-sunken)",
          }}
        >
          <button onClick={onRunNow} className="btn primary sm">
            <Icons.Arrow size={11} />
            Run now
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="btn sm">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Activity-log row ─────────────────────────────────────────────────────────

function LogRow({ e }: { e: ArchiveEvent }) {
  const meta = (label: string, color: string) => (
    <span style={{ fontSize: "var(--fs-2xs)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color }}>
      {label}
    </span>
  );
  const wrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3 };
  const bodyText: React.CSSProperties = { fontSize: "var(--fs-sm)", color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" };
  const subtle: React.CSSProperties = { ...bodyText, color: "var(--text-muted)" };

  switch (e.kind) {
    case "thinking":
      return (
        <div style={wrap}>
          {meta("💭 Thinking", "var(--text-subtle)")}
          <span style={{ ...subtle, fontStyle: "italic" }}>{e.text}</span>
        </div>
      );
    case "text":
      return (
        <div style={wrap}>
          {meta("🗣 Twin", "var(--accent-deep, var(--text-muted))")}
          <span style={bodyText}>{e.text}</span>
        </div>
      );
    case "tool_use":
      return (
        <div style={wrap}>
          {meta(`🔧 Tool · ${e.tool}`, "#3B82F6")}
          {e.input && Object.keys(e.input).length > 0 && (
            <pre style={{ margin: 0, fontSize: "var(--fs-2xs)", color: "var(--text-muted)", background: "var(--bg-sunken)", padding: "6px 8px", borderRadius: 5, overflow: "auto", maxHeight: 120 }}>
              {JSON.stringify(e.input, null, 2)}
            </pre>
          )}
        </div>
      );
    case "tool_result":
      return (
        <div style={wrap}>
          {meta(`✓ Result · ${e.tool}`, "#22C55E")}
          {e.output && <span style={{ ...subtle, fontSize: "var(--fs-2xs)" }}>{e.output.slice(0, 600)}</span>}
        </div>
      );
    case "approval_request":
      return (
        <div style={wrap}>
          {meta(`⏳ Approval requested · ${e.tool}`, "#F59E0B")}
          {e.reason && <span style={subtle}>{e.reason}</span>}
        </div>
      );
    case "approval":
      return (
        <div style={wrap}>
          {meta(`${e.decision === "allow" ? "✅ Approved" : "🚫 Declined"} · ${e.tool}`, e.decision === "allow" ? "#22C55E" : "#EF4444")}
        </div>
      );
    case "done":
      return <div style={wrap}>{meta("■ Shift ended", "var(--text-subtle)")}</div>;
    case "meta":
    default:
      return <div style={wrap}><span style={{ ...subtle, fontSize: "var(--fs-2xs)" }}>{e.message ?? e.text}</span></div>;
  }
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateRoutineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const roster = useRoster();
  const ready = roster.filter((e) => e.twinStatus === "ready");
  const [employeeId, setEmployeeId] = useState<string>(ready[0]?.id ?? roster[0]?.id ?? "");

  // Sync default when roster hydrates after mount (initial render had an empty roster).
  useEffect(() => {
    if (employeeId) return;
    const next = ready[0]?.id ?? roster[0]?.id;
    if (next) setEmployeeId(next);
  }, [employeeId, ready, roster]);
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [scheduleType, setScheduleType] = useState<"daily" | "weekly" | "interval" | "cron">("daily");
  const [time, setTime] = useState("10:00");
  const [day, setDay] = useState(1); // Mon
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [cronExpr, setCronExpr] = useState("0 9 * * 1-5"); // weekdays at 9:00
  const [kind, setKind] = useState<"task" | "shift">("task");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const cronValid = scheduleType !== "cron" || isValidCron(cronExpr);

  async function submit() {
    if (!name.trim() || (kind === "task" && !task.trim())) {
      setError("Name and task are required.");
      return;
    }
    if (scheduleType === "cron" && !isValidCron(cronExpr)) {
      setError("Invalid cron expression. Use 5 fields: min hour dom month dow.");
      return;
    }
    setSubmitting(true);
    setError("");

    let schedule: Schedule;
    if (scheduleType === "interval") schedule = { type: "interval", minutes: intervalMinutes };
    else if (scheduleType === "weekly") schedule = { type: "weekly", day, time };
    else if (scheduleType === "cron") schedule = { type: "cron", expr: cronExpr.trim() };
    else schedule = { type: "daily", time };

    try {
      const res = await fetch("/api/routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, name, task, kind, schedule, enabled: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
      setSubmitting(false);
    }
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
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--sp-18)" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>New routine</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="btn ghost sm" style={{ height: 26 }}>
            <Icons.X size={12} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-12)" }}>
          <Field label="Kind">
            <div style={{ display: "flex", gap: "var(--sp-6)" }}>
              {(["task", "shift"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 5,
                    border: "1px solid var(--hairline)",
                    background: kind === k ? "var(--text)" : "var(--surface)",
                    color: kind === k ? "var(--bg)" : "var(--text-muted)",
                    fontSize: "var(--fs-sm)",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {k === "task" ? "Task" : "Shift (autonomous)"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Employee">
            <EmployeePicker
              value={employeeId}
              onSelect={setEmployeeId}
              navigate={false}
            />
          </Field>

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily GitHub digest"
              style={inputStyle}
            />
          </Field>

          {kind === "task" && (
            <Field label="Task (free-form)">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Send me a daily summary email with all open GitHub issues assigned to me."
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </Field>
          )}

          {kind === "shift" && (
            <div
              style={{
                fontSize: "var(--fs-sm)",
                color: "var(--text-muted)",
                padding: "10px 12px",
                background: "var(--bg-sunken)",
                borderRadius: 6,
                lineHeight: 1.55,
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-6)",
              }}
            >
              <div>
                Each scheduled fire is <strong>one autonomous run</strong> (typically
                a few minutes — not a long-lived background process). The twin
                opens its shift memory — context, decisions, learnings, pending
                tasks from other twins — and picks its own actions.
              </div>
              <div>
                State <strong>accumulates across runs</strong>: today's decisions and
                learnings are visible to tomorrow's shift. For continuous
                autonomy, use <em>Every N min</em> with a small interval.
              </div>
            </div>
          )}

          <Field label="Schedule">
            <div style={{ display: "flex", gap: "var(--sp-6)" }}>
              {(["daily", "weekly", "interval", "cron"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setScheduleType(t)}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 5,
                    border: "1px solid var(--hairline)",
                    background: scheduleType === t ? "var(--text)" : "var(--surface)",
                    color: scheduleType === t ? "var(--bg)" : "var(--text-muted)",
                    fontSize: "var(--fs-sm)",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {t === "interval"
                    ? "Every N min"
                    : t === "cron"
                      ? "Cron"
                      : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Field>

          {(scheduleType === "daily" || scheduleType === "weekly") && (
            <Field label="Time">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
            </Field>
          )}

          {scheduleType === "weekly" && (
            <Field label="Day">
              <select value={day} onChange={(e) => setDay(parseInt(e.target.value, 10))} style={selectStyle}>
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </Field>
          )}

          {scheduleType === "interval" && (
            <Field label="Every (minutes)">
              <input
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={inputStyle}
              />
            </Field>
          )}

          {scheduleType === "cron" && (
            <Field label="Cron expression">
              <input
                type="text"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * 1-5"
                style={{
                  ...inputStyle,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  borderColor: cronValid ? "var(--hairline)" : "var(--danger)",
                }}
              />
              <div
                style={{
                  fontSize: "var(--fs-meta)",
                  color: cronValid ? "var(--text-subtle)" : "var(--danger)",
                  marginTop: "var(--sp-4)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {cronValid
                  ? "min hour dom month dow · supports *, N, N-M, N,M, */N"
                  : "Invalid — use 5 fields, e.g. \"0 9 * * 1-5\""}
              </div>
            </Field>
          )}
        </div>

        {error && (
          <div style={{ marginTop: "var(--sp-12)", fontSize: "var(--fs-sm)", color: "var(--danger)" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: "var(--sp-8)", justifyContent: "flex-end", marginTop: "var(--sp-20)" }}>
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={submit} disabled={submitting} className="btn primary">
            {submitting ? "Creating…" : "Create routine"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Form bits ────────────────────────────────────────────────────────────────

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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <span style={{ fontSize: "var(--fs-meta)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
