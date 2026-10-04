"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";
import { CLAUDE_MODELS, type ClaudeModel } from "@/lib/employees";
import { useRoster } from "@/components/ex/roster-context";
import { useT } from "@/components/ex/i18n-context";

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

// ─── Persisted model overrides (client-only localStorage hydration) ──────────
// Read as a stable snapshot via useSyncExternalStore: the parsed value is cached
// and only recomputed when the raw string changes, so getSnapshot never returns
// a fresh object on an unchanged store (which would loop). getServerSnapshot
// returns the empty default so SSR + hydration match, then the client swaps in
// the persisted value after hydration — exactly what the old mount effect did.
const EMPTY_OVERRIDES: ModelOverrides = {};
let cachedOverridesRaw: string | null | undefined;
let cachedOverrides: ModelOverrides = EMPTY_OVERRIDES;

function getOverridesSnapshot(): ModelOverrides {
  try {
    const raw = localStorage.getItem(MODELS_STORAGE_KEY);
    if (raw !== cachedOverridesRaw) {
      cachedOverridesRaw = raw;
      cachedOverrides = raw ? (JSON.parse(raw) as ModelOverrides) : EMPTY_OVERRIDES;
    }
  } catch {
    /* ignore — keep the last good snapshot */
  }
  return cachedOverrides;
}

function getServerOverrides(): ModelOverrides {
  return EMPTY_OVERRIDES;
}

function subscribeOverrides(): () => void {
  // Nothing in-app writes this key while the page is mounted, so a no-op
  // subscription matches the original mount-only read.
  return () => {};
}

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

function DirArrow() {
  const { locale } = useT();
  return (
    <span style={{ display: "inline-block", transform: locale === "he" ? "scaleX(-1)" : undefined }}>→</span>
  );
}

