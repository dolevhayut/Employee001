"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";

type PendingApproval = {
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

function describeTool(toolName: string): string {
  const stripped = toolName.replace(/^mcp__[a-z_]+__/, "");
  const parts = stripped.split("_");
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[0].slice(1).toLowerCase()}: ${parts.slice(1).join(" ").toLowerCase()}`;
  }
  return stripped;
}

export function GlobalApprovalOverlay() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [editedJson, setEditedJson] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Poll the approval bus every 2s for background-surface approvals
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/approvals/pending?surface=background", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as PendingApproval[];
        if (!cancelled) setPending(data);
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

  const resolve = useCallback(
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
        // Optimistically remove
        setPending((p) => p.filter((a) => a.approvalId !== approvalId));
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  if (!mounted) return null;
  if (pending.length === 0) return null;

  const current = pending[0]; // surface one at a time, queue the rest
  const employee = EMPLOYEES_WITH_TWIN.find((e) => e.id === current.employeeId);
  const isEditing = !!editing[current.approvalId];
  const editedText = editedJson[current.approvalId] ?? JSON.stringify(current.input, null, 2);

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
          key={current.approvalId}
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
            boxShadow: "0 20px 60px rgba(0,0,0,0.25), 0 0 0 6px color-mix(in srgb, var(--warn) 14%, transparent)",
          }}
        >
          {/* Queue indicator */}
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

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-4)" }}>
            <Icons.Lock size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--text)" }}>
              Approval needed
            </h2>
          </div>

          {/* Subhead with employee + context */}
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
            <span>
              {current.employeeName ?? employee?.name ?? current.employeeId}
            </span>
            {current.context?.type === "routine" && (
              <>
                <span style={{ color: "var(--text-subtle)" }}>·</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
                  <Icons.Refresh size={11} />
                  {current.context.routineName}
                </span>
              </>
            )}
          </div>

          {/* Tool name */}
          <div
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              color: "var(--text)",
              marginBottom: "var(--sp-6)",
            }}
          >
            {describeTool(current.toolName)}
          </div>

          {/* Reason */}
          <p
            style={{
              fontSize: "var(--fs-sm)",
              color: "var(--text-muted)",
              margin: "0 0 14px",
              lineHeight: 1.5,
            }}
          >
            {current.reason}
          </p>

          {/* Args */}
          {Object.keys(current.input).length > 0 && (
            <div style={{ marginBottom: "var(--sp-14)" }}>
              {isEditing ? (
                <textarea
                  value={editedText}
                  onChange={(e) =>
                    setEditedJson((m) => ({ ...m, [current.approvalId]: e.target.value }))
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
                  {JSON.stringify(current.input, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", gap: "var(--sp-8)" }}>
            <button
              onClick={() => {
                if (isEditing) {
                  try {
                    const parsed = JSON.parse(editedText);
                    resolve(current.approvalId, "allow", parsed);
                  } catch {
                    alert("Invalid JSON");
                  }
                } else {
                  resolve(current.approvalId, "allow");
                }
              }}
              disabled={busyId === current.approvalId}
              style={{
                flex: 1,
                padding: "8px 14px",
                background: "var(--text)",
                color: "var(--bg)",
                border: "none",
                borderRadius: 6,
                fontSize: "var(--fs-ui)",
                fontWeight: 600,
                cursor: busyId ? "not-allowed" : "pointer",
                opacity: busyId === current.approvalId ? 0.6 : 1,
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
              onClick={() =>
                setEditing((m) => ({ ...m, [current.approvalId]: !m[current.approvalId] }))
              }
              disabled={busyId === current.approvalId}
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
              onClick={() => resolve(current.approvalId, "deny")}
              disabled={busyId === current.approvalId}
              style={{
                padding: "8px 14px",
                background: "var(--surface)",
                color: "var(--text-muted)",
                border: "1px solid var(--hairline)",
                borderRadius: 6,
                fontSize: "var(--fs-ui)",
                fontWeight: 500,
                cursor: busyId ? "not-allowed" : "pointer",
                opacity: busyId === current.approvalId ? 0.6 : 1,
              }}
            >
              Skip
            </button>
          </div>
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
        const r = await fetch("/api/approvals/pending?surface=background", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as unknown[];
        if (!cancelled) setCount(data.length);
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
