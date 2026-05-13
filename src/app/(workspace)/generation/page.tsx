"use client";

import { useEffect, useState } from "react";
import { Icons } from "@/components/ex/icons";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";
import {
  PROFILE_FILES,
  SAMPLE_CONTENT,
  type ContentLine,
  type ProfileFile,
  type ProfileFileStatus,
} from "@/lib/ex-profile-files";

type ActivityKind = "fetch" | "model" | "write" | "warn";
type Activity = {
  id: number;
  kind: ActivityKind;
  source: string;
  msg: string;
  time: string;
};

function seedActivity(): Activity[] {
  return [
    { id: 1,  kind: "model", source: "claude.opus",  msg: "Token batch 14/20 written → DECISIONS.md", time: "now" },
    { id: 2,  kind: "fetch", source: "github",       msg: "Fetched 84 PR reviews from acme-inc/onboarding", time: "5s" },
    { id: 3,  kind: "fetch", source: "linear",       msg: "Fetched 312 issues with comments by maya", time: "8s" },
    { id: 4,  kind: "model", source: "claude.opus",  msg: "Detected pattern: prefers reversible decisions (12 examples)", time: "14s" },
    { id: 5,  kind: "write", source: "supabase",     msg: "Persisted profile_files row for EXPERTISE.md", time: "32s" },
    { id: 6,  kind: "fetch", source: "gmail",        msg: "Sampled 1,240 sent threads (last 12mo)", time: "1m" },
    { id: 7,  kind: "model", source: "claude.opus",  msg: "Started DECISIONS.md — context: 18.4k tokens", time: "1m" },
    { id: 8,  kind: "warn",  source: "rate-limit",   msg: "Throttled github reads to 5K/hr — backing off", time: "2m" },
    { id: 9,  kind: "fetch", source: "slack",        msg: "Fetched threads from #activation, #pm-leads, #ask-maya", time: "3m" },
    { id: 10, kind: "model", source: "claude.opus",  msg: "Cluster: 'small reversible bets' — 9 supporting examples", time: "3m" },
    { id: 11, kind: "write", source: "supabase",     msg: "Persisted profile_files row for TONE.md", time: "4m" },
    { id: 12, kind: "fetch", source: "outlook",      msg: "Indexed 3,421 inbound threads", time: "5m" },
  ];
}

const RANDOM_SAMPLES: Omit<Activity, "id" | "time">[] = [
  { kind: "model", source: "claude.opus",  msg: "Generating paragraph in DECISIONS.md…" },
  { kind: "fetch", source: "linear",       msg: "Pulled 12 new comments by maya" },
  { kind: "fetch", source: "github",       msg: "Re-read PR #2841 review notes" },
  { kind: "model", source: "claude.opus",  msg: "Found supporting quote from #activation thread (Aug 14)" },
  { kind: "write", source: "supabase",     msg: "Streamed token block to profile_files.content" },
  { kind: "model", source: "claude.haiku", msg: "Confidence pre-score: 0.82 on draft section" },
];

function randomActivity(): Activity {
  const s = RANDOM_SAMPLES[Math.floor(Math.random() * RANDOM_SAMPLES.length)];
  return { ...s, id: Math.random(), time: "now" };
}

function FileStatusIcon({ status }: { status: ProfileFileStatus }) {
  if (status === "done") {
    return <span className="dot success" style={{ boxShadow: "none", width: 8, height: 8 }} />;
  }
  if (status === "running") {
    return <Icons.Refresh size={12} className="spin" style={{ color: "var(--accent)" }} />;
  }
  return <span className="dot idle" style={{ boxShadow: "none", width: 8, height: 8 }} />;
}

function ContentLineView({ line }: { line: ContentLine }) {
  if (line.t === "h1") {
    return (
      <h2 style={{ fontSize: "var(--fs-h4)", fontWeight: 600, letterSpacing: "-0.01em", margin: "16px 0 10px" }}>
        {line.v}
      </h2>
    );
  }
  if (line.t === "h2") {
    return (
      <h3
        style={{
          fontSize: "var(--fs-ui)",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: ".06em",
          margin: "14px 0 6px",
        }}
      >
        {line.v}
      </h3>
    );
  }
  if (line.t === "li") {
    return (
      <div style={{ fontSize: "var(--fs-ui)", lineHeight: 1.6, padding: "2px 0 2px 16px", position: "relative" }}>
        <span style={{ position: "absolute", left: 0, color: "var(--text-subtle)" }}>—</span>
        {line.v}
      </div>
    );
  }
  if (line.t === "q") {
    return (
      <blockquote
        style={{
          fontSize: "var(--fs-ui)",
          lineHeight: 1.6,
          margin: "8px 0",
          padding: "8px 14px",
          borderLeft: "2px solid var(--accent)",
          background: "var(--surface-soft)",
          color: "var(--text-muted)",
          fontStyle: "italic",
        }}
      >
        &ldquo;{line.v}&rdquo;
      </blockquote>
    );
  }
  return (
    <p style={{ fontSize: "var(--fs-ui)", lineHeight: 1.65, margin: "6px 0", color: "var(--text)" }}>
      {line.v}
    </p>
  );
}

