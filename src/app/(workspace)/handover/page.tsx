"use client";

import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/ex/shell";

// ─── Relay Handover workspace page ────────────────────────────────────────────
//
// Lets the CEO start a "relay handover" export for a departing employee, then
// tails the live SSE stream (GET /api/relay/<id>/stream) through the runner's
// phases — consent → capture → synthesize → coverage → write — and finally
// renders the synthesized Role Context Package (RCP).
//
// DEMO defaults (PRD 13.x), all clearly labelled in-UI:
//   13.5  prominent DEMO banner + a SOFT consent gate (checkbox).
//   13.2  coverage is a SOFT unlock/label ("handover-ready"), NEVER a wall.
//   13.4  per-field coverage bars from the deterministic rubric.
//
// No Anthropic key needed: synthMode defaults to 'fixture' (deterministic
// synthesis from data/relay/transcripts/<id>.json), so this is one click.

const DEMO_EMPLOYEE_ID = "itai-cohen";

// The literal demo banner (PRD 13.5). Mirrors src/lib/relay/runner.ts DEMO_BANNER,
// but the page-level banner copy is the richer, sensitivity-aware variant.
const DEMO_BANNER_LONG =
  "DEMO — handover capture is sensitive employee data; this build is not legally reviewed, not for production, and not published.";

// ─── Portable event/RCP shapes (kept local — this is a client component and
// must not import server-only relay modules). Mirrors RelayEvent in
// src/lib/relay/runner.ts and RoleContextPackage in rcp.types.ts. ─────────────

type CaptureArea =
  | "decision_rules"
  | "playbooks"
  | "contact_graph"
  | "edge_cases"
  | "tooling_map"
  | "glossary"
  | "open_loops";

type CapturedItem = {
  id: string;
  title: string;
  body: string;
  provenance: "interview" | "confirmed-from-history";
  confidence: number;
  gaps: string[];
};

type ToolingRef = {
  id: string;
  system: string;
  location: string;
  accessVia: string;
  ownedBy?: string;
  provenance: "interview" | "confirmed-from-history";
  confidence: number;
  gaps: string[];
};

type PerField = {
  items: number;
  minItems: number;
  weight: number;
  satisfied: boolean;
  score: number;
};

type RelayStatus = "draft" | "handover-ready";

type RelayEvent =
  | { type: "start"; employeeId: string; synthMode: "fixture" | "model"; handoverId: string; ts: number }
  | { type: "consent"; state: "requested" | "granted" | "declined"; subjectId: string; banner: string; ts: number }
  | { type: "interview_question"; questionId: string; text: string; area: CaptureArea; ts: number }
  | { type: "capture_note"; area: string; item: CapturedItem | ToolingRef; scratchPath: string; ts: number }
  | { type: "phase"; phase: "consent" | "capture" | "synthesize" | "coverage" | "write"; ts: number }
  | { type: "synthesizing"; model: string; synthMode: "fixture" | "model"; inputNotes: number; ts: number }
  | { type: "file_writing"; path: string; bytes: number; ts: number }
  | {
      type: "coverage";
      perField: Record<string, PerField>;
      weightedScore: number;
      status: RelayStatus;
      gaps: string[];
      ts: number;
    }
  | {
      type: "done";
      rcpPath: string;
      status: RelayStatus;
      weightedScore: number;
      turns: number;
      costUsd: number;
      stoppedReason: "natural" | "consent_declined" | "max_budget" | "max_turns" | "error";
      ts: number;
    }
  | { type: "error"; message: string; ts: number }
  | { type: string; [k: string]: unknown };

type RoleContextPackage = {
  source_twin_id: string;
  schema_version: "relay-rcp-1";
  generated_at: string;
  synth_mode: "fixture" | "model";
  status: RelayStatus;
  decision_rules: CapturedItem[];
  playbooks: CapturedItem[];
  contact_graph: CapturedItem[];
  edge_cases: CapturedItem[];
  tooling_map: ToolingRef[];
  glossary: CapturedItem[];
  open_loops: CapturedItem[];
  provenance: {
    interviewerModel: string;
    transcriptRef: string;
    redactionApplied: boolean;
    itemCount: number;
    consent: { subjectId: string; grantedAt: string; banner: string };
    auditRunId: string;
  };
};

