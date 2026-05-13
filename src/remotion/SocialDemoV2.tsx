import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Manrope";

const { fontFamily } = loadFont("normal", {
  weights: ["300", "400", "500", "600"],
  subsets: ["latin"],
});

// ─── Palette — exact tokens from globals.css ──────────────────────────────────
const p = {
  bg: "#F5F1EA",
  elevated: "#FBF8F2",
  sunken: "#EFE9DE",
  surface: "#FFFFFF",
  hairline: "#E5DDD0",
  hairlineStrong: "#D4C9B5",
  text: "#1A1816",
  muted: "#6B6359",
  subtle: "#8F8678",
  accent: "#9E6B47",
  accentSoft: "#E8D8C7",
  accentDeep: "#6B4528",
  success: "#5C7A4A",
  warn: "#B5894A",
  danger: "#A04B3D",
  twin: "#4A6B7A",
  twinSoft: "#DBE5EA",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ci(v: number, i: [number, number], o: [number, number]) {
  return interpolate(v, i, o, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

function cs(v: number, i: [number, number], o: [number, number]) {
  return interpolate(v, i, o, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
}

// ─── Shared background ───────────────────────────────────────────────────────
function WarmBase({ accent = p.twin }: { accent?: string }) {
  const frame = useCurrentFrame();
  const driftX = Math.sin(frame / 95) * 18;
  const driftY = Math.cos(frame / 120) * 14;
  const ox = Math.sin(frame / 130) * 60;
  const oy = Math.cos(frame / 160) * 50;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: p.bg,
        backgroundImage: `linear-gradient(${p.hairline} 1px, transparent 1px), linear-gradient(90deg, ${p.hairline} 1px, transparent 1px)`,
        backgroundSize: "96px 96px",
        backgroundPosition: `${driftX}px ${driftY}px`,
      }}
    >
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(ellipse 860px 640px at ${820 + ox}px ${430 + oy}px, ${accent}1a, transparent 65%),
            radial-gradient(ellipse 560px 460px at ${1380 - ox * 0.5}px ${290 + oy * 0.6}px, ${p.accentSoft}88, transparent 60%),
            linear-gradient(180deg, rgba(245,241,234,.2), #F5F1EA 75%)
          `,
        }}
      />
    </AbsoluteFill>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo({ size = 56 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.15,
        background: p.text,
        color: p.bg,
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.3,
        fontWeight: 400,
        fontFamily,
        flexShrink: 0,
      }}
    >
      001
    </div>
  );
}

function TopBar() {
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Logo size={48} />
        <span style={{ color: p.text, fontSize: 30, fontWeight: 400 }}>
          Employee001
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: p.muted, fontSize: 22 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: p.success, display: "inline-block" }} />
        enterprise AI employees
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// SCENE 1: HOOK — "Your best people can't clone themselves."
// ═══════════════════════════════════════════════════════════════════════════════
function HookScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const line1In = spring({ frame: frame - 10, fps, config: { damping: 200, stiffness: 80 } });
  const line2In = spring({ frame: frame - 42, fps, config: { damping: 200, stiffness: 80 } });
  const badgeIn = cs(frame, [4, 28], [0, 1]);

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <WarmBase accent={p.twin} />
      <TopBar />

      {/* Center content */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          paddingTop: 20,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 20px",
            borderRadius: 999,
            border: `1px solid ${p.hairline}`,
            background: p.elevated,
            color: p.accentDeep,
            fontSize: 24,
            fontWeight: 400,
            opacity: badgeIn,
            marginBottom: 36,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: p.accent, display: "inline-block" }} />
          The future of enterprise staffing
        </div>

        <div
          style={{
            fontSize: 128,
            lineHeight: 0.9,
            fontWeight: 300,
            color: p.text,
            transform: `translateY(${(1 - line1In) * 50}px)`,
            opacity: ci(frame, [8, 28], [0, 1]),
            maxWidth: 1300,
          }}
        >
          Your best people
          <br />
          <span style={{ color: p.muted }}>can't clone themselves.</span>
        </div>

        <div
          style={{
            fontSize: 44,
            fontWeight: 400,
            color: p.muted,
            marginTop: 40,
            transform: `translateY(${(1 - line2In) * 32}px)`,
            opacity: ci(frame, [42, 62], [0, 1]),
            maxWidth: 820,
            lineHeight: 1.3,
          }}
        >
          Until now. Employee001 turns institutional knowledge into governed AI employees that work alongside your team.
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE 2: TWIN — "Meet your digital twin"
// ═══════════════════════════════════════════════════════════════════════════════
function TwinScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const panelIn = (delay: number) =>
    spring({ frame: frame - delay, fps, config: { damping: 180, stiffness: 90 } });

  const arrow = cs(frame, [40, 70], [0, 1]);
  const arrowPulse = 0.6 + Math.sin(frame / 10) * 0.25;

  const dataPoints = ["Communication style", "Decision patterns", "Domain expertise", "Historical context", "Tool preferences"];

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <WarmBase accent={p.accent} />
      <TopBar />

      <div
        style={{
          position: "absolute",
          left: 72,
          top: 136,
          fontSize: 22,
          fontWeight: 500,
          color: p.accent,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          opacity: ci(frame, [0, 18], [0, 1]),
        }}
      >
        How it works
      </div>

      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 168,
          bottom: 72,
          display: "flex",
          alignItems: "center",
          gap: 52,
        }}
      >
        {/* Human card */}
        <div
          style={{
            flex: 1,
            background: p.surface,
            border: `1px solid ${p.hairline}`,
            borderRadius: 12,
            padding: 40,
            transform: `translateX(${(1 - panelIn(8)) * -80}px)`,
            opacity: ci(frame, [8, 28], [0, 1]),
            height: 680,
            display: "flex",
            flexDirection: "column",
            gap: 22,
            boxShadow: "0 4px 16px rgba(26,24,22,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                background: p.accentSoft,
                border: `1.5px solid ${p.hairline}`,
                display: "grid",
                placeItems: "center",
                fontSize: 24,
                fontWeight: 500,
                color: p.accentDeep,
              }}
            >
              DH
            </div>
            <div>
              <div style={{ fontSize: 30, fontWeight: 500, color: p.text }}>Dolev Hayut</div>
              <div style={{ fontSize: 22, color: p.muted, marginTop: 3 }}>CEO & Founder</div>
            </div>
          </div>

          <div style={{ height: 1, background: p.hairline }} />

          <div style={{ fontSize: 20, color: p.subtle, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Employee knowledge
          </div>

          {dataPoints.map((pt, i) => (
            <div
              key={pt}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity: ci(frame, [16 + i * 6, 30 + i * 6], [0, 1]),
                transform: `translateX(${cs(frame, [16 + i * 6, 32 + i * 6], [-18, 0])}px)`,
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 99, background: p.twin, flexShrink: 0 }} />
              <span style={{ fontSize: 24, color: p.text }}>{pt}</span>
            </div>
          ))}

          <div
            style={{
              marginTop: "auto",
              padding: "14px 18px",
              borderRadius: 8,
              background: p.sunken,
              border: `1px solid ${p.hairline}`,
              color: p.muted,
              fontSize: 19,
            }}
          >
            Human · works 40h/week · one timezone
          </div>
        </div>

        {/* Arrow */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            opacity: arrow * arrowPulse,
            flexShrink: 0,
            width: 90,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: p.accent, letterSpacing: "0.08em" }}>TRAINS</div>
          <div style={{ fontSize: 52, color: p.accent }}>→</div>
        </div>

        {/* Twin card */}
        <div
          style={{
            flex: 1,
            background: p.surface,
            border: `1.5px solid ${p.twin}55`,
            borderRadius: 12,
            padding: 40,
            transform: `translateX(${(1 - panelIn(24)) * 80}px)`,
            opacity: ci(frame, [24, 44], [0, 1]),
            height: 680,
            display: "flex",
            flexDirection: "column",
            gap: 22,
            boxShadow: `0 4px 24px ${p.twin}18`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                background: p.twin,
                display: "grid",
                placeItems: "center",
                fontSize: 24,
                fontWeight: 500,
                color: "#fff",
              }}
            >
              AI
            </div>
            <div>
              <div style={{ fontSize: 30, fontWeight: 500, color: p.text }}>Dolev · Twin</div>
              <div style={{ fontSize: 22, marginTop: 3, display: "flex", alignItems: "center", gap: 7, color: p.twin }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: p.success, display: "inline-block" }} />
                Active · AI employee
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: `${p.twin}33` }} />

          <div style={{ fontSize: 20, color: p.subtle, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Twin capabilities
          </div>

          {[
            { label: "Responds as Dolev", bar: 0.94, color: p.twin },
            { label: "Makes decisions", bar: 0.88, color: p.accent },
            { label: "Executes tasks", bar: 0.91, color: p.success },
            { label: "Learns continuously", bar: 0.79, color: p.warn },
          ].map((item, i) => (
            <div
              key={item.label}
              style={{
                opacity: ci(frame, [32 + i * 7, 48 + i * 7], [0, 1]),
                transform: `translateX(${cs(frame, [32 + i * 7, 50 + i * 7], [18, 0])}px)`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 7,
                  fontSize: 23,
                  color: p.text,
                }}
              >
                <span>{item.label}</span>
                <span style={{ color: item.color }}>{Math.round(item.bar * 100)}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: p.sunken, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: 99,
                    background: item.color,
                    width: `${ci(frame, [40 + i * 7, 70 + i * 7], [0, item.bar * 100])}%`,
                  }}
                />
              </div>
            </div>
          ))}

          <div
            style={{
              marginTop: "auto",
              padding: "14px 18px",
              borderRadius: 8,
              background: p.twinSoft,
              border: `1px solid ${p.twin}33`,
              color: p.twin,
              fontSize: 19,
            }}
          >
            AI · works 24/7 · any timezone · governed
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE 3: AI TEAM MEETING
// ═══════════════════════════════════════════════════════════════════════════════
const meetingMessages = [
  { from: "CEO", color: p.text, delay: 12, text: "What's our Q3 growth strategy? I need input from all leads." },
  { from: "CMO · Twin", color: p.twin, delay: 52, text: "Based on our current pipeline and brand positioning, I'd recommend doubling down on content-led PLG and reducing paid by 20%." },
  { from: "CFO · Twin", color: p.success, delay: 82, text: "Agreed on the PLG angle. Runway supports a 15% increase in headcount if we hit Q2 ARR targets by June 30." },
  { from: "CPO · Twin", color: p.accent, delay: 108, text: "Product roadmap already accounts for the integrations needed to support PLG. I'll schedule a build week for the team." },
];

function ChatBubble({
  msg,
  frame,
}: {
  msg: (typeof meetingMessages)[number];
  frame: number;
}) {
  const enter = spring({
    frame: frame - msg.delay,
    fps: 30,
    config: { damping: 200, stiffness: 100 },
  });
  const visible = frame >= msg.delay;
  if (!visible) return null;

  const isTyping = frame >= msg.delay && frame < msg.delay + 18;
  const textReveal = Math.floor(ci(frame, [msg.delay + 18, msg.delay + 36], [0, msg.text.length]));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        transform: `translateY(${(1 - enter) * 24}px)`,
        opacity: ci(frame, [msg.delay, msg.delay + 12], [0, 1]),
      }}
    >
      <div style={{ fontSize: 19, fontWeight: 600, color: msg.color, letterSpacing: "0.01em" }}>
        {msg.from}
      </div>
      <div
        style={{
          background: p.elevated,
          border: `1px solid ${p.hairline}`,
          borderRadius: 10,
          padding: "14px 18px",
          fontSize: 22,
          color: p.text,
          lineHeight: 1.45,
          maxWidth: 820,
        }}
      >
        {isTyping ? (
          <span style={{ display: "flex", gap: 5, alignItems: "center", height: 22 }}>
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 99,
                  background: msg.color,
                  opacity: 0.5 + Math.sin(frame / 4 + d * 1.2) * 0.4,
                  display: "inline-block",
                }}
              />
            ))}
          </span>
        ) : (
          msg.text.slice(0, textReveal) + (textReveal < msg.text.length ? "▋" : "")
        )}
      </div>
    </div>
  );
}

function MeetingScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerIn = spring({ frame: frame - 6, fps, config: { damping: 200, stiffness: 100 } });

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <WarmBase accent={p.warn} />
      <TopBar />

      <div
        style={{
          position: "absolute",
          left: 72,
          top: 136,
          fontSize: 20,
          fontWeight: 500,
          color: p.warn,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          opacity: ci(frame, [0, 18], [0, 1]),
        }}
      >
        Feature 01 — AI Team Meetings

      </div>

      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 174,
          bottom: 72,
          display: "flex",
          gap: 44,
          alignItems: "flex-start",
        }}
      >
        {/* Left: headline */}
        <div
          style={{
            width: 360,
            flexShrink: 0,
            paddingTop: 18,
            transform: `translateY(${(1 - headerIn) * 30}px)`,
            opacity: ci(frame, [6, 26], [0, 1]),
          }}
        >
          <div style={{ fontSize: 80, lineHeight: 0.94, fontWeight: 300, color: p.text }}>
            Run AI
            <br />
            team
            <br />
            meetings
          </div>
          <div style={{ fontSize: 27, color: p.muted, marginTop: 26, lineHeight: 1.35 }}>
            Raise a topic. Every AI employee responds with their domain expertise.
          </div>

          <div
            style={{
              marginTop: 32,
              padding: "14px 20px",
              borderRadius: 8,
              background: p.accentSoft,
              border: `1px solid ${p.hairline}`,
              fontSize: 22,
              color: p.accentDeep,
            }}
          >
            CEO asks · agents answer
          </div>

        </div>

        {/* Right: chat window */}
        <div
          style={{
            flex: 1,
            background: p.surface,
            border: `1px solid ${p.hairline}`,
            borderRadius: 12,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 16px rgba(26,24,22,0.06)",
          }}
        >
          <div
            style={{
              padding: "16px 26px",
              borderBottom: `1px solid ${p.hairline}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: p.elevated,
            }}
          >
            <div style={{ width: 9, height: 9, borderRadius: 99, background: p.success }} />
            <span style={{ color: p.text, fontSize: 22, fontWeight: 500 }}>#leadership-meeting</span>
            <span style={{ color: p.muted, fontSize: 20, marginLeft: "auto" }}>
              {meetingMessages.length} AI participants active
            </span>
          </div>

          <div
            style={{
              flex: 1,
              padding: 26,
              display: "flex",
              flexDirection: "column",
              gap: 22,
              overflowY: "hidden",
            }}
          >
            {meetingMessages.map((msg) => (
              <ChatBubble key={msg.from} msg={msg} frame={frame} />
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE 4: AUTONOMOUS SHIFTS
// ═══════════════════════════════════════════════════════════════════════════════
const shifts = [
  { name: "Weekly Investor Update", agent: "CFO · Twin", day: "Mon", time: "08:00", duration: "2h", color: p.success, budget: 0.12, delay: 18 },
  { name: "Lead Scoring & Outreach", agent: "CMO · Twin", day: "Daily", time: "09:30", duration: "1.5h", color: p.twin, budget: 0.34, delay: 30 },
  { name: "Product Feedback Digest", agent: "CPO · Twin", day: "Fri", time: "15:00", duration: "1h", color: p.accent, budget: 0.08, delay: 42 },
  { name: "Support Triage & Escalation", agent: "COO · Twin", day: "Daily", time: "10:00", duration: "3h", color: p.warn, budget: 0.56, delay: 54 },
  { name: "Competitive Analysis", agent: "CMO · Twin", day: "Wed", time: "11:00", duration: "2h", color: p.danger, budget: 0.22, delay: 66 },
];

function ShiftScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headerIn = spring({ frame: frame - 6, fps, config: { damping: 200, stiffness: 100 } });

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <WarmBase accent={p.success} />
      <TopBar />

      <div
        style={{
          position: "absolute",
          left: 72,
          top: 136,
          fontSize: 20,
          fontWeight: 500,
          color: p.success,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          opacity: ci(frame, [0, 18], [0, 1]),
        }}
      >
        Feature 02 — Autonomous Shifts
      </div>

      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 174,
          bottom: 72,
          display: "flex",
          gap: 44,
          alignItems: "flex-start",
        }}
      >
        {/* Left: headline */}
        <div
          style={{
            width: 360,
            flexShrink: 0,
            paddingTop: 18,
            transform: `translateY(${(1 - headerIn) * 30}px)`,
            opacity: ci(frame, [6, 26], [0, 1]),
          }}
        >
          <div style={{ fontSize: 80, lineHeight: 0.94, fontWeight: 300, color: p.text }}>
            Schedule
            <br />
            recurring
            <br />
            work
          </div>
          <div style={{ fontSize: 27, color: p.muted, marginTop: 26, lineHeight: 1.35 }}>
            Put AI employees on shifts with defined budgets, windows, and operating rules.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 34 }}>
            {[
              { label: "Budget controlled", color: p.success },
              { label: "Time-windowed", color: p.twin },
              { label: "Audit logged", color: p.accent },
            ].map((item, i) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  opacity: ci(frame, [20 + i * 8, 36 + i * 8], [0, 1]),
                }}
              >
                <div style={{ width: 9, height: 9, borderRadius: 99, background: item.color }} />
                <span style={{ fontSize: 24, color: p.text }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: shift cards */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, paddingTop: 18 }}>
          {shifts.map((s) => (
            <div
              key={s.name}
              style={{
                background: p.surface,
                border: `1px solid ${p.hairline}`,
                borderLeft: `3px solid ${s.color}`,
                borderRadius: 10,
                padding: "16px 22px",
                display: "flex",
                alignItems: "center",
                gap: 18,
                transform: `translateX(${cs(frame, [s.delay, s.delay + 24], [60, 0])}px)`,
                opacity: ci(frame, [s.delay, s.delay + 16], [0, 1]),
                boxShadow: "0 1px 4px rgba(26,24,22,0.05)",
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 8,
                  background: p.sunken,
                  border: `1px solid ${p.hairline}`,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                  fontWeight: 600,
                  color: s.color,
                  flexShrink: 0,
                  textAlign: "center",
                  lineHeight: 1.15,
                }}
              >
                {s.day}
                <br />
                <span style={{ fontSize: 12, fontWeight: 400, color: p.muted }}>{s.time}</span>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 23, fontWeight: 500, color: p.text }}>{s.name}</div>
                <div style={{ fontSize: 19, color: p.muted, marginTop: 3 }}>
                  {s.agent} · {s.duration}
                </div>
                <div style={{ marginTop: 7, height: 4, borderRadius: 99, background: p.sunken }}>
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 99,
                      background: s.color,
                      width: `${ci(frame, [s.delay + 20, s.delay + 50], [0, s.budget * 100])}%`,
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  fontSize: 18,
                  color: s.color,
                  fontWeight: 500,
                  padding: "8px 14px",
                  borderRadius: 6,
                  background: p.sunken,
                  border: `1px solid ${p.hairline}`,
                }}
              >
                ${Math.round(s.budget * 100)}/mo
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE 5: ORG BRAIN — Knowledge graph
// ═══════════════════════════════════════════════════════════════════════════════
const brainNodes = [
  { id: "CEO", x: 760, y: 400, color: p.accent, size: 64, delay: 8 },
  { id: "Strategy", x: 500, y: 220, color: p.twin, size: 52, delay: 20 },
  { id: "Clients", x: 1010, y: 210, color: p.success, size: 52, delay: 24 },
  { id: "Process", x: 360, y: 430, color: p.accentDeep, size: 48, delay: 28 },
  { id: "Decisions", x: 1180, y: 390, color: p.warn, size: 48, delay: 32 },
  { id: "Culture", x: 530, y: 590, color: p.accent, size: 44, delay: 38 },
  { id: "Roadmap", x: 990, y: 580, color: p.twin, size: 44, delay: 42 },
  { id: "OKRs", x: 740, y: 590, color: p.success, size: 40, delay: 48 },
  { id: "Financials", x: 280, y: 290, color: p.subtle, size: 38, delay: 52 },
  { id: "Market", x: 1270, y: 240, color: p.subtle, size: 38, delay: 56 },
];

