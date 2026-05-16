"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";
import { CLAUDE_MODELS, type ClaudeModel } from "@/lib/employees";
import { useRoster } from "@/components/ex/roster-context";

// Per-employee budget/cost baselines. Originally seeded from demo data;
// now driven entirely by the employee record (added by the CEO at runtime).
// This page filters its list on BASE_SEED having an entry, so an empty map
// produces a clean "no employees billed yet" empty state.
const BASE_SEED: Record<string, number> = {};
const BASE_MONTHLY: Record<string, number> = {};
const ONBOARD_DATE: Record<string, string> = {};

const MODELS_STORAGE_KEY = "employee001.models.v1";
const TODAY = new Date("2026-04-30");

type ModelOverrides = Record<string, { seed: ClaudeModel; refresh: ClaudeModel }>;

function monthsActive(isoDate: string): number {
  const d = new Date(isoDate);
  const m = (TODAY.getFullYear() - d.getFullYear()) * 12 + (TODAY.getMonth() - d.getMonth());
  return Math.max(1, m);
}

function multiplier(model: ClaudeModel, key: "seed" | "refresh") {
  const m = CLAUDE_MODELS.find((x) => x.id === model);
  return m ? (key === "seed" ? m.seedCostMultiplier : m.refreshCostMultiplier) : 1;
}