// ─── Rubric metadata for rendering field labels/order (display only — the
// authoritative scores arrive on the coverage event). ─────────────────────────

const FIELD_LABELS: Record<string, string> = {
  decision_rules: "Decision rules",
  playbooks: "Playbooks",
  contact_graph: "Contact graph",
  edge_cases: "Edge cases",
  tooling_map: "Tooling map",
  open_loops: "Open loops",
  glossary: "Glossary",
};

const FIELD_ORDER: CaptureArea[] = [
  "decision_rules",
  "playbooks",
  "contact_graph",
  "edge_cases",
  "tooling_map",
  "open_loops",
  "glossary",
];

const PHASE_ORDER = ["consent", "capture", "synthesize", "coverage", "write"] as const;
type Phase = (typeof PHASE_ORDER)[number];
const PHASE_LABELS: Record<Phase, string> = {
  consent: "Consent",
  capture: "Capture interview",
  synthesize: "Synthesize",
  coverage: "Coverage",
  write: "Write RCP",
};

// ─── Live stream state ─────────────────────────────────────────────────────────

type FeedEntry =
  | { kind: "question"; id: string; area: CaptureArea; text: string }
  | { kind: "note"; id: string; area: string; item: CapturedItem | ToolingRef };

type CoverageState = {
  perField: Record<string, PerField>;
  weightedScore: number;
  status: RelayStatus;
  gaps: string[];
} | null;

type DoneState = {
  rcpPath: string;
  status: RelayStatus;
  weightedScore: number;
  turns: number;
  costUsd: number;
  stoppedReason: string;
} | null;

type StreamState = {
  handoverId: string | null;
  synthMode: "fixture" | "model" | null;
  phase: Phase | null;
  phasesSeen: Set<Phase>;
  consentState: "requested" | "granted" | "declined" | null;
  feed: FeedEntry[];
  synthModel: string | null;
  coverage: CoverageState;
  done: DoneState;
  errorMessage: string | null;
};

const initialStream: StreamState = {
  handoverId: null,
  synthMode: null,
  phase: null,
  phasesSeen: new Set(),
  consentState: null,
  feed: [],
  synthModel: null,
  coverage: null,
  done: null,
  errorMessage: null,
};

function streamReducer(s: StreamState, ev: RelayEvent): StreamState {
  switch (ev.type) {
    case "start": {
      const e = ev as Extract<RelayEvent, { type: "start" }>;
      return { ...s, handoverId: e.handoverId, synthMode: e.synthMode };
    }
    case "phase": {
      const e = ev as Extract<RelayEvent, { type: "phase" }>;
      const phasesSeen = new Set(s.phasesSeen);
      phasesSeen.add(e.phase);
      return { ...s, phase: e.phase, phasesSeen };
    }
    case "consent": {
      const e = ev as Extract<RelayEvent, { type: "consent" }>;
      return { ...s, consentState: e.state };
    }
    case "interview_question": {
      const e = ev as Extract<RelayEvent, { type: "interview_question" }>;
      return {
        ...s,
        feed: [...s.feed, { kind: "question", id: e.questionId, area: e.area, text: e.text }],
      };
    }
    case "capture_note": {
      const e = ev as Extract<RelayEvent, { type: "capture_note" }>;
      return {
        ...s,
        feed: [...s.feed, { kind: "note", id: e.item.id, area: e.area, item: e.item }],
      };
    }
    case "synthesizing": {
      const e = ev as Extract<RelayEvent, { type: "synthesizing" }>;
      return { ...s, synthModel: e.model };
    }
    case "coverage": {
      const e = ev as Extract<RelayEvent, { type: "coverage" }>;
      return {
        ...s,
        coverage: {
          perField: e.perField,
          weightedScore: e.weightedScore,
          status: e.status,
          gaps: e.gaps,
        },
      };
    }
    case "done": {
      const e = ev as Extract<RelayEvent, { type: "done" }>;
      return {
        ...s,
        phase: null,
        done: {
          rcpPath: e.rcpPath,
          status: e.status,
          weightedScore: e.weightedScore,
          turns: e.turns,
          costUsd: e.costUsd,
          stoppedReason: e.stoppedReason,
        },
      };
    }
    case "error": {
      const e = ev as Extract<RelayEvent, { type: "error" }>;
      return { ...s, errorMessage: e.message };
    }
    default:
      return s;
  }
}