export default function WorkspaceOverviewPage() {
  const { t } = useT();
  const roster = useRoster();
  const overrides = useSyncExternalStore(
    subscribeOverrides,
    getOverridesSnapshot,
    getServerOverrides,
  );
  const [execCosts, setExecCosts] = useState<ExecutionCosts | null>(null);

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
        crumbs={[t("crumb.workspace"), t("workspace.overview")]}
        actions={
          <Link href="/budgets" className="btn ghost sm" style={{ textDecoration: "none" }}>
            {t("workspace.dailyCaps")}
          </Link>
        }
      />
      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "32px 40px 80px" }}>

        <PageHead
          icon="Zap"
          title={t("shell.cmd.workspaceCosts")}
          subtitle={t("workspace.subtitle")}
          style={{ marginBottom: "var(--sp-20)", maxWidth: 1100 }}
        />

        {/* Summary strip */}
        <div
          className="card"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "var(--sp-28)" }}
        >
          <SummaryCell label={t("workspace.totalSeed")} value={<bdi>{fmt(totalSeed)}</bdi>} sub={t("workspace.totalSeedSub")} tone="idle" />
          <SummaryCell label={t("workspace.monthly")} value={<><bdi>~{fmt(totalMonthly)}</bdi>{t("workspace.perMonth")}</>} sub={t("workspace.monthlySub")} tone="success" border />
          <SummaryCell label={t("workspace.spentToDate")} value={<bdi>{fmt(grandTotal)}</bdi>} sub={t("workspace.spentSub")} tone="idle" border />
          <SummaryCell label={t("workspace.activeTwins")} value={<bdi>{employees.length}</bdi>} sub={t("workspace.activeTwinsSub")} tone="success" border />
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
            {[
              t("workspace.col.employee"),
              t("workspace.col.models"),
              t("workspace.col.seed"),
              t("workspace.col.monthly"),
              t("workspace.col.total"),
              t("workspace.col.status"),
            ].map((h) => (
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
                    <span className="subtle">{t("workspace.seed")}: </span>
                    <span className="mono" style={{ fontSize: "var(--fs-xs)", fontWeight: 600 }}><bdi>{modelLabel(seed)}</bdi></span>
                  </div>
                  <div style={{ fontSize: "var(--fs-xs)" }}>
                    <span className="subtle">{t("workspace.refresh")}: </span>
                    <span className="mono" style={{ fontSize: "var(--fs-xs)", fontWeight: 600 }}><bdi>{modelLabel(refresh)}</bdi></span>
                  </div>
                </div>

                {/* Seed cost */}
                <div>
                  <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}><bdi>{fmt(seedCost)}</bdi></div>
                  <div className="subtle" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}>{t("workspace.oneTime")}</div>
                </div>

                {/* Monthly */}
                <div>
                  <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}><bdi>~{fmt(monthly)}</bdi>{t("workspace.perMonth")}</div>
                  <div className="subtle" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}>
                    <bdi>{monthsActive(ONBOARD_DATE[emp.id])}</bdi> {t("workspace.monthsActive")}
                  </div>
                </div>

                {/* Total + bar */}
                <div>
                  <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700, marginBottom: "var(--sp-5)" }}>
                    <bdi>{fmt(total)}</bdi>
                  </div>
                  <div style={{ height: 4, background: "var(--bg-sunken)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: pct * 100 + "%", height: "100%", background: "var(--accent)", borderRadius: 2 }} />
                  </div>
                  <div className="subtle mono" style={{ fontSize: "var(--fs-2xs)", marginTop: "var(--sp-3)" }}>
                    <bdi>{Math.round(pct * 100)}%</bdi> {t("workspace.ofTotal")}
                  </div>
                </div>

                {/* Status + configure link */}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", alignItems: "flex-start" }}>
                  {emp.twinStatus === "ready" ? (
                    <span className="badge success" style={{ fontSize: "var(--fs-xs)" }}>
                      <span className="dot success" style={{ boxShadow: "none" }} /> {t("workspace.twinReady")}
                    </span>
                  ) : (
                    <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>{t("workspace.pending")}</span>
                  )}
                  <Link
                    href={`/profile?employee=${emp.id}`}
                    style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", textDecoration: "underline" }}
                  >
                    {t("workspace.configure")} <DirArrow />
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
              {t("workspace.total")} · <bdi>{employees.length}</bdi>{" "}
              {employees.length === 1 ? t("workspace.employeeOne") : t("workspace.employeeMany")}
            </div>
            <div />
            <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}><bdi>{fmt(totalSeed)}</bdi></div>
            <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}><bdi>~{fmt(totalMonthly)}</bdi>{t("workspace.perMonth")}</div>
            <div className="mono" style={{ fontSize: "var(--fs-base)", fontWeight: 800, letterSpacing: "-0.02em" }}>
              <bdi>{fmt(grandTotal)}</bdi>
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
              {t("workspace.executionTitle")}
            </h2>
            <span className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
              {t("workspace.executionSub")}
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
              {t("workspace.viewTasks")} <DirArrow />
            </Link>
          </div>

          {!execCosts ? (
            <div className="card" style={{ padding: "20px 18px" }}>
              <span className="subtle" style={{ fontSize: "var(--fs-ui)" }}>
                {t("workspace.loading")}
              </span>
            </div>
          ) : execCosts.totalRuns === 0 ? (
            <div className="card" style={{ padding: "20px 18px" }}>
              <span className="subtle" style={{ fontSize: "var(--fs-ui)" }}>
                {t("workspace.noTasks")}{" "}
                <Link
                  href="/tasks"
                  style={{
                    color: "var(--text)",
                    textDecoration: "underline",
                  }}
                >
                  {t("workspace.assign")} <DirArrow />
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
                  label={t("workspace.mtd")}
                  value={<bdi>{formatCost(execCosts.totalUsd)}</bdi>}
                  sub={
                    <>
                      <bdi>{execCosts.totalRuns}</bdi>{" "}
                      {execCosts.totalRuns === 1 ? t("workspace.taskOne") : t("workspace.taskMany")}
                    </>
                  }
                  tone="success"
                />
                <SummaryCell
                  label={t("workspace.avg")}
                  value={
                    <bdi>
                      {formatCost(
                        execCosts.totalRuns > 0
                          ? execCosts.totalUsd / execCosts.totalRuns
                          : 0
                      )}
                    </bdi>
                  }
                  sub={t("workspace.avgSub")}
                  tone="idle"
                  border
                />
                <SummaryCell
                  label={t("workspace.capHits")}
                  value={
                    <bdi>
                      {execCosts.byEmployee.reduce(
                        (s, e) => s + e.budgetHits,
                        0
                      )}
                    </bdi>
                  }
                  sub={
                    <>
                      {t("workspace.capHitsBefore")} <bdi>$0.50</bdi> {t("workspace.capHitsAfter")}
                    </>
                  }
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
                    t("workspace.exec.employee"),
                    t("workspace.exec.runs"),
                    t("workspace.exec.avg"),
                    t("workspace.exec.total"),
                    t("workspace.exec.share"),
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
                              <bdi>{row.budgetHits}</bdi>{" "}
                              {row.budgetHits === 1 ? t("workspace.capHitOne") : t("workspace.capHitMany")}
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}
                      >
                        <bdi>{row.runs}</bdi>
                      </div>
                      <div
                        className="mono subtle"
                        style={{ fontSize: "var(--fs-sm)" }}
                      >
                        <bdi>{formatCost(row.avgUsd)}</bdi>
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}
                      >
                        <bdi>{formatCost(row.totalUsd)}</bdi>
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
                          <bdi>{Math.round(pct * 100)}%</bdi>
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
            {t("workspace.note.seedBefore")}<bdi>180</bdi>{t("workspace.note.seedAfter")}{" "}
            {t("workspace.note.refreshBefore")}<bdi>$8</bdi>{t("workspace.note.refreshMid")}<bdi>4</bdi>{t("workspace.note.refreshAfter")}<bdi>70%</bdi>{t("workspace.note.refreshEnd")}{" "}
            {t("workspace.note.modelsBefore")}<bdi>Opus / Sonnet / Haiku</bdi>{t("workspace.note.modelsMid")}
            <Link href="/profile" style={{ color: "var(--accent-deep)" }}>{t("workspace.note.link")}</Link>
            {t("workspace.note.modelsAfter")}<bdi>5%</bdi>{t("workspace.note.end")}
          </p>
        </div>
      </div>
    </>
  );
}

function SummaryCell({
  label, value, sub, tone, border,
}: {
  label: string; value: ReactNode; sub: ReactNode;
  tone: "success" | "warn" | "danger" | "idle"; border?: boolean;
}) {
  return (
    <div style={{ padding: "18px 20px", borderInlineStart: border ? "1px solid var(--hairline)" : "none" }}>
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
