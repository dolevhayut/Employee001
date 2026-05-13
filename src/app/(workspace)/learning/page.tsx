"use client";

import { useEffect, useState, useRef } from "react";
import { Icons } from "@/components/ex/icons";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";

// ─── Data ────────────────────────────────────────────────────────────────────

const EMPLOYEE = {
  name: "Dolev Hayut",
  role: "VP Engineering",
  initials: "AC",
  color: "#E8F0FE",
};

type Tier = "hot" | "warm" | "cold";

type ProfileFile = {
  name: string;
  desc: string;
  tier: Tier;
  window: string;
  seedDone: boolean;
  lastRefresh?: string;
};

const PROFILE_FILES: ProfileFile[] = [
  { name: "TONE.md",          desc: "Communication style",       tier: "hot",  window: "30 days",   seedDone: true,  lastRefresh: "2d ago" },
  { name: "TECHNICS.md",      desc: "Code review patterns",      tier: "hot",  window: "30 days",   seedDone: true,  lastRefresh: "2d ago" },
  { name: "QUESTIONS.md",     desc: "Recurring design questions", tier: "hot",  window: "30 days",   seedDone: true,  lastRefresh: "2d ago" },
  { name: "MOTIVATION.md",    desc: "Energy & burnout signals",   tier: "hot",  window: "30–60 days", seedDone: true, lastRefresh: "2d ago" },
  { name: "CIRCLES.md",       desc: "Collaboration graph",        tier: "hot",  window: "30–60 days", seedDone: true, lastRefresh: "2d ago" },
  { name: "MEASUREMENTS.md",  desc: "Cycle time & throughput",    tier: "hot",  window: "90 days",   seedDone: true,  lastRefresh: "2d ago" },
  { name: "EXPERTISE.md",     desc: "Tech stack & architecture",  tier: "warm", window: "6–12 mo",   seedDone: true,  lastRefresh: "11d ago" },
  { name: "INITIATIVES.md",   desc: "Change initiatives",         tier: "warm", window: "6 mo",      seedDone: true,  lastRefresh: "11d ago" },
  { name: "PHILOSOPHY.md",    desc: "Positions under pressure",   tier: "cold", window: "6–12 mo",   seedDone: true,  lastRefresh: "41d ago" },
  { name: "ARTIFACTS.md",     desc: "Major shipped projects",     tier: "cold", window: "12 mo",     seedDone: true,  lastRefresh: "41d ago" },
  { name: "ACHIEVEMENTS.md",  desc: "Crises & milestones",        tier: "cold", window: "12 mo",     seedDone: true,  lastRefresh: "41d ago" },
  { name: "VISIONCONTEXT.md", desc: "Visual & presentation style",tier: "cold", window: "6–12 mo",   seedDone: true,  lastRefresh: "41d ago" },
];

type Integration = {
  id: string;
  name: string;
  icon: string;
  maxHistory: string;
  seeded: string;
  records: string;
  color: string;
};

const INTEGRATIONS: Integration[] = [
  { id: "slack",  name: "Slack",   icon: "S", maxHistory: "90 days",  seeded: "90 days",  records: "8,421 messages", color: "#4A154B" },
  { id: "github", name: "GitHub",  icon: "G", maxHistory: "Unlimited", seeded: "180 days", records: "312 PR reviews",  color: "#24292e" },
  { id: "linear", name: "Linear",  icon: "L", maxHistory: "Unlimited", seeded: "180 days", records: "204 issues",      color: "#5E6AD2" },
  { id: "gmail",  name: "Gmail",   icon: "M", maxHistory: "12+ mo",   seeded: "180 days", records: "1,840 threads",   color: "#EA4335" },
];

type RefreshEvent = {
  week: string;
  date: string;
  filesUpdated: number;
  cost: string;
  tier: "hot" | "warm" | "cold+warm";
};

