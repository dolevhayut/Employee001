"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { PageHead } from "@/components/ex/page-head";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
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

  async function runNow(id: string) {
    await fetch(`/api/routines/${id}/run`, { method: "POST" });
    setTimeout(load, 800);
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
              const employee = EMPLOYEES_WITH_TWIN.find((e) => e.id === r.employeeId);
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
                      style={{ height: 26 }}
                    >
                      <Icons.Arrow size={11} />
                      Run now
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

function RoutineDetailModal({
  routine,
  onClose,
  onRunNow,
}: {
  routine: Routine;
  onClose: () => void;
  onRunNow: () => Promise<void>;
}) {
  const employee = EMPLOYEES_WITH_TWIN.find((e) => e.id === routine.employeeId);
  const status = routine.lastRunStatus ? STATUS_META[routine.lastRunStatus] : null;

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
          {/* Task */}
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
              Task
            </div>
            <div
              style={{
                fontSize: "var(--fs-ui)",
                color: "var(--text)",
                padding: "10px 12px",
                background: "var(--bg-sunken)",
                borderRadius: 6,
                lineHeight: 1.55,
              }}
            >
              {routine.task}
            </div>
          </div>

          {/* Last run */}
          {routine.lastRunSummary && (
            <div>
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
                Latest response
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
                <Markdown>{routine.lastRunSummary}</Markdown>
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

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateRoutineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const ready = EMPLOYEES_WITH_TWIN.filter((e) => e.twinStatus === "ready");
  const [employeeId, setEmployeeId] = useState(ready[0]?.id ?? EMPLOYEES_WITH_TWIN[0].id);
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
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              style={selectStyle}
            >
              {EMPLOYEES_WITH_TWIN.map((e) => (
                <option key={e.id} value={e.id} disabled={e.twinStatus !== "ready"}>
                  {e.name} {e.twinStatus !== "ready" ? "(not ready)" : ""}
                </option>
              ))}
            </select>
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
                padding: "8px 10px",
                background: "var(--bg-sunken)",
                borderRadius: 6,
                lineHeight: 1.5,
              }}
            >
              The twin will read its shift state (context, decisions, learnings) and decide
              its own actions. No task prompt needed.
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
