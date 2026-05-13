"use client";

import { useState, useEffect, useCallback } from "react";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { EMPLOYEES_WITH_TWIN } from "@/lib/employees";
import type { AuditEntry, AuditVerdict } from "@/lib/audit-log";

// ─── Verdict helpers ──────────────────────────────────────────────────────────

const VERDICT_META: Record<
  AuditVerdict,
  { label: string; color: string; bg: string; dot: string }
> = {
  auto_allow: {
    label: "Auto-read",
    color: "var(--text-muted)",
    bg: "var(--surface-soft)",
    dot: "var(--text-subtle)",
  },
  ceo_approved: {
    label: "CEO approved",
    color: "#16a34a",
    bg: "#dcfce7",
    dot: "#16a34a",
  },
  ceo_denied: {
    label: "CEO denied",
    color: "#b45309",
    bg: "#fef3c7",
    dot: "#b45309",
  },
  hard_blocked: {
    label: "Blocked",
    color: "#dc2626",
    bg: "#fee2e2",
    dot: "#dc2626",
  },
  executed: {
    label: "Executed",
    color: "var(--text-muted)",
    bg: "var(--surface-soft)",
    dot: "#0ea5e9",
  },
  deferred_to_flow: {
    label: "Deferred →/flow",
    color: "#7c3aed",
    bg: "#ede9fe",
    dot: "#7c3aed",
  },
};

function VerdictBadge({ verdict }: { verdict: AuditVerdict }) {
  const m = VERDICT_META[verdict];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: "var(--fs-meta)",
        fontWeight: 600,
        background: m.bg,
        color: m.color,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: m.dot,
          flexShrink: 0,
        }}
      />
      {m.label}
    </span>
  );
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Employee avatar ──────────────────────────────────────────────────────────

