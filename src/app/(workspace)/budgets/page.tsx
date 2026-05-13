"use client";

import { useEffect, useState, useCallback } from "react";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";

type BudgetRow = {
  employeeId: string;
  employeeName: string;
  employeeFirstName: string;
  role: string;
  dailyBudgetUsd: number;
  spentTodayUsd: number;
  resetAt: string;
};

function pct(spent: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((spent / limit) * 100));
}

function barColor(p: number): string {
  if (p >= 90) return "var(--danger)";
  if (p >= 70) return "#f59e0b";
  return "#22c55e";
}

function EditableLimit({
  row,
  onSaved,
}: {
  row: BudgetRow;
  onSaved: (id: string, usd: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(row.dailyBudgetUsd));
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0) {
      setVal(String(row.dailyBudgetUsd));
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/budgets/${row.employeeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyBudgetUsd: parsed }),
      });
      if (res.ok) onSaved(row.employeeId, parsed);
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  }, [val, row.dailyBudgetUsd, row.employeeId, onSaved]);

  if (editing) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
        <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-ui)" }}>$</span>
        <input
          autoFocus
          type="number"
          min={0}
          step={0.5}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") { setVal(String(row.dailyBudgetUsd)); setEditing(false); }
          }}
          onBlur={() => void save()}
          style={{
            width: 70,
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "var(--fs-ui)",
            padding: "2px 6px",
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
        {saving && <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>saving…</span>}
      </span>
    );
  }

  return (
    <button
      onClick={() => { setVal(String(row.dailyBudgetUsd)); setEditing(true); }}
      title="Click to edit daily budget"
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "2px 6px",
        borderRadius: 4,
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "var(--fs-ui)",
        color: "var(--text)",
        textDecoration: "underline dotted var(--text-muted)",
      }}
    >
      ${row.dailyBudgetUsd.toFixed(2)}
    </button>
  );
}

export default function BudgetsPage() {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/budgets");
      if (res.ok) setRows(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSaved = useCallback((id: string, usd: number) => {
    setRows((prev) =>
      prev.map((r) => r.employeeId === id ? { ...r, dailyBudgetUsd: usd } : r)
    );
  }, []);

  const totalLimit = rows.reduce((s, r) => s + r.dailyBudgetUsd, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spentTodayUsd, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar
        crumbs={["Budgets"]}
        actions={
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            Daily spend caps per twin — resets at midnight Israel time
          </span>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <PageHead
          icon="Zap"
          title="Budgets"
          subtitle="Set daily spend caps per twin and monitor today’s usage against limits."
          style={{ marginBottom: "var(--sp-16)", maxWidth: 1100 }}
        />
        {/* Org summary bar */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            padding: "16px 20px",
            marginBottom: "var(--sp-24)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-20)",
          }}
        >
          <div>
            <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginBottom: "var(--sp-4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Org spend today</div>
            <div style={{ fontSize: "var(--fs-h3)", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--text)" }}>
              ${totalSpent.toFixed(4)}
              <span style={{ fontSize: "var(--fs-ui)", fontWeight: 400, color: "var(--text-muted)", marginLeft: "var(--sp-6)" }}>/ ${totalLimit.toFixed(2)} limit</span>
            </div>
          </div>
          <div style={{ flex: 1, height: 8, background: "var(--bg-sunken)", borderRadius: 99, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${pct(totalSpent, totalLimit)}%`,
                background: barColor(pct(totalSpent, totalLimit)),
                borderRadius: 99,
                transition: "width 0.3s",
              }}
            />
          </div>
          <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", minWidth: 40, textAlign: "right" }}>
            {pct(totalSpent, totalLimit)}%
          </div>
        </div>

        {/* Per-twin table */}
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>No twins found.</div>
        ) : (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                  {["Twin", "Role", "Daily limit", "Spent today", "Remaining", ""].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 16px",
                        textAlign: "left",
                        fontSize: "var(--fs-meta)",
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const remaining = Math.max(0, row.dailyBudgetUsd - row.spentTodayUsd);
                  const p = pct(row.spentTodayUsd, row.dailyBudgetUsd);
                  const overBudget = row.spentTodayUsd >= row.dailyBudgetUsd;
                  return (
                    <tr
                      key={row.employeeId}
                      style={{
                        borderBottom: i < rows.length - 1 ? "1px solid var(--hairline)" : "none",
                        background: overBudget ? "color-mix(in srgb, var(--danger) 6%, transparent)" : undefined,
                      }}
                    >
                      <td style={{ padding: "12px 16px", fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text)" }}>
                        {row.employeeFirstName}
                        {overBudget && (
                          <span
                            style={{
                              marginLeft: "var(--sp-8)",
                              fontSize: "var(--fs-xs)",
                              fontWeight: 600,
                              background: "var(--danger)",
                              color: "#fff",
                              borderRadius: 4,
                              padding: "1px 5px",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            over
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: "var(--fs-ui)", color: "var(--text-muted)" }}>
                        {row.role}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <EditableLimit row={row} onSaved={onSaved} />
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: "var(--fs-ui)", fontFamily: "var(--font-mono, monospace)", color: "var(--text)" }}>
                        ${row.spentTodayUsd.toFixed(4)}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
                          <div style={{ width: 80, height: 6, background: "var(--bg-sunken)", borderRadius: 99, overflow: "hidden", flexShrink: 0 }}>
                            <div
                              style={{
                                height: "100%",
                                width: `${p}%`,
                                background: barColor(p),
                                borderRadius: 99,
                              }}
                            />
                          </div>
                          <span style={{ fontSize: "var(--fs-sm)", fontFamily: "var(--font-mono, monospace)", color: overBudget ? "var(--danger)" : "var(--text-muted)" }}>
                            ${remaining.toFixed(2)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                        resets {row.resetAt}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
