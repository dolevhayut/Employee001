"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { useRoster } from "@/components/ex/roster-context";
import { useWorkspaceMode } from "@/components/ex/workspace-mode-context";
import { AutonomyEmptyState } from "@/components/ex/autonomy-empty-state";
import { LoadErrorPanel, RefreshMiss } from "@/components/ex/load-error";
import { useT } from "@/components/ex/i18n-context";
import type { MessageKey } from "@/lib/i18n/messages";

type RunSurface = "shift" | "routine" | "task" | "council" | "builder";
type RunStatus = "running" | "complete" | "error" | "aborted";

type ActiveRun = {
  runId: string;
  surface: RunSurface;
  employeeId: string;
  employeeName: string;
  label: string;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  toolCalls: number;
  costUsd: number;
  currentTool?: string;
  lastText?: string;
  lastThinking?: string;
  subagentCount?: number;
  logPath: string;
};

type RunLogEvent =
  | { ts: string; type: "text"; text: string }
  | { ts: string; type: "thinking"; text: string }
  | { ts: string; type: "tool_use"; tool: string; input?: unknown }
  | { ts: string; type: "tool_result"; tool: string; ok?: boolean }
  | { ts: string; type: "approval"; tool: string; decision: "allow" | "deny" | "ask" }
  | { ts: string; type: "meta"; message: string }
  | { ts: string; type: "error"; message: string }
  | { ts: string; type: "done"; summary?: string; turns?: number; costUsd?: number };

type SurfaceFilter = "all" | RunSurface;

const FILTERS: { key: SurfaceFilter; labelKey: MessageKey }[] = [
  { key: "all", labelKey: "cockpit.filter.all" },
  { key: "shift", labelKey: "cockpit.filter.shift" },
  { key: "routine", labelKey: "cockpit.filter.routine" },
  { key: "task", labelKey: "cockpit.filter.task" },
  { key: "council", labelKey: "cockpit.filter.council" },
  { key: "builder", labelKey: "cockpit.filter.builder" },
];

const SURFACE_KEY: Record<RunSurface, MessageKey> = {
  shift: "cockpit.surface.shift",
  routine: "cockpit.surface.routine",
  task: "cockpit.surface.task",
  council: "cockpit.surface.council",
  builder: "cockpit.surface.builder",
};

const STATUS_KEY: Record<RunStatus, MessageKey> = {
  running: "cockpit.status.running",
  complete: "cockpit.status.done",
  error: "cockpit.status.failed",
  aborted: "cockpit.status.aborted",
};

