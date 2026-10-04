"use client";

import { useState, useEffect, useCallback } from "react";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { useRoster } from "@/components/ex/roster-context";
import { useWorkspaceMode } from "@/components/ex/workspace-mode-context";
import { AutonomyEmptyState } from "@/components/ex/autonomy-empty-state";
import { useT } from "@/components/ex/i18n-context";
import { formatDateTime, formatRelativeTime } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AuditEntry, AuditVerdict } from "@/lib/audit-log";

// ─── Verdict helpers ──────────────────────────────────────────────────────────

const VERDICT_META: Record<
  AuditVerdict,
  { labelKey: MessageKey; color: string; bg: string; dot: string }
> = {
  auto_allow: {
    labelKey: "audit.verdict.auto",
    color: "var(--text-muted)",
    bg: "var(--surface-soft)",
    dot: "var(--text-subtle)",
  },
  ceo_approved: {
    labelKey: "audit.verdict.approved",
    color: "#16a34a",
    bg: "#dcfce7",
    dot: "#16a34a",
  },
  ceo_denied: {
    labelKey: "audit.verdict.denied",
    color: "#b45309",
    bg: "#fef3c7",
    dot: "#b45309",
  },
  hard_blocked: {
    labelKey: "audit.verdict.blocked",
    color: "#dc2626",
    bg: "#fee2e2",
    dot: "#dc2626",
  },
  executed: {
    labelKey: "audit.verdict.executed",
    color: "var(--text-muted)",
    bg: "var(--surface-soft)",
    dot: "#0ea5e9",
  },
  deferred_to_flow: {
    labelKey: "audit.verdict.deferred",
    color: "#7c3aed",
    bg: "#ede9fe",
    dot: "#7c3aed",
  },
};

function VerdictBadge({ verdict }: { verdict: AuditVerdict }) {
  const { t, locale } = useT();
  const rtl = locale === "he";
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
      {verdict === "deferred_to_flow" ? (
        <>
          {t(m.labelKey)}
          <span style={{ display: "inline-block", transform: rtl ? "scaleX(-1)" : undefined }}>→</span>
          <bdi>/flow</bdi>
        </>
      ) : (
        t(m.labelKey)
      )}
    </span>
  );
}

// ─── Employee avatar ──────────────────────────────────────────────────────────