function EmpAvatar({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const emp = EMPLOYEES_WITH_TWIN.find((e) => e.id === employeeId);
  const initials = emp?.initials ?? employeeName.slice(0, 2).toUpperCase();
  const color = emp?.avatarColor ?? "var(--surface)";
  return (
    <div
      title={employeeName}
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: color,
        display: "grid",
        placeItems: "center",
        fontSize: "var(--fs-2xs)",
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

// ─── Args cell ────────────────────────────────────────────────────────────────

function ArgsCell({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const keys = Object.keys(input);
  if (keys.length === 0) return <span style={{ color: "var(--text-subtle)", fontSize: "var(--fs-meta)" }}>—</span>;

  const preview = keys
    .slice(0, 2)
    .map((k) => {
      const v = input[k];
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${s.slice(0, 40)}${s.length > 40 ? "…" : ""}`;
    })
    .join(" · ");

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10.5,
          color: "var(--text-muted)",
          textAlign: "left",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
        }}
      >
        <Icons.Chevron
          size={10}
          style={{
            flexShrink: 0,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .12s",
          }}
        />
        {preview}
        {keys.length > 2 && (
          <span style={{ color: "var(--text-subtle)" }}>+{keys.length - 2} more</span>
        )}
      </button>
      {open && (
        <pre
          style={{
            marginTop: "var(--sp-6)",
            padding: "8px 10px",
            background: "var(--bg-sunken)",
            borderRadius: 6,
            fontSize: 10.5,
            lineHeight: 1.6,
            fontFamily: "var(--font-mono, monospace)",
            color: "var(--text)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterTool, setFilterTool] = useState("");
  const [filterVerdict, setFilterVerdict] = useState<AuditVerdict | "">("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterEmployee) params.set("employee", filterEmployee);
    if (filterTool) params.set("tool", filterTool);
    if (filterVerdict) params.set("verdict", filterVerdict);
    const res = await fetch(`/api/audit?${params}`);
    const data = await res.json();
    setEntries(data);
    setLoading(false);
  }, [filterEmployee, filterTool, filterVerdict]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Poll every 5 seconds so new entries appear without a refresh
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const isEmpty = !loading && entries.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={["Audit log"]}
        actions={
          <button
            className="btn ghost sm"
            onClick={() => load()}
            title="Refresh"
          >
            <Icons.Refresh size={13} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
          </button>
        }
      />

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-10)",
          padding: "10px 24px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        {/* Employee picker */}
        <select
          value={filterEmployee}
          onChange={(e) => setFilterEmployee(e.target.value)}
          style={{
            height: 30,
            padding: "0 8px",
            fontSize: "var(--fs-sm)",
            border: "1px solid var(--hairline)",
            borderRadius: 5,
            background: "var(--surface)",
            color: "var(--text)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <option value="">All employees</option>
          {EMPLOYEES_WITH_TWIN.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        {/* Tool search */}
        <div style={{ position: "relative" }}>
          <Icons.Search
            size={12}
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-subtle)",
              pointerEvents: "none",
            }}
          />
          <input
            value={filterTool}
            onChange={(e) => setFilterTool(e.target.value)}
            placeholder="Filter by tool…"
            style={{
              height: 30,
              paddingLeft: 26,
              paddingRight: "var(--sp-8)",
              fontSize: "var(--fs-sm)",
              border: "1px solid var(--hairline)",
              borderRadius: 5,
              background: "var(--surface)",
              color: "var(--text)",
              width: 180,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>

        {/* Verdict filter */}
        <select
          value={filterVerdict}
          onChange={(e) => setFilterVerdict(e.target.value as AuditVerdict | "")}
          style={{
            height: 30,
            padding: "0 8px",
            fontSize: "var(--fs-sm)",
            border: "1px solid var(--hairline)",
            borderRadius: 5,
            background: "var(--surface)",
            color: "var(--text)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <option value="">All verdicts</option>
          <option value="auto_allow">Auto-read</option>
          <option value="ceo_approved">CEO approved</option>
          <option value="ceo_denied">CEO denied</option>
          <option value="hard_blocked">Blocked</option>
        </select>

        <div style={{ marginLeft: "auto", fontSize: "var(--fs-meta)", color: "var(--text-subtle)" }}>
          {loading ? "Loading…" : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {isEmpty ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: "var(--sp-12)",
              color: "var(--text-subtle)",
            }}
          >
            <Icons.Logs size={28} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: "var(--fs-ui)" }}>
              {filterEmployee || filterTool || filterVerdict
                ? "No entries match the current filters."
                : "No tool calls recorded yet. Run a Team Meeting with Composio connected."}
            </div>
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--fs-sm)",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--hairline)",
                  background: "var(--bg)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
              >
                {["Time", "Employee", "Tool", "Args", "Verdict"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 16px",
                      textAlign: "left",
                      fontWeight: 600,
                      fontSize: "var(--fs-meta)",
                      color: "var(--text-muted)",
                      letterSpacing: "0.02em",
                      textTransform: "uppercase",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr
                  key={entry.id}
                  style={{
                    borderBottom: "1px solid var(--hairline)",
                    background: idx % 2 === 0 ? "var(--bg)" : "var(--bg-elevated)",
                    verticalAlign: "top",
                  }}
                >
                  {/* Time */}
                  <td
                    style={{ padding: "10px 16px", whiteSpace: "nowrap", color: "var(--text-muted)" }}
                    title={new Date(entry.ts).toLocaleString()}
                  >
                    {relTime(entry.ts)}
                  </td>

                  {/* Employee */}
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-7)" }}>
                      <EmpAvatar employeeId={entry.employeeId} employeeName={entry.employeeName} />
                      <span style={{ color: "var(--text)", fontWeight: 500 }}>
                        {entry.employeeName.split(" ")[0]}
                      </span>
                    </div>
                  </td>

                  {/* Tool */}
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                      <code
                        style={{
                          fontSize: "var(--fs-meta)",
                          fontFamily: "var(--font-mono, monospace)",
                          color: "var(--text)",
                          background: "var(--bg-sunken)",
                          padding: "1px 5px",
                          borderRadius: 3,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.bareName}
                      </code>
                      {entry.inputEdited && (
                        <span style={{ fontSize: "var(--fs-xs)", color: "#9333ea" }}>✎ args edited</span>
                      )}
                      {entry.blockReason && (
                        <span
                          style={{
                            fontSize: "var(--fs-xs)",
                            color: "var(--text-muted)",
                            maxWidth: 240,
                            lineHeight: 1.4,
                          }}
                        >
                          {entry.blockReason}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Args */}
                  <td style={{ padding: "10px 16px", maxWidth: 360 }}>
                    <ArgsCell input={entry.input} />
                  </td>

                  {/* Verdict */}
                  <td style={{ padding: "10px 16px" }}>
                    <VerdictBadge verdict={entry.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
