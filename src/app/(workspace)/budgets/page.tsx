"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";
import { useWorkspaceMode } from "@/components/ex/workspace-mode-context";
import { AutonomyEmptyState } from "@/components/ex/autonomy-empty-state";
import { LoadErrorPanel, RefreshMiss } from "@/components/ex/load-error";
import { useT } from "@/components/ex/i18n-context";

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
  if (p >= 70) return "var(--warn)";
  return "var(--success)";
}

function EditableLimit({
  row,
  onSaved,
}: {
  row: BudgetRow;
  onSaved: (id: string, usd: number) => void;
}) {
  const { t } = useT();
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
        {saving && <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{t("budgets.saving")}</span>}
      </span>
    );
  }

  return (
    <button
      onClick={() => { setVal(String(row.dailyBudgetUsd)); setEditing(true); }}
      title={t("budgets.editTitle")}
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
      <bdi>${row.dailyBudgetUsd.toFixed(2)}</bdi>
    </button>
  );
}

export default function BudgetsPage() {
  const { t } = useT();
  const { mode, loaded: modeLoaded } = useWorkspaceMode();
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadSeq = useRef(0);

  // Promise chain (not an async body) so no setState is reachable on a
  // synchronous path from the mount effect — the updates run only in the async
  // continuations.
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    return fetch("/api/budgets")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => {
        if (seq !== loadSeq.current) return;
        setRows(data as BudgetRow[]);
        setLoadError(null);
        setHasLoaded(true);
      })
      .catch(() => {
        if (seq !== loadSeq.current) return;
        setLoadError("Couldn't load budgets.");
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSaved = useCallback((id: string, usd: number) => {
    setRows((prev) =>
      prev.map((r) => r.employeeId === id ? { ...r, dailyBudgetUsd: usd } : r)
    );
  }, []);

  const totalLimit = rows.reduce((s, r) => s + r.dailyBudgetUsd, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spentTodayUsd, 0);
  const showAutonomyEmpty =
    modeLoaded && mode === "base" && hasLoaded && !loading && rows.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar
        crumbs={[t("nav.spend")]}
        actions={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-12)" }}>
            <Link
              href="/workspace"
              style={{
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                color: "var(--text)",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              {t("shell.cmd.workspaceCosts")}
            </Link>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
              {t("budgets.capsHint")}
            </span>
          </span>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <PageHead
          icon="Zap"
          title={t("budgets.title")}
          subtitle={t("budgets.subtitle")}
          style={{ marginBottom: "var(--sp-16)", maxWidth: 1100 }}
        />
        {loadError && hasLoaded && <RefreshMiss />}
        {loadError && !hasLoaded ? (
          <LoadErrorPanel message={t("load.budgets")} onRetry={() => void load()} />
        ) : showAutonomyEmpty ? (
          <AutonomyEmptyState
            title={t("empty.spend.title")}
            description={t("empty.spend.description")}
          />
        ) : (
        <>
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
            <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginBottom: "var(--sp-4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("budgets.orgSpend")}</div>
            <div style={{ fontSize: "var(--fs-h3)", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--text)" }}>
              <bdi>${totalSpent.toFixed(4)}</bdi>
              <span style={{ fontSize: "var(--fs-ui)", fontWeight: 400, color: "var(--text-muted)", marginInlineStart: "var(--sp-6)" }}><bdi>/ ${totalLimit.toFixed(2)}</bdi> {t("budgets.limit")}</span>
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
          <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", minWidth: 40, textAlign: "end" }}>
            <bdi>{pct(totalSpent, totalLimit)}%</bdi>
          </div>
        </div>

        {/* Per-twin table */}
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>{t("budgets.loading")}</div>
        ) : rows.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-base)" }}>{t("budgets.none")}</div>
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
                  {[
                    t("budgets.col.twin"),
                    t("budgets.col.role"),
                    t("budgets.col.limit"),
                    t("budgets.col.spent"),
                    t("budgets.col.remaining"),
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 16px",
                        textAlign: "start",
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
                              marginInlineStart: "var(--sp-8)",
                              fontSize: "var(--fs-xs)",
                              fontWeight: 600,
                              background: "var(--danger)",
                              color: "var(--bg-elevated)",
                              borderRadius: 4,
                              padding: "1px 5px",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {t("budgets.over")}
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
                        <bdi>${row.spentTodayUsd.toFixed(4)}</bdi>
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
                            <bdi>${remaining.toFixed(2)}</bdi>
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                        {t("budgets.resets")} <bdi>{row.resetAt}</bdi>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