function EmpAvatar({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const emp = useRoster().find((e) => e.id === employeeId);
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
  const { t, locale } = useT();
  const rtl = locale === "he";
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
          textAlign: "start",
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
            transform: open ? "rotate(90deg)" : rtl ? "rotate(180deg)" : "none",
            transition: "transform .12s",
          }}
        />
        <bdi>{preview}</bdi>
        {keys.length > 2 && (
          <span style={{ color: "var(--text-subtle)" }}>+<bdi>{keys.length - 2}</bdi> {t("audit.more")}</span>
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

const PAGE_SIZE = 100;

export default function AuditPage() {
  const { t, locale } = useT();
  const rtl = locale === "he";
  const { mode, loaded: modeLoaded } = useWorkspaceMode();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [archives, setArchives] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterTool, setFilterTool] = useState("");
  const [filterVerdict, setFilterVerdict] = useState<AuditVerdict | "">("");
  // Date range — both ISO date strings like "2026-05-19". Empty = no bound.
  const [filterSince, setFilterSince] = useState("");
  const [filterUntil, setFilterUntil] = useState("");
  // Archive month (e.g. "2026-04") or empty for the live audit.jsonl.
  const [filterArchive, setFilterArchive] = useState("");
  const [page, setPage] = useState(1);
  const [integrity, setIntegrity] = useState<{ ok: boolean; checked: number; firstBadId?: string }>();

  useEffect(() => {
    void fetch("/api/audit/verify", { cache: "no-store" })
      .then((res) => res.json())
      .then((result: { ok: boolean; checked: number; firstBadId?: string }) => setIntegrity(result))
      .catch(() => setIntegrity({ ok: false, checked: 0 }));
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterEmployee) params.set("employee", filterEmployee);
    if (filterTool) params.set("tool", filterTool);
    if (filterVerdict) params.set("verdict", filterVerdict);
    // Browser date inputs return "YYYY-MM-DD". Convert to full-day ISO so the
    // backend compares against the actual entry timestamp range.
    if (filterSince) params.set("since", `${filterSince}T00:00:00.000Z`);
    if (filterUntil) params.set("until", `${filterUntil}T23:59:59.999Z`);
    if (filterArchive) params.set("archive", filterArchive);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    const res = await fetch(`/api/audit?${params}`);
    const data = (await res.json()) as {
      entries: AuditEntry[];
      totalCount: number;
      archives: string[];
    };
    setEntries(data.entries ?? []);
    setTotalCount(data.totalCount ?? 0);
    setArchives(data.archives ?? []);
    setLoading(false);
  }, [filterEmployee, filterTool, filterVerdict, filterSince, filterUntil, filterArchive, page]);

  // Show the loading state whenever the query (filters + page) changes — which
  // is exactly when `load` gets a new identity. Setting it during render avoids
  // a synchronous setState inside the effect (and the cascading render it
  // causes) while keeping the spinner off for background polling / manual
  // refresh, which reuse the same `load`.
  const queryKey = `${filterEmployee}|${filterTool}|${filterVerdict}|${filterSince}|${filterUntil}|${filterArchive}|${page}`;
  const [loadingKey, setLoadingKey] = useState(queryKey);
  if (loadingKey !== queryKey) {
    setLoadingKey(queryKey);
    setLoading(true);
  }

  useEffect(() => {
    // Wrapped so the (post-await) setState in `load` lands in an async
    // continuation rather than running synchronously in the effect body.
    void (async () => { await load(); })();
  }, [load]);

  // Reset page to 1 whenever a filter changes — otherwise we might be on a
  // page that no longer exists in the filtered view. Done during render so the
  // reset lands in the same pass as the filter change, with no cascading effect.
  const filterKey = `${filterEmployee}|${filterTool}|${filterVerdict}|${filterSince}|${filterUntil}|${filterArchive}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  // Poll every 5 seconds so new entries appear without a refresh — but only
  // when viewing the live log on page 1 with no date window. Browsing an
  // archive or scrolling deep is a "frozen view" and polling there would
  // bounce the user around.
  useEffect(() => {
    const isLiveTop = !filterArchive && page === 1 && !filterSince && !filterUntil;
    if (!isLiveTop) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, filterArchive, page, filterSince, filterUntil]);

  const isEmpty = !loading && entries.length === 0;
  const hasFilters = Boolean(
    filterEmployee || filterTool || filterVerdict || filterSince || filterUntil || filterArchive,
  );
  const showAutonomyEmpty =
    modeLoaded && mode === "base" && isEmpty && totalCount === 0 && !hasFilters;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={[t("nav.activityLog")]}
        actions={
          <button
            className="btn ghost sm"
            onClick={() => load()}
            title={t("audit.refresh")}
          >
            <Icons.Refresh size={13} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
          </button>
        }
      />

      {integrity && (
        <div
          style={{
            padding: "var(--sp-7) 24px",
            color: integrity.ok ? "var(--success)" : "var(--danger)",
            fontSize: "var(--fs-sm)",
            background: "var(--bg)",
            borderBottom: "1px solid var(--hairline)",
            flexShrink: 0,
          }}
        >
          {integrity.ok
            ? t("audit.integrity.verified", { count: integrity.checked })
            : t("audit.integrity.failed", { id: integrity.firstBadId ?? "unknown" })}
        </div>
      )}

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
          <option value="">{t("audit.allEmployees")}</option>
          {useRoster().map((e) => (
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
              insetInlineStart: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-subtle)",
              pointerEvents: "none",
            }}
          />
          <input
            value={filterTool}
            onChange={(e) => setFilterTool(e.target.value)}
            placeholder={t("audit.filterTool")}
            style={{
              height: 30,
              paddingInlineStart: 26,
              paddingInlineEnd: "var(--sp-8)",
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
          <option value="">{t("audit.allVerdicts")}</option>
          <option value="auto_allow">{t("audit.verdict.auto")}</option>
          <option value="ceo_approved">{t("audit.verdict.approved")}</option>
          <option value="ceo_denied">{t("audit.verdict.denied")}</option>
          <option value="hard_blocked">{t("audit.verdict.blocked")}</option>
        </select>

        {/* Date range — both inputs are optional. Browser-native picker. */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="date"
            value={filterSince}
            onChange={(e) => setFilterSince(e.target.value)}
            title={t("audit.dateFrom")}
            style={{
              height: 30, padding: "0 8px",
              fontSize: "var(--fs-sm)",
              border: "1px solid var(--hairline)", borderRadius: 5,
              background: "var(--surface)", color: "var(--text)",
              fontFamily: "inherit",
            }}
          />
          <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", display: "inline-block", transform: rtl ? "scaleX(-1)" : undefined }}>→</span>
          <input
            type="date"
            value={filterUntil}
            onChange={(e) => setFilterUntil(e.target.value)}
            title={t("audit.dateUntil")}
            style={{
              height: 30, padding: "0 8px",
              fontSize: "var(--fs-sm)",
              border: "1px solid var(--hairline)", borderRadius: 5,
              background: "var(--surface)", color: "var(--text)",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Archive month selector — only renders if there's at least one archive. */}
        {archives.length > 0 && (
          <select
            value={filterArchive}
            onChange={(e) => setFilterArchive(e.target.value)}
            title={t("audit.archiveTitle")}
            style={{
              height: 30, padding: "0 8px",
              fontSize: "var(--fs-sm)",
              border: "1px solid var(--hairline)", borderRadius: 5,
              background: "var(--surface)", color: "var(--text)",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <option value="">{t("audit.live")}</option>
            {archives.map((m) => (
              <option key={m} value={m}>
                {t("audit.archive")} {m}
              </option>
            ))}
          </select>
        )}

        <div style={{ marginInlineStart: "auto", fontSize: "var(--fs-meta)", color: "var(--text-subtle)" }}>
          {loading ? (
            t("audit.loading")
          ) : (
            <>
              <bdi>{totalCount}</bdi>{" "}
              {totalCount === 1 ? t("audit.entryOne") : t("audit.entryMany")}
              {totalPages > 1 && (
                <>
                  {" · "}
                  {t("audit.page")} <bdi>{page}</bdi> {t("audit.of")} <bdi>{totalPages}</bdi>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {isEmpty ? (
          showAutonomyEmpty ? (
            <AutonomyEmptyState
              title={t("empty.audit.title")}
              description={t("empty.audit.description")}
            />
          ) : (
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
                ? t("audit.emptyFiltered")
                : t("audit.emptyNone")}
            </div>
          </div>
          )
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
                {[
                  t("audit.col.time"),
                  t("audit.col.employee"),
                  t("audit.col.tool"),
                  t("audit.col.args"),
                  t("audit.col.verdict"),
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 16px",
                      textAlign: "start",
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
                    title={formatDateTime(entry.ts, locale)}
                  >
                    {formatRelativeTime(entry.ts, locale, { dateAfterMs: 86_400_000 })}
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
                        <bdi>{entry.bareName}</bdi>
                      </code>
                      {entry.inputEdited && (
                        <span style={{ fontSize: "var(--fs-xs)", color: "#9333ea" }}>✎ {t("audit.argsEdited")}</span>
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

      {/* Pagination — only render if there's more than one page. */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "var(--sp-10)",
            padding: "10px 24px",
            borderTop: "1px solid var(--hairline)",
            background: "var(--bg)",
            flexShrink: 0,
            fontSize: "var(--fs-sm)",
          }}
        >
          <button
            className="btn ghost sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{ opacity: page <= 1 ? 0.4 : 1 }}
          >
            {rtl ? "→" : "←"} {t("audit.prev")}
          </button>
          <span style={{ color: "var(--text-subtle)" }}>
            {t("audit.page")} <bdi>{page}</bdi> {t("audit.of")} <bdi>{totalPages}</bdi>
          </span>
          <button
            className="btn ghost sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{ opacity: page >= totalPages ? 0.4 : 1 }}
          >
            {t("audit.next")} {rtl ? "←" : "→"}
          </button>
        </div>
      )}
    </div>
  );
}