const brainEdges = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7],
  [1, 3], [1, 8], [2, 4], [2, 9], [5, 7], [6, 7], [3, 5],
];

function OrgBrainScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headerIn = spring({ frame: frame - 6, fps, config: { damping: 200, stiffness: 100 } });

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <WarmBase accent={p.twin} />
      <TopBar />

      <div
        style={{
          position: "absolute",
          left: 72,
          top: 136,
          fontSize: 20,
          fontWeight: 500,
          color: p.twin,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          opacity: ci(frame, [0, 18], [0, 1]),
        }}
      >
        Feature 03 — Company Brain
      </div>

      {/* Right side label block */}
      <div
        style={{
          position: "absolute",
          right: 72,
          top: 174,
          width: 400,
          paddingTop: 18,
          transform: `translateX(${(1 - headerIn) * 60}px)`,
          opacity: ci(frame, [6, 26], [0, 1]),
        }}
      >
        <div style={{ fontSize: 80, lineHeight: 0.94, fontWeight: 300, color: p.text }}>
          Every
          <br />
          insight,
          <br />
          preserved
        </div>
        <div style={{ fontSize: 27, color: p.muted, marginTop: 26, lineHeight: 1.35 }}>
          All decisions, documents, and context wired into a permanent company brain — accessible by every twin.
        </div>

        <div
          style={{
            marginTop: 32,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 26,
            borderRadius: 10,
            background: p.surface,
            border: `1px solid ${p.hairline}`,
            boxShadow: "0 2px 8px rgba(26,24,22,0.05)",
          }}
        >
          {[
            { v: 127, label: "knowledge nodes", color: p.twin },
            { v: 4800, label: "decisions indexed", color: p.success },
            { v: 38, label: "connected sources", color: p.accent },
          ].map((item, i) => (
            <div key={item.label} style={{ opacity: ci(frame, [30 + i * 10, 50 + i * 10], [0, 1]) }}>
              <div style={{ fontSize: 36, fontWeight: 600, color: item.color }}>
                {Math.floor(ci(frame, [30 + i * 10, 80 + i * 10], [0, item.v]))}+
              </div>
              <div style={{ fontSize: 20, color: p.muted }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Graph area */}
      <div style={{ position: "absolute", left: 72, top: 140, width: 1090, bottom: 60 }}>
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
          viewBox="0 0 1100 870"
        >
          {brainEdges.map(([a, b], i) => {
            const na = brainNodes[a];
            const nb = brainNodes[b];
            const maxDelay = Math.max(na.delay, nb.delay) + 12;
            const lineOpacity = ci(frame, [maxDelay, maxDelay + 20], [0, 0.45]);
            const pulse = 0.4 + Math.sin(frame / 18 + i) * 0.18;
            return (
              <line
                key={i}
                x1={na.x}
                y1={na.y}
                x2={nb.x}
                y2={nb.y}
                stroke={p.hairlineStrong}
                strokeWidth={1.5}
                opacity={lineOpacity * pulse}
                strokeDasharray="4 8"
              />
            );
          })}
        </svg>

        {brainNodes.map((node) => {
          const enter = spring({ frame: frame - node.delay, fps, config: { damping: 180, stiffness: 120 } });
          const pulse = 1 + Math.sin(frame / 20 + node.id.length) * 0.025;
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: node.x - node.size / 2,
                top: node.y - node.size / 2,
                width: node.size,
                height: node.size,
                borderRadius: 999,
                background: p.elevated,
                border: `1.5px solid ${node.color}77`,
                display: "grid",
                placeItems: "center",
                fontSize: node.size * 0.24,
                fontWeight: 500,
                color: node.color,
                transform: `scale(${enter * pulse})`,
                opacity: ci(frame, [node.delay, node.delay + 14], [0, 1]),
                boxShadow: `0 2px 12px rgba(26,24,22,0.08)`,
              }}
            >
              {node.id}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE 6: FINALE
// ═══════════════════════════════════════════════════════════════════════════════
const featurePills = [
  { label: "Train digital twins", color: p.twin },
  { label: "AI team meetings", color: p.warn },
  { label: "1:1 chat + tasks", color: p.accent },
  { label: "Autonomous shifts", color: p.success },
  { label: "Company brain", color: p.danger },
];

function FinaleScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 8, fps, config: { damping: 200, stiffness: 90 } });

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <WarmBase accent={p.accent} />
      <TopBar />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          paddingTop: 20,
        }}
      >
        <div
          style={{
            transform: `scale(${cs(frame, [6, 36], [0.7, 1])})`,
            opacity: ci(frame, [6, 26], [0, 1]),
            marginBottom: 26,
          }}
        >
          <Logo size={88} />
        </div>

        <div
          style={{
            fontSize: 126,
            lineHeight: 0.9,
            fontWeight: 300,
            color: p.text,
            transform: `translateY(${(1 - enter) * 44}px)`,
            opacity: ci(frame, [8, 28], [0, 1]),
          }}
        >
          Employee001
        </div>

        <div
          style={{
            fontSize: 40,
            color: p.muted,
            marginTop: 26,
            opacity: ci(frame, [22, 46], [0, 1]),
            transform: `translateY(${cs(frame, [22, 52], [20, 0])}px)`,
            maxWidth: 760,
            lineHeight: 1.35,
          }}
        >
          AI employees trained on your company,
          <br />
          governed by your company.
        </div>

        <div
          style={{
            marginTop: 38,
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "18px 32px",
            borderRadius: 8,
            background: p.text,
            color: p.bg,
            fontSize: 30,
            fontWeight: 500,
            transform: `scale(${cs(frame, [46, 72], [0.88, 1])})`,
            opacity: ci(frame, [46, 66], [0, 1]),
            boxShadow: "0 8px 32px rgba(26,24,22,0.18)",
          }}
        >
          Book the CEO walkthrough
          <span style={{ color: p.accentSoft, fontWeight: 400, fontSize: 24 }}>
            employee001.ai
          </span>
        </div>

        <div
          style={{
            marginTop: 48,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 1100,
          }}
        >
          {featurePills.map((f, i) => (
            <div
              key={f.label}
              style={{
                padding: "11px 20px",
                borderRadius: 999,
                border: `1px solid ${p.hairline}`,
                background: p.elevated,
                color: f.color,
                fontSize: 22,
                fontWeight: 500,
                opacity: ci(frame, [68 + i * 7, 86 + i * 7], [0, 1]),
                transform: `translateY(${cs(frame, [68 + i * 7, 86 + i * 7], [16, 0])}px)`,
              }}
            >
              {f.label}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPOSITION
// ═══════════════════════════════════════════════════════════════════════════════

// Timing (all in frames @ 30fps):
// Hook:     0   → 105  (3.5s)
// Twin:     105 → 270  (5.5s)
// Meeting:  270 → 435  (5.5s)
// Shifts:   435 → 600  (5.5s)
// OrgBrain: 600 → 765  (5.5s)
// Finale:   765 → 960  (6.5s)
// Total:    960 frames = 32s

export const Employee001DemoV2: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={105}>
        <HookScene />
      </Sequence>
      <Sequence from={105} durationInFrames={165}>
        <TwinScene />
      </Sequence>
      <Sequence from={270} durationInFrames={165}>
        <MeetingScene />
      </Sequence>
      <Sequence from={435} durationInFrames={165}>
        <ShiftScene />
      </Sequence>
      <Sequence from={600} durationInFrames={165}>
        <OrgBrainScene />
      </Sequence>
      <Sequence from={765} durationInFrames={195}>
        <FinaleScene />
      </Sequence>
    </AbsoluteFill>
  );
};