const SURFACE_STYLES: Record<RunSurface, { bg: string; color: string }> = {
  shift: { bg: "var(--bg-sunken)", color: "var(--text-muted)" },
  routine: { bg: "color-mix(in oklch, var(--accent) 12%, transparent)", color: "var(--accent-deep)" },
  task: { bg: "color-mix(in oklch, var(--warn) 12%, transparent)", color: "var(--warn)" },
  council: { bg: "color-mix(in oklch, var(--success) 12%, transparent)", color: "var(--success)" },
  builder: { bg: "color-mix(in oklch, var(--twin) 12%, transparent)", color: "var(--twin)" },
};

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm.toString().padStart(2, "0")}m`;
}

function formatCost(usd: number): string {
  if (!usd || usd <= 0) return "—";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function StatusPill({ status }: { status: RunStatus }) {
  const { t } = useT();
  const meta: Record<RunStatus, { bg: string; color: string }> = {
    running: { bg: "var(--text)", color: "var(--bg)" },
    complete: { bg: "color-mix(in oklch, var(--success) 12%, transparent)", color: "var(--success)" },
    error: { bg: "color-mix(in oklch, var(--danger) 12%, transparent)", color: "var(--danger)" },
    aborted: { bg: "var(--bg-sunken)", color: "var(--text-muted)" },
  };
  const m = meta[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        background: m.bg,
        color: m.color,
        whiteSpace: "nowrap",
      }}
    >
      {status === "running" && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--bg)",
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        />
      )}
      {t(STATUS_KEY[status])}
    </span>
  );
}

function SurfaceChip({ surface }: { surface: RunSurface }) {
  const { t } = useT();
  const s = SURFACE_STYLES[surface] ?? { bg: "var(--bg-sunken)", color: "var(--text-muted)" };
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: "var(--fs-2xs)",
        fontWeight: 700,
        background: s.bg,
        color: s.color,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
      }}
    >
      {t(SURFACE_KEY[surface])}
    </span>
  );
}

function StatCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: "var(--sp-2)" }}>
      <span
        style={{
          fontSize: "var(--fs-2xs)",
          fontWeight: 700,
          color: "var(--text-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        className={mono ? "mono" : undefined}
        style={{
          fontSize: "var(--fs-base)",
          fontWeight: 600,
          color: "var(--text)",
          fontFamily: mono
            ? "ui-monospace, SFMono-Regular, Menlo, monospace"
            : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {mono ? <bdi>{value}</bdi> : value}
      </span>
    </div>
  );
}

function LogTail({
  runId,
  status,
  initialText,
}: {
  runId: string;
  status: RunStatus;
  initialText?: string;
}) {
  const { t } = useT();
  const [lines, setLines] = useState<RunLogEvent[]>(() =>
    initialText
      ? [{ ts: new Date().toISOString(), type: "text", text: initialText } as RunLogEvent]
      : []
  );
  const offsetRef = useRef(0);
  const etagRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status !== "running" && lines.length > 0) return;
    let cancelled = false;

    async function poll() {
      try {
        const headers: HeadersInit = {};
        if (etagRef.current) headers["If-None-Match"] = etagRef.current;
        const res = await fetch(
          `/api/runs/${runId}/log?offset=${offsetRef.current}&limitBytes=65536`,
          { headers, cache: "no-store" }
        );
        if (cancelled) return;
        if (res.status === 304) return;
        if (!res.ok) return;

        const sizeHeader = res.headers.get("X-Log-Size");
        const etag = res.headers.get("ETag");
        if (etag) etagRef.current = etag;
        if (sizeHeader) {
          const parsed = parseInt(sizeHeader, 10);
          if (!isNaN(parsed)) offsetRef.current = parsed;
        }

        const text = await res.text();
        if (!text) return;
        const fresh: RunLogEvent[] = [];
        for (const raw of text.split("\n")) {
          const trimmed = raw.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as RunLogEvent;
            fresh.push(parsed);
          } catch {
            // skip malformed line
          }
        }
        if (fresh.length === 0) return;
        setLines((prev) => {
          const next = [...prev, ...fresh];
          if (next.length > 200) return next.slice(next.length - 200);
          return next;
        });
      } catch {
        // network blip — next tick will retry
      }
    }

    poll();
    if (status !== "running") return;
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runId, status, lines.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="scrollbar"
      style={{
        background: "var(--bg-sunken)",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        padding: "8px 10px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "var(--fs-meta)",
        lineHeight: 1.45,
        color: "var(--text-muted)",
        maxHeight: 160,
        minHeight: 88,
        overflowY: "auto",
        flex: 1,
      }}
    >
      {lines.length === 0 ? (
        <div style={{ color: "var(--text-subtle)", fontStyle: "italic" }}>
          {t("cockpit.waiting")}
        </div>
      ) : (
        lines.map((ev, i) => <LogLine key={i} ev={ev} />)
      )}
    </div>
  );
}

function LogLine({ ev }: { ev: RunLogEvent }) {
  const { t, locale } = useT();
  const rtl = locale === "he";
  let color = "var(--text-muted)";
  let prefix = "";
  let body = "";
  let italic = false;
  let arrow: "forward" | "back" | null = null;

  if (ev.type === "text") {
    color = "var(--text)";
    body = ev.text ?? "";
  } else if (ev.type === "thinking") {
    color = "var(--text-subtle)";
    italic = true;
    prefix = "💭 ";
    body = ev.text ?? "";
  } else if (ev.type === "tool_use") {
    color = "var(--twin)";
    arrow = "forward";
    body = ev.tool;
  } else if (ev.type === "tool_result") {
    color = "var(--success)";
    arrow = "back";
    body = ev.tool;
  } else if (ev.type === "approval") {
    if (ev.decision === "allow") {
      color = "var(--success)";
      prefix = "✓ ";
    } else if (ev.decision === "deny") {
      color = "var(--danger)";
      prefix = "✗ ";
    } else {
      color = "var(--warn)";
      prefix = "⤳ ";
    }
    body = ev.tool;
  } else if (ev.type === "meta") {
    color = "var(--text-subtle)";
    italic = true;
    body = ev.message;
  } else if (ev.type === "error") {
    color = "var(--danger)";
    prefix = "⚠ ";
    body = ev.message;
  }

  const done = ev.type === "done";
  const turns = done ? (ev.turns ?? "?") : "";
  const cost = done ? (ev.costUsd?.toFixed(4) ?? "0.00") : "";
  if (done) {
    color = "var(--text-subtle)";
    prefix = "▣ ";
  }

  const line = truncate(`${prefix}${body}`, 240);
  const toolLine = arrow !== null;
  return (
    <div
      style={{
        color,
        fontStyle: italic ? "italic" : "normal",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {toolLine ? (
        <>
          <span style={{ display: "inline-block", transform: rtl ? "scaleX(-1)" : undefined }}>
            {arrow === "forward" ? "→" : "←"}
          </span>{" "}
          <bdi>{truncate(body, 240)}</bdi>
        </>
      ) : done ? (
        <>
          {prefix}
          {t("cockpit.log.done")}
          {ev.type === "done" && ev.summary ? ` · ${truncate(ev.summary, 180)}` : ""}
          {" ("}
          <bdi>{String(turns)}</bdi> {t("cockpit.log.turns")}, <bdi>${cost}</bdi>
          {")"}
        </>
      ) : (
        line
      )}
    </div>
  );
}

function CockpitCard({ run }: { run: ActiveRun }) {
  const { t, locale } = useT();
  const rtl = locale === "he";
  const employee = useRoster().find((e) => e.id === run.employeeId);
  const initials =
    employee?.initials ?? run.employeeName.slice(0, 2).toUpperCase();
  const avatarColor = employee?.avatarColor ?? "var(--surface)";
  const ticking = useTickingNow(run.status === "running");
  const duration = useMemo(
    () => {
      // Keep the memo invalidated while a run is active so Date.now() is reread.
      void ticking;
      return formatDuration(run.startedAt, run.endedAt);
    },
    // ticking value is read inside formatDuration via Date.now() when endedAt absent
    [run.startedAt, run.endedAt, ticking]
  );

  const detailsHref =
    run.surface === "task"
      ? `/tasks?run=${run.runId}`
      : run.surface === "shift" || run.surface === "routine"
      ? `/routines`
      : run.surface === "council"
      ? `/council`
      : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{
        opacity: run.status === "running" ? 1 : 0.78,
        y: 0,
        scale: 1,
      }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        padding: "var(--sp-14)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-10)",
        minHeight: 280,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)" }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: avatarColor,
            display: "grid",
            placeItems: "center",
            fontSize: "var(--fs-xs)",
            fontWeight: 700,
            color: "var(--text)",
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {run.employeeName}
          </div>
          <div
            style={{
              fontSize: "var(--fs-meta)",
              color: "var(--text-muted)",
              marginTop: "var(--sp-2)",
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-6)",
              minWidth: 0,
            }}
          >
            <SurfaceChip surface={run.surface} />
            <span style={{ color: "var(--text-subtle)" }}>·</span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
              title={run.label}
            >
              {run.label}
            </span>
          </div>
        </div>
        <StatusPill status={run.status} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "var(--sp-10)",
          padding: "8px 0",
          borderTop: "1px solid var(--hairline)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <StatCell
          label={run.status === "running" ? t("cockpit.stat.running") : t("cockpit.stat.duration")}
          value={duration}
          mono
        />
        <StatCell label={t("cockpit.stat.cost")} value={formatCost(run.costUsd)} mono />
        <StatCell label={t("cockpit.stat.tools")} value={String(run.toolCalls)} mono />
        <StatCell
          label={t("cockpit.stat.current")}
          value={run.currentTool ? truncate(run.currentTool, 18) : "—"}
          mono
        />
      </div>

      {(run.subagentCount ?? 0) > 0 && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-6)",
            alignSelf: "flex-start",
            padding: "3px 9px",
            borderRadius: 999,
            background: "color-mix(in oklch, var(--twin) 12%, transparent)",
            border: "1px solid var(--hairline-strong)",
            color: "var(--twin)",
            fontSize: "var(--fs-meta)",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          ✦ <bdi>{run.subagentCount}</bdi>{" "}
          {run.subagentCount === 1 ? t("cockpit.subagentOne") : t("cockpit.subagentMany")}
        </div>
      )}

      {run.status === "running" && run.lastThinking && (
        <div
          style={{
            padding: "6px 10px",
            borderInlineStart: "2px dashed var(--hairline-strong)",
            background: "color-mix(in oklch, var(--text) 12%, transparent)",
            color: "var(--text-subtle)",
            fontSize: "var(--fs-meta)",
            fontStyle: "italic",
            lineHeight: 1.45,
            maxHeight: 64,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
          }}
          title={run.lastThinking}
        >
          💭 {run.lastThinking}
        </div>
      )}

      <LogTail runId={run.runId} status={run.status} initialText={run.lastText} />

      {detailsHref && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <a
            href={detailsHref}
            className="btn ghost sm"
            style={{
              height: 26,
              padding: "0 10px",
              fontSize: "var(--fs-meta)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-4)",
              color: "var(--text-muted)",
            }}
          >
            {t("cockpit.details")}
            <Icons.Chevron size={12} style={rtl ? { transform: "rotate(180deg)" } : undefined} />
          </a>
        </div>
      )}
    </motion.div>
  );
}

export default function CockpitPage() {
  const { t } = useT();
  const { mode, loaded: modeLoaded } = useWorkspaceMode();
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [filter, setFilter] = useState<SurfaceFilter>("all");
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch("/api/active-runs?includeRecent=1", {
        cache: "no-store",
      });
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        setLoadError("Couldn't load runs.");
        return;
      }
      const data = (await res.json()) as ActiveRun[];
      if (seq !== loadSeq.current) return;
      setRuns(Array.isArray(data) ? data : []);
      setLoadError(null);
      setHasLoaded(true);
    } catch {
      if (seq !== loadSeq.current) return;
      setLoadError("Couldn't load runs.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Primary: SSE stream — pushes on every active-runs.json change.
    let es: EventSource | null = null;
    let fallbackId: ReturnType<typeof setInterval> | null = null;
    let sseOk = false;

    const startSSE = () => {
      try {
        es = new EventSource("/api/active-runs/stream?includeRecent=1");
        es.onmessage = (e) => {
          sseOk = true;
          setLoading(false);
          try {
            const data = JSON.parse(e.data) as ActiveRun[];
            loadSeq.current += 1;
            setRuns(Array.isArray(data) ? data : []);
            setLoadError(null);
            setHasLoaded(true);
          } catch { /* ignore malformed */ }
        };
        es.onerror = () => {
          es?.close();
          es = null;
          // Fallback to 5s polling if SSE fails (e.g. proxy strips streaming).
          if (!sseOk && !fallbackId) {
            load();
            fallbackId = setInterval(load, 5000);
          }
        };
      } catch {
        // EventSource not available — fall back to polling.
        load();
        fallbackId = setInterval(load, 5000);
      }
    };

    startSSE();

    return () => {
      es?.close();
      if (fallbackId) clearInterval(fallbackId);
    };
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return runs;
    return runs.filter((r) => r.surface === filter);
  }, [runs, filter]);

  const activeCount = useMemo(
    () => runs.filter((r) => r.status === "running").length,
    [runs]
  );

  const isEmpty = hasLoaded && !loading && filtered.length === 0;
  const showAutonomyEmpty =
    modeLoaded && mode === "base" && hasLoaded && !loading && runs.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar
        crumbs={[t("nav.cockpit")]}
        actions={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-6)",
              padding: "4px 10px",
              fontSize: "var(--fs-meta)",
              fontWeight: 600,
              borderRadius: 999,
              background: activeCount > 0 ? "var(--accent)" : "var(--bg-sunken)",
              color: activeCount > 0 ? "var(--bg)" : "var(--text-muted)",
              border: activeCount > 0 ? "none" : "1px solid var(--hairline)",
              height: 24,
            }}
          >
            {activeCount > 0 && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--bg)",
                  animation: "pulse 1.4s ease-in-out infinite",
                }}
              />
            )}
            <bdi>{activeCount}</bdi>{" "}
            {activeCount === 1 ? t("cockpit.activeOne") : t("cockpit.activeMany")}
          </span>
        }
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
          padding: "10px 24px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg)",
          flexShrink: 0,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
        className="scrollbar"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count =
            f.key === "all"
              ? runs.length
              : runs.filter((r) => r.surface === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: "5px 12px",
                fontSize: "var(--fs-sm)",
                fontWeight: 500,
                borderRadius: 999,
                border: "1px solid var(--hairline)",
                background: active ? "var(--text)" : "var(--surface)",
                color: active ? "var(--bg)" : "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
                transition: "background .12s, color .12s",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-6)",
              }}
            >
              <span>{t(f.labelKey)}</span>
              <span
                style={{
                  fontSize: "var(--fs-xs)",
                  fontWeight: 600,
                  color: active ? "var(--bg)" : "var(--text-subtle)",
                  opacity: 0.8,
                }}
              >
                <bdi>{count}</bdi>
              </span>
            </button>
          );
        })}
      </div>

      <div className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <PageHead
          icon="Activity"
          title={t("nav.cockpit")}
          subtitle={t("cockpit.subtitle")}
          style={{ marginBottom: "var(--sp-16)", maxWidth: 1100 }}
        />
        {loadError && hasLoaded && <RefreshMiss />}
        {loadError && !hasLoaded ? (
          <LoadErrorPanel message={t("load.runs")} onRetry={() => void load()} />
        ) : isEmpty ? (
          showAutonomyEmpty ? (
            <AutonomyEmptyState
              title={t("empty.cockpit.title")}
              description={t("empty.cockpit.description")}
            />
          ) : (
          <div
            style={{
              maxWidth: 480,
              margin: "80px auto 0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            <Icons.Bot size={48} style={{ opacity: 0.25, marginBottom: "var(--sp-14)" }} />
            <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color: "var(--text)", margin: "0 0 6px" }}>
              {t("cockpit.emptyTitle")}
            </h2>
            <p style={{ fontSize: "var(--fs-ui)", lineHeight: 1.55, margin: 0 }}>
              {t("cockpit.emptyBody")}
            </p>
          </div>
          )
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
              gap: "var(--sp-14)",
            }}
          >
            <AnimatePresence mode="popLayout">
              {filtered.map((run) => (
                <CockpitCard key={run.runId} run={run} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