function FilePreview({
  file,
  tick,
  paused,
}: {
  file: ProfileFile;
  tick: number;
  paused: boolean;
}) {
  const content = SAMPLE_CONTENT[file.name] || SAMPLE_CONTENT.default;
  const visibleLines: ContentLine[] =
    file.status === "running"
      ? content.slice(0, Math.min(content.length, 4 + (paused ? 8 : tick % (content.length + 6))))
      : file.status === "done"
        ? content
        : [];

  return (
    <div className="scrollbar" style={{ overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div
        className="row"
        style={{ padding: "14px 24px", borderBottom: "1px solid var(--hairline)", gap: "var(--sp-10)" }}
      >
        <FileStatusIcon status={file.status} />
        <span className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
          {file.name}
        </span>
        <span className="badge" style={{ marginLeft: "var(--sp-4)" }}>
          {file.status === "running"
            ? "Streaming"
            : file.status === "done"
              ? "Ready for review"
              : "Queued"}
        </span>
        <div className="spacer" />
        {file.status === "done" && (
          <button className="btn sm">
            <Icons.Eye size={11} /> Preview
          </button>
        )}
        {file.status === "done" && (
          <button className="btn sm primary">
            <Icons.Check size={11} /> Mark reviewed
          </button>
        )}
      </div>

      <div style={{ flex: 1, padding: "20px 32px", maxWidth: 720 }}>
        {file.status === "queued" ? (
          <div
            className="col"
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: "60px 0",
              textAlign: "center",
              color: "var(--text-subtle)",
            }}
          >
            <Icons.Clock size={20} />
            <div style={{ fontSize: "var(--fs-ui)", marginTop: "var(--sp-8)" }}>
              Queued — generation starts after running files complete.
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", marginBottom: "var(--sp-8)" }}>
              <span className="mono">~/profile/{file.name}</span>
            </div>
            {visibleLines.map((line, i) => (
              <ContentLineView key={i} line={line} />
            ))}
            {file.status === "running" && (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 14,
                  background: "var(--accent)",
                  animation: "pulse-soft 0.8s ease-in-out infinite",
                  verticalAlign: "text-bottom",
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ kind, source, msg, time }: Activity) {
  const tone =
    kind === "model"
      ? "var(--accent)"
      : kind === "write"
        ? "var(--success)"
        : kind === "warn"
          ? "var(--warn)"
          : "var(--text-muted)";
  const ico =
    kind === "model" ? (
      <Icons.Sparkle2 size={11} />
    ) : kind === "write" ? (
      <Icons.Check size={11} />
    ) : kind === "warn" ? (
      <Icons.Bell size={11} />
    ) : (
      <Icons.ArrowDown size={11} />
    );
  return (
    <div className="row" style={{ padding: "6px 0", gap: "var(--sp-8)", alignItems: "flex-start" }}>
      <span style={{ color: tone, marginTop: "var(--sp-2)" }}>{ico}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.45 }}>
          {source && (
            <span className="mono subtle" style={{ marginRight: "var(--sp-6)" }}>
              {source}
            </span>
          )}
          {msg}
        </div>
      </div>
      <span className="mono subtle" style={{ fontSize: "var(--fs-xs)" }}>
        {time}
      </span>
    </div>
  );
}

function CostStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-2)" }}>
        {label}
      </div>
      <div className="row" style={{ gap: "var(--sp-6)", alignItems: "baseline" }}>
        <span className="mono" style={{ fontWeight: 600, fontSize: "var(--fs-base)" }}>
          {value}
        </span>
        {sub && (
          <span className="subtle mono" style={{ fontSize: "var(--fs-xs)" }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

export default function GenerationPage() {
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState("DECISIONS.md");
  const [activity, setActivity] = useState<Activity[]>(() => seedActivity());

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      setTick((n) => n + 1);
      setActivity((a) => [randomActivity(), ...a].slice(0, 80));
    }, 1400);
    return () => clearInterval(t);
  }, [paused]);

  const files = PROFILE_FILES;
  const done = files.filter((f) => f.status === "done").length;
  const running = files.filter((f) => f.status === "running").length;
  const total = files.length;
  const pct = (done + running * 0.5) / total;
  const focused = files.find((f) => f.name === selected) || files[0];

  return (
    <>
      <Topbar crumbs={["Workspace", "Profile", "Generation"]} />
      <div className="scrollbar" style={{ overflow: "auto", padding: 0 }}>
        {/* Header */}
        <div style={{ padding: "28px 40px 20px", borderBottom: "1px solid var(--hairline)" }}>
          <PageHead
            icon="Spark"
            title="Profile generation"
            subtitle="Track how a twin’s profile is built: ingestion, writing progress, and a live preview of each markdown file."
            style={{ marginBottom: "var(--sp-16)", maxWidth: 1100 }}
          />
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="row" style={{ gap: "var(--sp-10)", marginBottom: "var(--sp-8)" }}>
                <span className="badge accent">
                  <Icons.Sparkle2 size={11} /> Generating
                </span>
                <span className="subtle mono" style={{ fontSize: "var(--fs-meta)" }}>
                  job_q4p2x · started 18 min ago
                </span>
              </div>
              <div className="subtle" style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
                Claude is reading recent activity and generating a set of profile files (expertise, tone,
                boundaries, decisions, and more).
              </div>
            </div>
            <div className="spacer" />
            <button className="btn" onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="btn ghost">
              <Icons.X size={13} /> Cancel
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: "var(--sp-22)" }}>
            <div className="row mono" style={{ fontSize: "var(--fs-meta)", marginBottom: "var(--sp-6)" }}>
              <span className="subtle">
                {done} of {total} files complete · {running} running
              </span>
              <div className="spacer" />
              <span>{Math.round(pct * 100)}%</span>
            </div>
            <div
              style={{
                height: 6,
                background: "var(--bg-sunken)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: pct * 100 + "%",
                  height: "100%",
                  background:
                    "linear-gradient(90deg, var(--accent) 0%, var(--accent-deep) 100%)",
                  transition: "width .4s ease",
                }}
              />
            </div>
          </div>
        </div>

        {/* Body — split */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr) minmax(0, 360px)",
            minHeight: 560,
          }}
        >
          {/* Files list */}
          <div style={{ padding: "14px 0", overflow: "hidden", borderRight: "1px solid var(--hairline)" }}>
            <div className="section-title" style={{ padding: "0 16px 8px" }}>
              Profile files · 12
            </div>
            {files.map((f) => (
              <button
                key={f.name}
                className="row"
                onClick={() => setSelected(f.name)}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  gap: "var(--sp-12)",
                  textAlign: "left",
                  background: selected === f.name ? "var(--surface-soft)" : "transparent",
                  borderLeft:
                    "2px solid " + (selected === f.name ? "var(--accent)" : "transparent"),
                  border: "none",
                  borderLeftWidth: 2,
                  borderLeftStyle: "solid",
                  borderLeftColor: selected === f.name ? "var(--accent)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <FileStatusIcon status={f.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: "var(--fs-sm)",
                      fontWeight: 500,
                      color:
                        f.status === "queued" ? "var(--text-subtle)" : "var(--text)",
                    }}
                  >
                    {f.name}
                  </div>
                  <div
                    className="subtle"
                    style={{
                      fontSize: "var(--fs-xs)",
                      marginTop: "var(--sp-1)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {f.desc}
                  </div>
                </div>
                {f.tokens > 0 && (
                  <span className="mono subtle" style={{ fontSize: "var(--fs-xs)" }}>
                    {(f.tokens / 1000).toFixed(1)}k
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Center: focused file preview / streaming */}
          <FilePreview file={focused} tick={tick} paused={paused} />

          {/* Activity stream */}
          <div
            style={{
              borderLeft: "1px solid var(--hairline)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              maxHeight: 700,
            }}
          >
            <div className="row" style={{ padding: "14px 16px 8px" }}>
              <div className="section-title">Activity</div>
              <div className="spacer" />
              {!paused && (
                <span className="row mono subtle" style={{ fontSize: "var(--fs-xs)", gap: "var(--sp-5)" }}>
                  <span className="dot success pulse" style={{ width: 5, height: 5 }} />
                  live
                </span>
              )}
            </div>
            <div
              className="scrollbar"
              style={{ overflow: "auto", padding: "4px 16px 16px" }}
            >
              {activity.map((a) => (
                <ActivityRow key={a.id} {...a} />
              ))}
            </div>
          </div>
        </div>

        {/* Cost row */}
        <div
          className="row"
          style={{
            padding: "14px 40px",
            gap: "var(--sp-24)",
            fontSize: "var(--fs-sm)",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <CostStat label="Input tokens" value="284K" sub="cached: 71%" />
          <CostStat label="Output tokens" value="38K" />
          <CostStat label="Tool calls" value="412" sub="of 20K monthly" />
          <CostStat label="Run cost" value="$28.40" sub="est. final $34" />
          <div className="spacer" />
          <span className="subtle">Costs settle when the job completes.</span>
        </div>
      </div>
    </>
  );
}
