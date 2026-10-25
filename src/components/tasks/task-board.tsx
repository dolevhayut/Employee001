"use client";

import { motion } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import type { EmployeeWithTwin } from "@/lib/employees";
import { formatRelativeTime } from "@/lib/i18n/format";

type TaskStatus = "running" | "complete" | "error" | "aborted";

type TaskRun = {
  id: string;
  employeeId: string;
  employeeName: string;
  task: string;
  startedAt: string;
  status: TaskStatus;
  toolCalls: number;
  approvalsRequested: number;
  approvalsApproved: number;
  approvalsDenied: number;
  blockedTools: number;
  costUsd?: number;
  stoppedReason?: "max_budget" | "max_turns" | "natural";
};

type BoardColumn = {
  status: TaskStatus;
  label: string;
  color: string;
  background: string;
};

const columns: BoardColumn[] = [
  { status: "running", label: "Running", color: "var(--warn)", background: "color-mix(in oklch, var(--warn) 12%, transparent)" },
  { status: "complete", label: "Complete", color: "var(--success)", background: "color-mix(in oklch, var(--success) 12%, transparent)" },
  { status: "error", label: "Error", color: "var(--danger)", background: "color-mix(in oklch, var(--danger) 12%, transparent)" },
  { status: "aborted", label: "Aborted", color: "var(--text-muted)", background: "var(--bg-elevated)" },
];

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function canRerun(run: TaskRun): boolean {
  return run.status === "error" || run.status === "aborted" || run.stoppedReason === "max_budget";
}

export function TaskBoard({
  runs,
  roster,
  locale,
  onOpen,
  onRerun,
}: {
  runs: TaskRun[];
  roster: EmployeeWithTwin[];
  locale: "en" | "he";
  onOpen: (run: TaskRun) => void;
  onRerun: (run: TaskRun) => void;
}) {
  return (
    <div
      className="scrollbar"
      style={{
        display: "flex",
        gap: "var(--sp-14)",
        overflowX: "auto",
        paddingBottom: "var(--sp-8)",
      }}
    >
      {columns.map((column) => {
        const columnRuns = runs.filter((run) => run.status === column.status);
        return (
          <section
            key={column.status}
            aria-label={`${column.label} tasks`}
            style={{
              width: 270,
              minWidth: 270,
              background: "var(--surface-soft)",
              border: "1px solid var(--hairline)",
              borderRadius: 10,
              padding: "var(--sp-10)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-8)",
                padding: "2px 2px var(--sp-10)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: column.color,
                }}
              />
              <h3 style={{ margin: 0, fontSize: "var(--fs-sm)", fontWeight: 600 }}>
                {column.label}
              </h3>
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  fontSize: "var(--fs-xs)",
                  color: "var(--text-muted)",
                  background: column.background,
                  borderRadius: 999,
                  padding: "2px 7px",
                }}
              >
                {columnRuns.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
              {columnRuns.length === 0 ? (
                <div
                  style={{
                    padding: "18px 10px",
                    textAlign: "center",
                    color: "var(--text-subtle)",
                    fontSize: "var(--fs-sm)",
                  }}
                >
                  Nothing here
                </div>
              ) : (
                columnRuns.map((run, index) => {
                  const employee = roster.find((item) => item.id === run.employeeId);
                  return (
                    <motion.div
                      key={run.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.16, delay: index * 0.025 }}
                      onClick={() => onOpen(run)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpen(run);
                        }
                      }}
                      onFocus={(event) => {
                        event.currentTarget.style.outline = "2px solid var(--accent)";
                        event.currentTarget.style.outlineOffset = "2px";
                      }}
                      onBlur={(event) => {
                        event.currentTarget.style.outline = "none";
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open task: ${run.task}`}
                      style={{
                        padding: "var(--sp-12)",
                        background: "var(--surface)",
                        border: "1px solid var(--hairline)",
                        borderRadius: 8,
                        cursor: "pointer",
                        outline: "none",
                      }}
                      whileHover={{ y: -1 }}
                    >
                      <div
                        style={{
                          fontSize: "var(--fs-sm)",
                          fontWeight: 600,
                          lineHeight: 1.4,
                          color: "var(--text)",
                          marginBottom: "var(--sp-10)",
                        }}
                      >
                        {run.task}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-7)" }}>
                        <div
                          aria-hidden="true"
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: employee?.avatarColor ?? "var(--bg-elevated)",
                            display: "grid",
                            placeItems: "center",
                            fontSize: "var(--fs-2xs)",
                            fontWeight: 700,
                            color: "var(--text)",
                            flexShrink: 0,
                          }}
                        >
                          {employee?.initials ?? "?"}
                        </div>
                        <span
                          style={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: "var(--text-muted)",
                            fontSize: "var(--fs-xs)",
                          }}
                        >
                          {employee?.name ?? run.employeeName}
                        </span>
                      </div>
                      <div
                        className="subtle"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--sp-7)",
                          marginTop: "var(--sp-10)",
                          fontSize: "var(--fs-xs)",
                        }}
                      >
                        <span>{formatRelativeTime(run.startedAt, locale)}</span>
                        {typeof run.costUsd === "number" && (
                          <>
                            <span>·</span>
                            <span className="mono">{formatCost(run.costUsd)}</span>
                          </>
                        )}
                        {canRerun(run) && (
                          <button
                            className="btn ghost sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRerun(run);
                            }}
                            style={{ marginLeft: "auto", height: 24, padding: "0 7px" }}
                          >
                            <Icons.Refresh size={10} /> Re-run
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