const REFRESH_HISTORY: RefreshEvent[] = [
  { week: "Week 1", date: "Apr 7",  filesUpdated: 6, cost: "$7.80", tier: "hot" },
  { week: "Week 2", date: "Apr 14", filesUpdated: 8, cost: "$9.10", tier: "cold+warm" },
  { week: "Week 3", date: "Apr 21", filesUpdated: 6, cost: "$7.95", tier: "hot" },
  { week: "Week 4", date: "Apr 28", filesUpdated: 6, cost: "$8.20", tier: "hot" },
];

type ActivityItem = {
  id: number;
  kind: "fetch" | "model" | "write";
  source: string;
  msg: string;
};

function seedActivity(): ActivityItem[] {
  return [
    { id: 1,  kind: "fetch", source: "slack",       msg: "Pulled 8,421 messages across #infra, #platform, #eng-leads" },
    { id: 2,  kind: "model", source: "claude.opus", msg: "Detected 14 tone patterns from Slack thread history" },
    { id: 3,  kind: "fetch", source: "github",      msg: "Indexed 312 PR reviews — last 180 days" },
    { id: 4,  kind: "model", source: "claude.opus", msg: "Wrote TONE.md — 3.2k tokens" },
    { id: 5,  kind: "fetch", source: "linear",      msg: "Pulled 204 issues + comments by Amir" },
    { id: 6,  kind: "write", source: "storage",     msg: "TECHNICS.md persisted (4.1k tokens)" },
    { id: 7,  kind: "model", source: "claude.opus", msg: "Identified 9 recurring architecture questions → QUESTIONS.md" },
    { id: 8,  kind: "fetch", source: "gmail",       msg: "Sampled 1,840 sent threads (last 6 months)" },
    { id: 9,  kind: "model", source: "claude.opus", msg: "EXPERTISE.md: detected preference for reversible infra decisions" },
    { id: 10, kind: "write", source: "storage",     msg: "PHILOSOPHY.md persisted — 18 examples across 6 months" },
  ];
}