function fmt(n: number) {
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function modelLabel(id: ClaudeModel) {
  return CLAUDE_MODELS.find((m) => m.id === id)?.label.replace("Claude ", "") ?? id;
}

type ExecutionCosts = {
  windowStart: string;
  totalUsd: number;
  totalRuns: number;
  byEmployee: Array<{
    employeeId: string;
    employeeName: string;
    runs: number;
    totalUsd: number;
    avgUsd: number;
    budgetHits: number;
  }>;
};

function formatCost(usd: number): string {
  if (!usd && usd !== 0) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export default function WorkspaceOverviewPage() {
  const roster = useRoster();
  const [overrides, setOverrides] = useState<ModelOverrides>({});
  const [execCosts, setExecCosts] = useState<ExecutionCosts | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MODELS_STORAGE_KEY);
      if (raw) setOverrides(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tasks/costs?month=current")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setExecCosts(data as ExecutionCosts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const employees = roster.filter((e) => BASE_SEED[e.id] !== undefined);

  function getModels(emp: (typeof employees)[number]) {
    return overrides[emp.id] ?? { seed: emp.seedModel, refresh: emp.refreshModel };
  }

  function getSeedCost(emp: (typeof employees)[number]) {
    const { seed } = getModels(emp);
    return BASE_SEED[emp.id] * multiplier(seed, "seed");
  }

  function getMonthly(emp: (typeof employees)[number]) {
    const { refresh } = getModels(emp);
    return BASE_MONTHLY[emp.id] * multiplier(refresh, "refresh");
  }

  function getTotal(emp: (typeof employees)[number]) {
    return getSeedCost(emp) + getMonthly(emp) * monthsActive(ONBOARD_DATE[emp.id]);
  }

  const totalSeed    = employees.reduce((s, e) => s + getSeedCost(e), 0);
  const totalMonthly = employees.reduce((s, e) => s + getMonthly(e), 0);
  const grandTotal   = employees.reduce((s, e) => s + getTotal(e), 0);

  return (
    <>
      <Topbar
        crumbs={["Workspace", "Overview"]}
        actions={
          <Link href="/budgets" className="btn ghost sm" style={{ textDecoration: "none" }}>
            Daily caps
          </Link>
        }
      />
      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "32px 40px 80px" }}>

        <PageHead
          icon="Zap"
          title="Workspace costs"
          subtitle="Understand spend across the org: training (seed + refresh) and live execution (real tool runs). Adjust model choices per twin in the Profile pages to control cost."
          style={{ marginBottom: "var(--sp-20)", maxWidth: 1100 }}
        />

        {/* Summary strip */}
        <div
          className="card"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "var(--sp-28)" }}
        >
          <SummaryCell label="Total seed cost"      value={fmt(totalSeed)}    sub="One-time, all employees"        tone="idle" />
          <SummaryCell label="Monthly ongoing"      value={`~${fmt(totalMonthly)}/mo`} sub="Weekly refresh × all twins" tone="success" border />
          <SummaryCell label="Total spent to date"  value={fmt(grandTotal)}   sub="Seed + all refresh runs"        tone="idle"    border />
          <SummaryCell label="Active twins"         value={String(employees.length)} sub="Employees with twin running" tone="success" border />
        </div>

        {/* Per-employee table */}
        <div className="card" style={{ overflow: "hidden", marginBottom: "var(--sp-28)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 150px 110px 130px 140px 90px",
              padding: "10px 20px",
              borderBottom: "1px solid var(--hairline)",
              gap: "var(--sp-12)",
            }}
          >
            {["Employee", "Models", "Seed cost", "Monthly", "Total spent", "Status"].map((h) => (
              <div key={h} className="section-title" style={{ fontSize: "var(--fs-xs)" }}>{h}</div>
            ))}
          </div>

          {employees.map((emp, i) => {
            const { seed, refresh } = getModels(emp);
            const seedCost = getSeedCost(emp);
            const monthly  = getMonthly(emp);
            const total    = getTotal(emp);
            const pct      = grandTotal > 0 ? total / grandTotal : 0;

            return (
              <div
                key={emp.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 150px 110px 130px 140px 90px",
                  padding: "14px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                  alignItems: "center",
                  gap: "var(--sp-12)",
                }}
              >
                {/* Employee */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)" }}>
                  <div
                    style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: emp.avatarColor,
                      display: "grid", placeItems: "center",
                      fontWeight: 700, fontSize: "var(--fs-meta)", color: "var(--text)", flexShrink: 0,
                    }}
                  >
                    {emp.initials}
                  </div>
                  <div>
                    <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{emp.name}</div>
                    <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-1)" }}>{emp.role}</div>
                  </div>
                </div>

                {/* Models */}
                <div>
                  <div style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-3)" }}>
                    <span className="subtle">Seed: </span>
                    <span className="mono" style={{ fontSize: "var(--fs-xs)", fontWeight: 600 }}>{modelLabel(seed)}</span>
                  </div>
                  <div style={{ fontSize: "var(--fs-xs)" }}>
                    <span className="subtle">Refresh: </span>
                    <span className="mono" style={{ fontSize: "var(--fs-xs)", fontWeight: 600 }}>{modelLabel(refresh)}</span>
                  </div>
                </div>

                {/* Seed cost */}
                <div>
                  <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{fmt(seedCost)}</div>
                  <div className="subtle" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}>one-time</div>
                </div>

                {/* Monthly */}
                <div>
                  <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>~{fmt(monthly)}/mo</div>
                  <div className="subtle" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}>
                    {monthsActive(ONBOARD_DATE[emp.id])} mo active
                  </div>
                </div>

                {/* Total + bar */}
                <div>
                  <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700, marginBottom: "var(--sp-5)" }}>
                    {fmt(total)}
                  </div>
                  <div style={{ height: 4, background: "var(--bg-sunken)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: pct * 100 + "%", height: "100%", background: "var(--accent)", borderRadius: 2 }} />
                  </div>
                  <div className="subtle mono" style={{ fontSize: "var(--fs-2xs)", marginTop: "var(--sp-3)" }}>
                    {Math.round(pct * 100)}% of total
                  </div>
                </div>

                {/* Status + configure link */}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", alignItems: "flex-start" }}>
                  {emp.twinStatus === "ready" ? (
                    <span className="badge success" style={{ fontSize: "var(--fs-xs)" }}>
                      <span className="dot success" style={{ boxShadow: "none" }} /> Twin ready
                    </span>
                  ) : (
                    <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>Pending</span>
                  )}
                  <Link
                    href={`/profile?employee=${emp.id}`}
                    style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", textDecoration: "underline" }}
                  >
                    Configure →
                  </Link>
                </div>
              </div>
            );
          })}

          {/* Grand total row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 150px 110px 130px 140px 90px",
              padding: "14px 20px",
              borderTop: "2px solid var(--hairline)",
              background: "var(--bg-sunken)",
              alignItems: "center",
              gap: "var(--sp-12)",
            }}
          >
            <div style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--text-muted)" }}>
              Total · {employees.length} employees
            </div>
            <div />
            <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}>{fmt(totalSeed)}</div>
            <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}>~{fmt(totalMonthly)}/mo</div>
            <div className="mono" style={{ fontSize: "var(--fs-base)", fontWeight: 800, letterSpacing: "-0.02em" }}>
              {fmt(grandTotal)}
            </div>
            <div />
          </div>
        </div>

        {/* Execution costs (this month) */}
        <div style={{ marginBottom: "var(--sp-28)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--sp-12)",
              marginBottom: "var(--sp-12)",
            }}
          >
            <h2
              style={{
                fontSize: "var(--fs-lg)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                margin: 0,
              }}
            >
              Execution costs · this month
            </h2>
            <span className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
              actual API spend on tasks (separate from training above)
            </span>
            <div className="spacer" />
            <Link
              href="/tasks"
              style={{
                fontSize: "var(--fs-meta)",
                color: "var(--text-muted)",
                textDecoration: "underline",
              }}
            >
              View tasks →
            </Link>
          </div>

          {!execCosts ? (
            <div className="card" style={{ padding: "20px 18px" }}>
              <span className="subtle" style={{ fontSize: "var(--fs-ui)" }}>
                Loading…
              </span>
            </div>
          ) : execCosts.totalRuns === 0 ? (
            <div className="card" style={{ padding: "20px 18px" }}>
              <span className="subtle" style={{ fontSize: "var(--fs-ui)" }}>
                No tasks executed this month yet.{" "}
                <Link
                  href="/tasks"
                  style={{
                    color: "var(--text)",
                    textDecoration: "underline",
                  }}
                >
                  Assign one →
                </Link>
              </span>
            </div>
          ) : (
            <>
              {/* Summary strip */}
              <div
                className="card"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  marginBottom: "var(--sp-12)",
                }}
              >
                <SummaryCell
                  label="Total spend (MTD)"
                  value={formatCost(execCosts.totalUsd)}
                  sub={`${execCosts.totalRuns} task${
                    execCosts.totalRuns !== 1 ? "s" : ""
                  } executed`}
                  tone="success"
                />
                <SummaryCell
                  label="Avg per task"
                  value={formatCost(
                    execCosts.totalRuns > 0
                      ? execCosts.totalUsd / execCosts.totalRuns
                      : 0
                  )}
                  sub="across all employees"
                  tone="idle"
                  border
                />
                <SummaryCell
                  label="Budget cap hits"
                  value={String(
                    execCosts.byEmployee.reduce(
                      (s, e) => s + e.budgetHits,
                      0
                    )
                  )}
                  sub="tasks stopped at $0.50 cap"
                  tone={
                    execCosts.byEmployee.some((e) => e.budgetHits > 0)
                      ? "warn"
                      : "idle"
                  }
                  border
                />
              </div>

              {/* Per-employee execution breakdown */}
              <div className="card" style={{ overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px 110px 110px 90px",
                    padding: "10px 20px",
                    borderBottom: "1px solid var(--hairline)",
                    gap: "var(--sp-12)",
                  }}
                >
                  {[
                    "Employee",
                    "Runs",
                    "Avg / task",
                    "Total",
                    "% of spend",
                  ].map((h) => (
                    <div
                      key={h}
                      className="section-title"
                      style={{ fontSize: "var(--fs-xs)" }}
                    >
                      {h}
                    </div>
                  ))}
                </div>

                {execCosts.byEmployee.map((row, i) => {
                  const emp = roster.find(
                    (e) => e.id === row.employeeId
                  );
                  const pct =
                    execCosts.totalUsd > 0
                      ? row.totalUsd / execCosts.totalUsd
                      : 0;
                  return (
                    <div
                      key={row.employeeId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 90px 110px 110px 90px",
                        padding: "12px 20px",
                        borderTop:
                          i === 0 ? "none" : "1px solid var(--hairline)",
                        alignItems: "center",
                        gap: "var(--sp-12)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--sp-10)",
                        }}
                      >
                        <div
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            background: emp?.avatarColor ?? "var(--surface)",
                            display: "grid",
                            placeItems: "center",
                            fontWeight: 700,
                            fontSize: "var(--fs-xs)",
                            color: "var(--text)",
                            flexShrink: 0,
                          }}
                        >
                          {emp?.initials ?? "?"}
                        </div>
                        <div>
                          <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
                            {row.employeeName}
                          </div>
                          {row.budgetHits > 0 && (
                            <div
                              className="subtle"
                              style={{
                                fontSize: "var(--fs-xs)",
                                marginTop: "var(--sp-1)",
                                color: "var(--warn)",
                              }}
                            >
                              {row.budgetHits} budget cap hit
                              {row.budgetHits !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}
                      >
                        {row.runs}
                      </div>
                      <div
                        className="mono subtle"
                        style={{ fontSize: "var(--fs-sm)" }}
                      >
                        {formatCost(row.avgUsd)}
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}
                      >
                        {formatCost(row.totalUsd)}
                      </div>
                      <div>
                        <div
                          style={{
                            height: 4,
                            background: "var(--bg-sunken)",
                            borderRadius: 2,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: pct * 100 + "%",
                              height: "100%",
                              background: "var(--accent)",
                              borderRadius: 2,
                            }}
                          />
                        </div>
                        <div
                          className="subtle mono"
                          style={{ fontSize: "var(--fs-2xs)", marginTop: "var(--sp-3)" }}
                        >
                          {Math.round(pct * 100)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Cost note */}
        <div
          className="card"
          style={{
            padding: "14px 18px",
            background: "var(--accent-soft)",
            border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
            display: "flex",
            gap: "var(--sp-12)",
            alignItems: "flex-start",
          }}
        >
          <div style={{ fontSize: "var(--fs-h4)", lineHeight: 1, marginTop: "var(--sp-1)" }}>ℹ</div>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0, color: "var(--text-muted)" }}>
            Seed cost is a one-time charge per employee for the initial 180-day data pull.
            Monthly refresh (~$8/week × 4) keeps each twin current — prompt caching reduces input costs by ~70%.
            Per-employee model selection (Opus / Sonnet / Haiku) is configured on the{" "}
            <Link href="/profile" style={{ color: "var(--accent-deep)" }}>Configure page</Link> and directly affects these estimates.
            Costs shown may vary ±5% from actual billing.
          </p>
        </div>
      </div>
    </>
  );
}

function SummaryCell({
  label, value, sub, tone, border,
}: {
  label: string; value: string; sub: string;
  tone: "success" | "warn" | "danger" | "idle"; border?: boolean;
}) {
  return (
    <div style={{ padding: "18px 20px", borderLeft: border ? "1px solid var(--hairline)" : "none" }}>
      <div className="row" style={{ gap: "var(--sp-8)", marginBottom: "var(--sp-6)" }}>
        <span className={"dot " + tone} />
        <div className="section-title" style={{ fontSize: "var(--fs-xs)" }}>{label}</div>
      </div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-4)" }}>{sub}</div>
    </div>
  );
}