function useHandoverStream(employeeId: string, handoverId: string | null, enabled: boolean) {
  const [state, dispatch] = useReducer(streamReducer, initialStream);
  const [connectionLost, setConnectionLost] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const cancelledRef = useRef(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    // Wait until we have the handoverId from the POST response before opening
    // the stream — connecting without it races the (near-instant in fixture
    // mode) run and 404s once the active sentinel is gone, which is exactly
    // what surfaced as a spurious "connection lost".
    if (!enabled || !handoverId) return;
    cancelledRef.current = false;
    finishedRef.current = false;
    setConnectionLost(false);

    function open() {
      const qs = `?handoverId=${encodeURIComponent(handoverId!)}`;
      const url = `/api/relay/${encodeURIComponent(employeeId)}/stream${qs}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (ev) => {
        if (!ev.data) return;
        try {
          const parsed = JSON.parse(ev.data) as RelayEvent;
          dispatch(parsed);
          retryRef.current = 0;
          if (parsed.type === "done") {
            // The server closes the stream right after `done`; that close
            // fires onerror. Mark finished so we don't treat it as a drop.
            finishedRef.current = true;
          }
        } catch {
          /* ignore malformed / heartbeat lines */
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelledRef.current || finishedRef.current) return;
        retryRef.current += 1;
        if (retryRef.current > 2) {
          setConnectionLost(true);
          return;
        }
        const delay = 500 * Math.pow(2, retryRef.current);
        setTimeout(() => {
          if (!cancelledRef.current) open();
        }, delay);
      };
    }

    open();
    return () => {
      cancelledRef.current = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [employeeId, handoverId, enabled]);

  // Close the socket once the runner emits `done`.
  useEffect(() => {
    if (state.done) {
      cancelledRef.current = true;
      esRef.current?.close();
      esRef.current = null;
    }
  }, [state.done]);

  return { state, connectionLost };
}

// ─── UI primitives ──────────────────────────────────────────────────────────

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      className="card"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        padding: "var(--sp-16, 16px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "var(--fs-xs)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: ".06em",
        color: "var(--text-muted)",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function confidencePct(c: number): string {
  return `${Math.round((c ?? 0) * 100)}%`;
}

// ─── Coverage meter (SOFT unlock — PRD 13.2) ──────────────────────────────────

function CoverageMeter({ coverage }: { coverage: NonNullable<CoverageState> }) {
  const pct = Math.round(coverage.weightedScore * 100);
  const ready = coverage.status === "handover-ready";

  return (
    <Panel>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-8)" }}>
        <SectionLabel>Coverage</SectionLabel>
        <div style={{ flex: 1 }} />
        <span
          className="mono"
          style={{
            fontSize: "var(--fs-lg)",
            fontWeight: 700,
            color: ready ? "var(--success)" : "var(--text)",
          }}
        >
          {pct}%
        </span>
      </div>

      {/* Overall bar */}
      <div
        style={{
          height: 6,
          background: "var(--bg-sunken)",
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: ready ? "var(--success)" : "#9E6B47",
            borderRadius: 3,
            transition: "width .3s ease",
          }}
        />
      </div>

      {/* Status pill — framed as a SOFT unlock, never a wall */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", marginBottom: 14 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            background: ready ? "rgba(46,160,67,0.12)" : "rgba(158,107,71,0.12)",
            color: ready ? "var(--success)" : "#9E6B47",
            border: `1px solid ${ready ? "rgba(46,160,67,0.3)" : "rgba(158,107,71,0.3)"}`,
          }}
        >
          {ready ? "✓ Handover-ready" : "Draft"}
        </span>
        <span className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
          {ready
            ? "Threshold met — the RCP is unlocked as handover-ready."
            : "Soft label only. You can export at any coverage — this never blocks you."}
        </span>
      </div>

      {/* Per-field bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {FIELD_ORDER.map((field) => {
          const f = coverage.perField[field];
          if (!f) return null;
          const fieldPct = Math.round((f.score ?? 0) * 100);
          return (
            <div key={field}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--sp-8)",
                  fontSize: "var(--fs-meta)",
                  marginBottom: 3,
                }}
              >
                <span style={{ color: f.satisfied ? "var(--text)" : "var(--text-muted)" }}>
                  {FIELD_LABELS[field] ?? field}
                </span>
                <div style={{ flex: 1 }} />
                <span className="mono subtle">
                  {f.items}/{f.minItems}
                </span>
                <span className="mono subtle" style={{ opacity: 0.6 }}>
                  · w{f.weight}
                </span>
              </div>
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
                    width: `${fieldPct}%`,
                    height: "100%",
                    background: f.satisfied ? "var(--success)" : "var(--text-subtle)",
                    borderRadius: 2,
                    transition: "width .3s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {coverage.gaps.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Thinnest areas</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-muted)", fontSize: "var(--fs-meta)" }}>
            {coverage.gaps.map((g, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ─── Live interview feed ──────────────────────────────────────────────────────

function isToolingRef(item: CapturedItem | ToolingRef): item is ToolingRef {
  return (item as ToolingRef).system !== undefined;
}

function InterviewFeed({ feed }: { feed: FeedEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed.length]);

  return (
    <Panel>
      <SectionLabel>Interview · live capture</SectionLabel>
      {feed.length === 0 ? (
        <div className="subtle" style={{ fontSize: "var(--fs-meta)", padding: "8px 0" }}>
          Waiting for the interviewer to begin…
        </div>
      ) : (
        <div
          className="scrollbar"
          style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}
        >
          {feed.map((entry) => {
            if (entry.kind === "question") {
              return (
                <div
                  key={entry.id}
                  style={{
                    padding: "8px 10px",
                    borderLeft: "2px solid #9E6B47",
                    background: "var(--bg-sunken)",
                    borderRadius: "0 6px 6px 0",
                  }}
                >
                  <div
                    className="mono"
                    style={{ fontSize: "var(--fs-2xs)", color: "#9E6B47", textTransform: "uppercase" }}
                  >
                    Q · {FIELD_LABELS[entry.area] ?? entry.area}
                  </div>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", marginTop: 2 }}>
                    {entry.text}
                  </div>
                </div>
              );
            }
            const item = entry.item;
            const tool = isToolingRef(item);
            return (
              <div
                key={entry.id + entry.area}
                style={{
                  padding: "8px 10px",
                  border: "1px solid var(--hairline)",
                  borderRadius: 6,
                  background: "var(--surface-soft)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
                  <span
                    className="mono"
                    style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)", textTransform: "uppercase" }}
                  >
                    {FIELD_LABELS[entry.area] ?? entry.area}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span className="mono subtle" style={{ fontSize: "var(--fs-2xs)" }}>
                    {entry.item.provenance} · conf {confidencePct(entry.item.confidence)}
                  </span>
                </div>
                <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)", marginTop: 3 }}>
                  {tool ? item.system : item.title}
                </div>
                <div
                  style={{
                    fontSize: "var(--fs-meta)",
                    color: "var(--text-muted)",
                    marginTop: 2,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {tool ? `${item.location} · access: ${item.accessVia}` : item.body}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </Panel>
  );
}

// ─── Phase stepper ────────────────────────────────────────────────────────────

function PhaseStepper({ phasesSeen, current, done }: { phasesSeen: Set<Phase>; current: Phase | null; done: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
      {PHASE_ORDER.map((p, i) => {
        const seen = phasesSeen.has(p);
        const active = current === p && !done;
        const complete = done || (seen && current !== p);
        return (
          <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            {i > 0 && <span style={{ color: "var(--text-subtle)" }}>›</span>}
            <span
              style={{
                fontSize: "var(--fs-xs)",
                fontWeight: active ? 700 : 500,
                color: active ? "#9E6B47" : complete ? "var(--text)" : "var(--text-subtle)",
              }}
            >
              {complete ? "✓ " : ""}
              {PHASE_LABELS[p]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ─── Synthesized RCP view ─────────────────────────────────────────────────────

function RcpItemList({ items, isTooling }: { items: (CapturedItem | ToolingRef)[]; isTooling?: boolean }) {
  if (items.length === 0) {
    return (
      <div className="subtle" style={{ fontSize: "var(--fs-meta)", fontStyle: "italic" }}>
        (none captured)
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item) => {
        const tool = isTooling && isToolingRef(item);
        return (
          <div
            key={item.id}
            style={{
              padding: "8px 10px",
              border: "1px solid var(--hairline)",
              borderRadius: 6,
              background: "var(--surface-soft)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" }}>
                {tool ? (item as ToolingRef).system : (item as CapturedItem).title}
              </span>
              <div style={{ flex: 1 }} />
              <span className="mono subtle" style={{ fontSize: "var(--fs-2xs)" }}>
                {item.provenance} · {confidencePct(item.confidence)}
              </span>
            </div>
            <div
              style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: 3, whiteSpace: "pre-wrap" }}
            >
              {tool
                ? `${(item as ToolingRef).location} · access: ${(item as ToolingRef).accessVia}${
                    (item as ToolingRef).ownedBy ? ` · owner: ${(item as ToolingRef).ownedBy}` : ""
                  }`
                : (item as CapturedItem).body}
            </div>
            {item.gaps.length > 0 && (
              <div style={{ fontSize: "var(--fs-2xs)", color: "var(--warn)", marginTop: 4 }}>
                gaps: {item.gaps.join("; ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RcpView({ rcp }: { rcp: RoleContextPackage }) {
  const [rawJson, setRawJson] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const sections: { field: CaptureArea; items: (CapturedItem | ToolingRef)[] }[] = useMemo(
    () =>
      FIELD_ORDER.map((field) => ({
        field,
        items: (rcp[field] ?? []) as (CapturedItem | ToolingRef)[],
      })),
    [rcp],
  );

  const downloadRcp = () => {
    const subject = rcp.provenance?.consent?.subjectId ?? "handover";
    const blob = new Blob([JSON.stringify(rcp, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rcp-${subject}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
    <Panel>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", marginBottom: 12 }}>
        <SectionLabel>Role Context Package</SectionLabel>
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          title="What is this package and how to load it into an agent?"
          aria-label="About this package"
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "1px solid var(--text-subtle)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ?
        </button>
        <span
          className="mono"
          style={{
            fontSize: "var(--fs-2xs)",
            color: "var(--text-subtle)",
            padding: "2px 6px",
            border: "1px solid var(--hairline)",
            borderRadius: 4,
          }}
        >
          {rcp.schema_version} · {rcp.synth_mode}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn sm"
          onClick={() => setRawJson((v) => !v)}
        >
          {rawJson ? "Sectioned view" : "Raw JSON"}
        </button>
        <button
          type="button"
          className="btn primary sm"
          onClick={downloadRcp}
          title="Download the Role Context Package as a JSON file"
        >
          ↓ Download rcp.json
        </button>
      </div>

      <p style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
        This RCP is <strong style={{ color: "var(--text)" }}>portable</strong> — it seeds a successor twin (agent →
        agent) or onboards a human replacement. The on-disk contract (
        <span className="mono">{rcp.schema_version}</span>) carries zero Employee001 coupling, so it survives a
        spinout. Tooling is recorded as <em>references only</em> — never credentials.
      </p>

      {rawJson ? (
        <pre
          className="scrollbar mono"
          style={{
            maxHeight: 520,
            overflow: "auto",
            background: "var(--bg-sunken)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            padding: 14,
            fontSize: "var(--fs-2xs)",
            lineHeight: 1.5,
            color: "var(--text)",
            margin: 0,
          }}
        >
          {JSON.stringify(rcp, null, 2)}
        </pre>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {sections.map(({ field, items }) => (
            <div key={field}>
              <div
                style={{
                  fontSize: "var(--fs-sm)",
                  fontWeight: 700,
                  color: "var(--text)",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--sp-8)",
                }}
              >
                {FIELD_LABELS[field] ?? field}
                <span className="mono subtle" style={{ fontSize: "var(--fs-2xs)", fontWeight: 400 }}>
                  {items.length} item{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <RcpItemList items={items} isTooling={field === "tooling_map"} />
            </div>
          ))}

          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
            <SectionLabel>Provenance</SectionLabel>
            <div className="mono" style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)", lineHeight: 1.6 }}>
              interviewer: {rcp.provenance.interviewerModel} · items: {rcp.provenance.itemCount} · redaction:{" "}
              {rcp.provenance.redactionApplied ? "applied" : "off"} · run: {rcp.provenance.auditRunId}
              <br />
              consent: {rcp.provenance.consent.subjectId} @ {rcp.provenance.consent.grantedAt}
            </div>
          </div>
        </div>
      )}
    </Panel>
    {showInfo && <RcpInfoModal subject={rcp.provenance?.consent?.subjectId ?? "the role"} onClose={() => setShowInfo(false)} />}
    </>
  );
}

// ─── "What is this package?" explainer modal ────────────────────────────────────

function RcpInfoModal({ subject, onClose }: { subject: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="About the Role Context Package"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: "var(--sp-24)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="scrollbar"
        style={{
          width: "min(640px, 100%)",
          maxHeight: "82vh",
          overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--hairline-strong)",
          borderRadius: 12,
          padding: "var(--sp-24)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", marginBottom: "var(--sp-12)" }}>
          <h2 style={{ fontSize: "var(--fs-base)", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
            What is a Role Context Package?
          </h2>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 var(--sp-14)" }}>
          A portable JSON file that captures {subject}&apos;s <strong style={{ color: "var(--text)" }}>undocumented
          working knowledge</strong> — the &ldquo;how,&rdquo; not just the &ldquo;what&rdquo; — across 7 dimensions:
          decision rules, playbooks, the contact graph, edge cases, the tooling map, glossary, and open loops. It carries
          <strong style={{ color: "var(--text)" }}> zero Employee001 coupling</strong>, so a successor — human or AI agent —
          can ingest it anywhere. Tooling is stored as <em>references only</em>, never credentials.
        </p>

        <div style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--text)", margin: "0 0 var(--sp-8)" }}>
          How to load it into an agent like Claude
        </div>

        <InfoStep n={1} title="Into a successor's Employee001 twin">
          Drop <span className="mono">rcp-*.json</span> into the new hire&apos;s <span className="mono">knowledge/</span> folder
          (Profile → <strong style={{ color: "var(--text)" }}>Files</strong> → knowledge/). The twin reads it on demand — the
          successor inherits the playbooks and decision rules from day one.
        </InfoStep>

        <InfoStep n={2} title="Claude API / Agent SDK — system-prompt context">
          Inject the file as an authoritative context block in your system prompt:
          <pre
            className="scrollbar mono"
            style={{
              marginTop: 8, marginBottom: 0, padding: 12, background: "var(--bg-sunken)",
              border: "1px solid var(--hairline)", borderRadius: 6, overflowX: "auto",
              fontSize: "var(--fs-2xs)", lineHeight: 1.5, color: "var(--text)",
            }}
          >{`import { readFileSync } from "fs";
const rcp = readFileSync("rcp-${subject}.json", "utf8");

const system = \`You are taking over this role. The Role Context
Package below is your authoritative source for how the work is done
— decision rules, playbooks, contacts, edge cases, tooling, open loops:

\${rcp}\`;

// Anthropic SDK
await client.messages.create({ model, system, messages });`}</pre>
        </InfoStep>

        <InfoStep n={3} title="Claude Code / Claude.ai — drop-in context">
          Save the file in your project and tell Claude to <span className="mono">Read</span> it, or attach it to the
          conversation. For persistent context across sessions, paste the key sections into your{" "}
          <span className="mono">CLAUDE.md</span>.
        </InfoStep>

        <p style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)", lineHeight: 1.5, margin: "var(--sp-14) 0 0" }}>
          The schema (<span className="mono">relay-rcp-1</span>) is provider-agnostic — the same file works for any agent
          framework that accepts text context, not just Claude.
        </p>
      </div>
    </div>
  );
}

function InfoStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-10)", marginBottom: "var(--sp-12)" }}>
      <div
        style={{
          width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
          background: "var(--text)", color: "var(--bg)",
          fontSize: 11, fontWeight: 700,
          display: "grid", placeItems: "center", marginTop: 1,
        }}
      >
        {n}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.55 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type RunPhase = "idle" | "starting" | "running" | "done" | "error";

function HandoverPageInner() {
  const params = useSearchParams();
  const employeeId = params.get("employee") ?? DEMO_EMPLOYEE_ID;

  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [consentChecked, setConsentChecked] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [rcp, setRcp] = useState<RoleContextPackage | null>(null);
  const [handoverId, setHandoverId] = useState<string | null>(null);

  const streaming = runPhase === "running" || runPhase === "done";
  const { state, connectionLost } = useHandoverStream(employeeId, handoverId, streaming);

  // Flip to "done" once the runner emits its terminal event, then load the RCP.
  useEffect(() => {
    if (state.done && runPhase === "running") {
      setRunPhase("done");
    }
  }, [state.done, runPhase]);

  // On done, fetch the persisted RCP via the GET route (the read side of the contract).
  useEffect(() => {
    if (runPhase !== "done") return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/relay/${encodeURIComponent(employeeId)}`, { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { rcp?: RoleContextPackage } | RoleContextPackage;
        if (cancelled) return;
        const loaded = "rcp" in data && data.rcp ? data.rcp : (data as RoleContextPackage);
        if (loaded && (loaded as RoleContextPackage).schema_version) {
          setRcp(loaded as RoleContextPackage);
        }
      } catch {
        /* RCP also renders from stream state if the GET route is unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runPhase, employeeId]);

  const start = useCallback(async () => {
    if (!consentChecked) return;
    setStartError(null);
    setRunPhase("starting");
    try {
      const r = await fetch(`/api/relay/${encodeURIComponent(employeeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ synthMode: "fixture", consent: true }),
      });
      if (!r.ok && r.status !== 409) {
        const text = await r.text().catch(() => "");
        throw new Error(text || `Failed to start (HTTP ${r.status})`);
      }
      // Capture the handoverId so the stream tails THIS run by id (works even
      // after the run finishes — the /stream route replays events.jsonl).
      const data = (await r.json().catch(() => ({}))) as { handoverId?: string };
      if (data.handoverId) setHandoverId(data.handoverId);
      setRunPhase("running");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start handover.");
      setRunPhase("error");
    }
  }, [consentChecked, employeeId]);

  const done = !!state.done;

  return (
    <>
      <Topbar crumbs={["Workspace", "Handover"]} />
      <div className="scrollbar" style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* DEMO banner — PRD 13.5 */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(158,107,71,0.10)",
              border: "1px solid rgba(158,107,71,0.35)",
              color: "var(--text)",
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--sp-10)",
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1.2 }}>⚠️</span>
            <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>{DEMO_BANNER_LONG}</div>
          </div>

          {/* Header */}
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em", margin: "0 0 4px", color: "var(--text)" }}>
              Relay handover
            </h1>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
              Capture a departing employee&apos;s working knowledge — decision rules, playbooks, the contact graph,
              edge cases, tooling, glossary, and open loops — into a portable Role Context Package. Subject:{" "}
              <span className="mono" style={{ color: "var(--text)" }}>
                {employeeId}
              </span>
              . Runs in <strong style={{ color: "var(--text)" }}>fixture mode</strong> — deterministic, no API key
              required.
            </p>
          </div>

          {/* Start / consent card */}
          {runPhase === "idle" || runPhase === "starting" || runPhase === "error" ? (
            <Panel>
              <SectionLabel>Consent gate (demo · soft)</SectionLabel>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--sp-10)",
                  cursor: "pointer",
                  marginBottom: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  style={{ marginTop: 2, width: 16, height: 16, accentColor: "#9E6B47", flexShrink: 0 }}
                />
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)", lineHeight: 1.5 }}>
                  The departing employee consented to this handover. (Demo default 13.5 — this is a soft consent gate
                  shown for the demo; this build is not legally reviewed.)
                </span>
              </label>

              {startError && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--danger)",
                    borderRadius: 6,
                    color: "var(--danger)",
                    fontSize: "var(--fs-meta)",
                    background: "rgba(220,38,38,0.06)",
                  }}
                >
                  {startError}
                </div>
              )}

              <button
                type="button"
                className="btn"
                disabled={!consentChecked || runPhase === "starting"}
                onClick={start}
                style={{
                  background: consentChecked ? "#9E6B47" : "var(--bg-sunken)",
                  color: consentChecked ? "#fff" : "var(--text-subtle)",
                  border: "none",
                  padding: "10px 18px",
                  borderRadius: 999,
                  fontWeight: 600,
                  fontSize: "var(--fs-sm)",
                  cursor: consentChecked ? "pointer" : "not-allowed",
                }}
              >
                {runPhase === "starting" ? "Starting…" : "Start handover export"}
              </button>
            </Panel>
          ) : null}

          {/* Live run */}
          {streaming && (
            <>
              <Panel>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-12)", flexWrap: "wrap" }}>
                  <PhaseStepper phasesSeen={state.phasesSeen} current={state.phase} done={done} />
                  <div style={{ flex: 1 }} />
                  {state.synthMode && (
                    <span className="mono subtle" style={{ fontSize: "var(--fs-2xs)" }}>
                      {state.synthMode === "fixture" ? "fixture (no API)" : state.synthModel ?? "model"}
                    </span>
                  )}
                </div>
                {state.consentState && (
                  <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: 8 }}>
                    Consent: {state.consentState}
                    {state.consentState === "declined" ? " — handover stopped." : ""}
                  </div>
                )}
                {connectionLost && !done && (
                  <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: 8, color: "var(--warn)" }}>
                    Connection lost — the handover continues in the background. Refresh to reattach.
                  </div>
                )}
                {state.errorMessage && (
                  <div style={{ fontSize: "var(--fs-meta)", marginTop: 8, color: "var(--danger)" }}>
                    {state.errorMessage}
                  </div>
                )}
              </Panel>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <InterviewFeed feed={state.feed} />
                {state.coverage ? (
                  <CoverageMeter coverage={state.coverage} />
                ) : (
                  <Panel>
                    <SectionLabel>Coverage</SectionLabel>
                    <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
                      Scored after capture completes.
                    </div>
                  </Panel>
                )}
              </div>
            </>
          )}

          {/* Done summary + RCP */}
          {done && (
            <Panel style={{ borderColor: "rgba(46,160,67,0.3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)" }}>
                <span style={{ fontSize: 18, color: "var(--success)" }}>✓</span>
                <div>
                  <div style={{ fontSize: "var(--fs-base)", fontWeight: 700, color: "var(--text)" }}>
                    Handover synthesized.
                  </div>
                  <div className="mono subtle" style={{ fontSize: "var(--fs-2xs)", marginTop: 2 }}>
                    {state.done?.status} · {Math.round((state.done?.weightedScore ?? 0) * 100)}% coverage ·{" "}
                    {state.done?.stoppedReason} · {state.done?.turns} turn
                    {state.done?.turns === 1 ? "" : "s"} · ${(state.done?.costUsd ?? 0).toFixed(4)}
                  </div>
                  <div className="mono subtle" style={{ fontSize: "var(--fs-2xs)", marginTop: 2 }}>
                    {state.done?.rcpPath}
                  </div>
                </div>
              </div>
            </Panel>
          )}

          {done && rcp && <RcpView rcp={rcp} />}
        </div>
      </div>
    </>
  );
}

export default function HandoverPage() {
  return (
    <Suspense fallback={null}>
      <HandoverPageInner />
    </Suspense>
  );
}