const LIVE_ACTIVITY: Omit<ActivityItem, "id">[] = [
  { kind: "fetch", source: "slack",       msg: "Scanning new messages since last refresh…" },
  { kind: "model", source: "claude.opus", msg: "Comparing TONE.md delta — 92% overlap, updating 3 patterns" },
  { kind: "fetch", source: "github",      msg: "Pulled 14 new PR reviews from last 30 days" },
  { kind: "model", source: "claude.opus", msg: "CIRCLES.md: 2 new collaborators detected (Maya, Tamir)" },
  { kind: "write", source: "storage",     msg: "MEASUREMENTS.md refreshed — cycle time improved 12%" },
  { kind: "model", source: "claude.opus", msg: "MOTIVATION.md: consistent engagement pattern, no burnout signals" },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

const TIER_LABEL: Record<Tier, string> = {
  hot:  "Weekly",
  warm: "Monthly",
  cold: "Quarterly",
};

const TIER_COLOR: Record<Tier, string> = {
  hot:  "var(--accent)",
  warm: "var(--success)",
  cold: "var(--text-subtle)",
};

function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      style={{
        fontSize: "var(--fs-2xs)",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: TIER_COLOR[tier],
        padding: "2px 5px",
        borderRadius: 3,
        border: `1px solid ${TIER_COLOR[tier]}`,
        lineHeight: 1,
        opacity: tier === "cold" ? 0.7 : 1,
      }}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

function ActivityRow({ kind, source, msg }: Omit<ActivityItem, "id">) {
  const tone =
    kind === "model" ? "var(--accent)"
    : kind === "write" ? "var(--success)"
    : "var(--text-muted)";
  const icon =
    kind === "model" ? <Icons.Sparkle2 size={10} />
    : kind === "write" ? <Icons.Check size={10} />
    : <Icons.ArrowDown size={10} />;
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--sp-8)",
        padding: "5px 0",
        alignItems: "flex-start",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <span style={{ color: tone, marginTop: "var(--sp-2)", flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="mono subtle" style={{ fontSize: "var(--fs-xs)", marginRight: "var(--sp-5)" }}>{source}</span>
        <span style={{ fontSize: "var(--fs-meta)", lineHeight: 1.4 }}>{msg}</span>
      </div>
    </div>
  );
}

// ─── Phase 1 Panel ────────────────────────────────────────────────────────────

function Phase1Panel() {
  const hotFiles  = PROFILE_FILES.filter((f) => f.tier === "hot");
  const warmFiles = PROFILE_FILES.filter((f) => f.tier === "warm");
  const coldFiles = PROFILE_FILES.filter((f) => f.tier === "cold");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-20)" }}>
      {/* Status header */}
      <div
        className="card"
        style={{
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-14)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--success)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            <Icons.Check size={14} />
          </div>
          <div>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>Initial seed complete</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>Ran once · 22 minutes · Mar 1, 2026</div>
          </div>
          <div style={{ flex: 1 }} />
          <span className="badge success">
            <span className="dot success" style={{ boxShadow: "none" }} /> Done
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 0,
            borderTop: "1px solid var(--hairline)",
            paddingTop: "var(--sp-14)",
          }}
        >
          <div>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-3)" }}>Window</div>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, letterSpacing: "-0.01em" }}>180 days</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--hairline)", paddingLeft: "var(--sp-16)" }}>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-3)" }}>Files built</div>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, letterSpacing: "-0.01em" }}>12 / 12</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--hairline)", paddingLeft: "var(--sp-16)" }}>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-3)" }}>Seed cost</div>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, letterSpacing: "-0.01em" }}>$44.80</div>
          </div>
        </div>
      </div>

      {/* Integrations */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          className="section-title"
          style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--hairline)" }}
        >
          Data sources · {INTEGRATIONS.length} connected
        </div>
        {INTEGRATIONS.map((int, i) => (
          <div
            key={int.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-12)",
              padding: "11px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: int.color,
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontSize: "var(--fs-meta)",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {int.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>{int.name}</div>
              <div className="subtle" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}>{int.records}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: "var(--fs-meta)", fontWeight: 600 }}>
                {int.seeded}
              </div>
              <div className="subtle" style={{ fontSize: "var(--fs-xs)" }}>seeded</div>
            </div>
            <div style={{ textAlign: "right", minWidth: 64 }}>
              <div className="subtle" style={{ fontSize: "var(--fs-xs)" }}>max available</div>
              <div className="mono subtle" style={{ fontSize: "var(--fs-xs)" }}>{int.maxHistory}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Profile files by tier */}
      {([
        ["hot",  "Hot tier — refreshed weekly",     hotFiles],
        ["warm", "Warm tier — refreshed monthly",    warmFiles],
        ["cold", "Cold tier — refreshed quarterly",  coldFiles],
      ] as [Tier, string, ProfileFile[]][]).map(([tier, label, files]) => (
        <div key={tier} className="card" style={{ overflow: "hidden" }}>
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-8)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: TIER_COLOR[tier],
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span className="section-title" style={{ flex: 1 }}>{label}</span>
            <span className="mono subtle" style={{ fontSize: "var(--fs-xs)" }}>window: {files[0]?.window}</span>
          </div>
          {files.map((f, i) => (
            <div
              key={f.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-10)",
                padding: "9px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
              }}
            >
              <span className="dot success" style={{ boxShadow: "none", width: 6, height: 6, flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: "var(--fs-meta)", fontWeight: 500, width: 140, flexShrink: 0 }}>
                {f.name}
              </span>
              <span className="subtle" style={{ fontSize: "var(--fs-meta)", flex: 1 }}>{f.desc}</span>
              <TierBadge tier={tier} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Phase 2 Panel ────────────────────────────────────────────────────────────

function Phase2Panel({ tick }: { tick: number }) {
  const nextRefreshDays = 4;
  const nextRefreshHrs  = 14;

  const totalSecondsLeft = (nextRefreshDays * 86400) + (nextRefreshHrs * 3600);
  const totalWindow      = 7 * 86400;
  const elapsed          = totalWindow - totalSecondsLeft;
  const weekPct          = elapsed / totalWindow;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-20)" }}>
      {/* Status header */}
      <div className="card" style={{ padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-16)" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent-deep)",
              flexShrink: 0,
            }}
          >
            <Icons.Refresh size={14} className="spin" />
          </div>
          <div>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>Rolling refresh active</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>Every Monday · 02:00 UTC</div>
          </div>
          <div style={{ flex: 1 }} />
          <span className="badge warn">
            <Icons.Refresh size={9} className="spin" /> Running
          </span>
        </div>

        {/* Countdown ring */}
        <div
          style={{
            background: "var(--bg-sunken)",
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: "var(--sp-14)",
          }}
        >
          <div
            style={{ fontSize: "var(--fs-xs)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: "var(--sp-8)" }}
          >
            Next refresh
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-12)" }}>
            <div
              style={{
                fontSize: "var(--fs-h3)",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
                color: "var(--accent-deep)",
              }}
            >
              {nextRefreshDays}d {nextRefreshHrs}h
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  height: 5,
                  background: "var(--hairline)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: weekPct * 100 + "%",
                    height: "100%",
                    background: "var(--accent)",
                    transition: "width 1s linear",
                    borderRadius: 3,
                  }}
                />
              </div>
              <div
                className="subtle mono"
                style={{ fontSize: "var(--fs-2xs)", marginTop: "var(--sp-4)", display: "flex", justifyContent: "space-between" }}
              >
                <span>Mon Apr 28</span>
                <span>Mon May 5</span>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 0,
            borderTop: "1px solid var(--hairline)",
            paddingTop: "var(--sp-14)",
          }}
        >
          <div>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-3)" }}>Rolling window</div>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 600 }}>30 days</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--hairline)", paddingLeft: "var(--sp-16)" }}>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-3)" }}>Per refresh</div>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 600 }}>~$8</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--hairline)", paddingLeft: "var(--sp-16)" }}>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-3)" }}>Monthly cost</div>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 600 }}>~$32</div>
          </div>
        </div>
      </div>

      {/* Refresh schedule */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          className="section-title"
          style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--hairline)" }}
        >
          Refresh schedule
        </div>
        {(
          [
            { tier: "hot"  as Tier, label: "Hot tier",  files: "TONE, TECHNICS, QUESTIONS, MOTIVATION, CIRCLES, MEASUREMENTS", cadence: "Every Monday", color: "var(--accent)" },
            { tier: "warm" as Tier, label: "Warm tier", files: "EXPERTISE, INITIATIVES",                                         cadence: "1st of month",  color: "var(--success)" },
            { tier: "cold" as Tier, label: "Cold tier", files: "PHILOSOPHY, ARTIFACTS, ACHIEVEMENTS, VISIONCONTEXT",             cadence: "Quarterly",     color: "var(--text-subtle)" },
          ]
        ).map((row, i) => (
          <div
            key={row.tier}
            style={{
              display: "flex",
              gap: "var(--sp-12)",
              padding: "13px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: row.color,
                flexShrink: 0,
                marginTop: "var(--sp-4)",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", marginBottom: "var(--sp-4)" }}>
                <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>{row.label}</span>
                <TierBadge tier={row.tier} />
              </div>
              <div className="subtle" style={{ fontSize: "var(--fs-meta)", lineHeight: 1.4 }}>{row.files}</div>
            </div>
            <div className="mono" style={{ fontSize: "var(--fs-meta)", color: row.color, flexShrink: 0, fontWeight: 600 }}>
              {row.cadence}
            </div>
          </div>
        ))}
      </div>

      {/* Refresh history */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          className="section-title"
          style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--hairline)" }}
        >
          Refresh history · last 4 weeks
        </div>
        {REFRESH_HISTORY.map((ev, i) => {
          const isWarm = ev.tier === "cold+warm";
          return (
            <div
              key={ev.week}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-12)",
                padding: "10px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: isWarm ? "var(--success)" : "var(--accent)",
                  flexShrink: 0,
                }}
              />
              <span className="mono" style={{ fontSize: "var(--fs-meta)", width: 54, color: "var(--text-subtle)" }}>
                {ev.date}
              </span>
              <span style={{ fontSize: "var(--fs-sm)", flex: 1 }}>
                {ev.filesUpdated} files refreshed
                {isWarm && (
                  <span className="subtle"> · included warm tier</span>
                )}
              </span>
              <span className="mono" style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                {ev.cost}
              </span>
              <span className="badge success" style={{ fontSize: "var(--fs-2xs)" }}>
                <Icons.Check size={8} /> OK
              </span>
            </div>
          );
        })}
      </div>

      {/* Live activity */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px 10px",
            borderBottom: "1px solid var(--hairline)",
            gap: "var(--sp-8)",
          }}
        >
          <div className="section-title" style={{ flex: 1 }}>Live activity</div>
          <span className="row mono subtle" style={{ fontSize: "var(--fs-xs)", gap: "var(--sp-5)" }}>
            <span className="dot success pulse" style={{ width: 5, height: 5 }} />
            live
          </span>
        </div>
        <div style={{ padding: "8px 16px 12px", display: "flex", flexDirection: "column", gap: 0 }}>
          {LIVE_ACTIVITY.slice(0, Math.min(LIVE_ACTIVITY.length, 3 + (tick % 4))).map((a, i) => (
            <ActivityRow key={i} {...a} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LearningPage() {
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<1 | 2>(1);
  const activity = useRef(seedActivity());

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <Topbar crumbs={["Employees", "Dolev Hayut", "Learning"]} />
      <div
        className="scrollbar"
        style={{ flex: 1, overflow: "auto", padding: "32px 40px 80px" }}
      >
        <PageHead
          icon="Spark"
          title="Learning window"
          subtitle="See what data sources were used to build this twin, how far back we read, and how often each profile file refreshes. This explains the twin’s “memory budget”."
          style={{ marginBottom: "var(--sp-16)", maxWidth: 1100 }}
        />
        {/* Page header */}
        <div style={{ marginBottom: "var(--sp-28)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-14)", marginBottom: "var(--sp-8)" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: EMPLOYEE.color,
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: "var(--fs-body)",
                color: "var(--text)",
                flexShrink: 0,
              }}
            >
              {EMPLOYEE.initials}
            </div>
            <div>
              <h1
                style={{
                  fontSize: "var(--fs-h3)",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  margin: "0 0 3px",
                }}
              >
                {EMPLOYEE.name}
              </h1>
              <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0 }}>
                {EMPLOYEE.role} · Twin Learning Window
              </p>
            </div>
            <div style={{ flex: 1 }} />
            <span className="badge success">
              <span className="dot success pulse" style={{ boxShadow: "none" }} />
              Twin ready · 93% confidence
            </span>
          </div>

          {/* Explainer */}
          <div
            className="card"
            style={{
              padding: "14px 18px",
              background: "var(--accent-soft)",
              border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
              display: "flex",
              gap: "var(--sp-10)",
              alignItems: "flex-start",
            }}
          >
            <Icons.Sparkle2 size={14} style={{ color: "var(--accent-deep)", marginTop: "var(--sp-1)", flexShrink: 0 }} />
            <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0, color: "var(--text-muted)" }}>
              Learning happens in two phases: a <strong style={{ color: "var(--text)" }}>one-time initial seed</strong> that pulls 180 days of historical data, and a <strong style={{ color: "var(--text)" }}>rolling weekly refresh</strong> that keeps the twin current. Different profile dimensions refresh at different rates — communication style updates weekly, architectural philosophy updates quarterly.
            </p>
          </div>
        </div>

        {/* Phase tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            marginBottom: "var(--sp-24)",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            overflow: "hidden",
            background: "var(--surface)",
          }}
        >
          {([1, 2] as (1 | 2)[]).map((p) => {
            const active = phase === p;
            const label  = p === 1 ? "Phase 1 — Initial Seed" : "Phase 2 — Rolling Refresh";
            const sub    = p === 1 ? "One-time · 180 days · $44.80" : "Weekly · 30 days · ~$8/refresh";
            const status = p === 1 ? (
              <span className="badge success" style={{ fontSize: "var(--fs-2xs)" }}><Icons.Check size={8} /> Complete</span>
            ) : (
              <span className="badge warn" style={{ fontSize: "var(--fs-2xs)" }}><Icons.Refresh size={8} className="spin" /> Active</span>
            );
            return (
              <button
                key={p}
                onClick={() => setPhase(p)}
                style={{
                  flex: 1,
                  padding: "16px 24px",
                  textAlign: "left",
                  background: active ? "var(--bg)" : "transparent",
                  border: "none",
                  borderRight: p === 1 ? "1px solid var(--hairline)" : "none",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-4)",
                  position: "relative",
                }}
              >
                {active && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: "var(--accent)",
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
                  <span
                    style={{
                      fontSize: "var(--fs-base)",
                      fontWeight: active ? 600 : 500,
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    {label}
                  </span>
                  {status}
                </div>
                <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>{sub}</div>
              </button>
            );
          })}
        </div>

        {/* Phase content */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: phase === 1 ? "1fr" : "1fr 1fr",
            gap: "var(--sp-24)",
          }}
        >
          {phase === 1 ? (
            <Phase1Panel />
          ) : (
            <>
              {/* Left col: what changed */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-20)" }}>
                <Phase1PanelCompact />
              </div>
              {/* Right col: refresh detail */}
              <Phase2Panel tick={tick} />
            </>
          )}
        </div>

        {/* Cost summary footer */}
        <div
          className="card"
          style={{
            marginTop: "var(--sp-28)",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-32)",
          }}
        >
          <div>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-2)" }}>Seed cost (one-time)</div>
            <div style={{ fontSize: "var(--fs-lg)", fontWeight: 700, letterSpacing: "-0.02em" }}>$44.80</div>
          </div>
          <div
            style={{ width: 1, height: 32, background: "var(--hairline)" }}
          />
          <div>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-2)" }}>Weekly refresh</div>
            <div style={{ fontSize: "var(--fs-lg)", fontWeight: 700, letterSpacing: "-0.02em" }}>~$8.00</div>
          </div>
          <div
            style={{ width: 1, height: 32, background: "var(--hairline)" }}
          />
          <div>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-2)" }}>Monthly steady-state</div>
            <div style={{ fontSize: "var(--fs-lg)", fontWeight: 700, letterSpacing: "-0.02em" }}>~$32.00</div>
          </div>
          <div
            style={{ width: 1, height: 32, background: "var(--hairline)" }}
          />
          <div>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-2)" }}>Total since onboard</div>
            <div style={{ fontSize: "var(--fs-lg)", fontWeight: 700, letterSpacing: "-0.02em" }}>$116.60</div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="subtle" style={{ fontSize: "var(--fs-meta)", maxWidth: 260, lineHeight: 1.5, textAlign: "right" }}>
            Costs use Claude Opus 4.7. Prompt caching reduces input costs by ~70% on refreshes.
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Compact Phase 1 (shown alongside Phase 2) ───────────────────────────────

function Phase1PanelCompact() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-20)" }}>
      <div className="card" style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", marginBottom: "var(--sp-14)" }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--success)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            <Icons.Check size={10} />
          </div>
          <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>Phase 1 complete</span>
          <div style={{ flex: 1 }} />
          <span className="subtle mono" style={{ fontSize: "var(--fs-xs)" }}>Mar 1, 2026</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          <div>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-2)" }}>Seed window</div>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>180 days</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--hairline)", paddingLeft: "var(--sp-14)" }}>
            <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-2)" }}>One-time cost</div>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>$44.80</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div
          className="section-title"
          style={{ padding: "10px 16px 8px", borderBottom: "1px solid var(--hairline)" }}
        >
          12 profile files built
        </div>
        {PROFILE_FILES.map((f, i) => (
          <div
            key={f.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-8)",
              padding: "7px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
            }}
          >
            <span className="dot success" style={{ boxShadow: "none", width: 5, height: 5, flexShrink: 0 }} />
            <span className="mono" style={{ fontSize: "var(--fs-meta)", flex: 1 }}>{f.name}</span>
            <span className="subtle" style={{ fontSize: "var(--fs-xs)" }}>{f.window}</span>
            <TierBadge tier={f.tier} />
          </div>
        ))}
      </div>
    </div>
  );
}
