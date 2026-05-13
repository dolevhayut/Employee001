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
  weights: ["300", "400"],
  subsets: ["latin"],
});

const palette = {
  bg: "#F5F1EA",
  elevated: "#FBF8F2",
  sunken: "#EFE9DE",
  hairline: "#E5DDD0",
  text: "#1A1816",
  muted: "#6B6359",
  subtle: "#8F8678",
  accent: "#9E6B47",
  accentSoft: "#E8D8C7",
  accentDeep: "#6B4528",
  success: "#5C7A4A",
  warn: "#B5894A",
  twin: "#4A6B7A",
  twinSoft: "#DBE5EA",
};

const uspBeats = [
  {
    index: "01",
    title: "Train your best talent into agents",
    detail: "Build a digital twin from the data, style, decisions, and context of a real human employee.",
    metric: "human talent -> AI teammate",
    color: palette.twin,
  },
  {
    index: "02",
    title: "Run AI team meetings",
    detail: "Raise a strategic topic and watch the right agents respond, debate, and hand back decisions.",
    metric: "CEO asks, agents answer",
    color: palette.accent,
  },
  {
    index: "03",
    title: "Chat 1:1 with any twin",
    detail: "Talk to a single agent, delegate work, and get task execution without opening another system.",
    metric: "conversation -> execution",
    color: palette.success,
  },
  {
    index: "04",
    title: "Schedule shifts and routines",
    detail: "Put AI employees on recurring work with defined budgets, limits, and operating windows.",
    metric: "budgeted autonomy",
    color: palette.warn,
  },
  {
    index: "05",
    title: "Observe, train, improve",
    detail: "Monitor performance, attach skills, connect knowledge sources, and build a second brain for the organization.",
    metric: "company brain + skills",
    color: palette.text,
  },
];

function clamp(v: number, input: [number, number], output: [number, number]) {
  return interpolate(v, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

function ease(v: number, input: [number, number, number], output: [number, number, number]) {
  return interpolate(v, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
}

function SceneCamera({
  children,
  scale,
  x,
  y,
  rotate = 0,
}: {
  children: React.ReactNode;
  scale: number;
  x: number;
  y: number;
  rotate?: number;
}) {
  return (
    <AbsoluteFill
      style={{
        transform: `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function LogoMark({ size = 70 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: palette.text,
        color: palette.bg,
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.33,
        fontWeight: 400,
        letterSpacing: 0,
      }}
    >
      001
    </div>
  );
}

function BrandRail() {
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        right: 64,
        top: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        color: palette.muted,
        fontSize: 20,
        fontWeight: 400,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <LogoMark size={48} />
        <span style={{ color: palette.text, fontSize: 28, fontWeight: 400 }}>Employee001</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: palette.success }} />
        enterprise AI employees
      </div>
    </div>
  );
}

function GridBackground({ depth = 1 }: { depth?: number }) {
  const frame = useCurrentFrame();
  const driftX = Math.sin(frame / 95) * 20 * depth;
  const driftY = Math.cos(frame / 120) * 16 * depth;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.bg,
        backgroundImage:
          `linear-gradient(${palette.hairline} 1px, transparent 1px), linear-gradient(90deg, ${palette.hairline} 1px, transparent 1px)`,
        backgroundSize: "96px 96px",
        backgroundPosition: `${driftX}px ${driftY}px`,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 20% 24%, rgba(219,229,234,.86), transparent 28%), radial-gradient(circle at 82% 62%, rgba(232,216,199,.88), transparent 30%), linear-gradient(180deg, rgba(245,241,234,.35), #F5F1EA 72%)",
        }}
      />
    </AbsoluteFill>
  );
}

function FocusRing({
  x,
  y,
  size,
  color,
  delay,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
}) {
  const frame = useCurrentFrame();
  const scale = ease(frame, [delay, delay + 24, delay + 86], [0.68, 1.08, 1.24]);
  const opacity = Math.min(clamp(frame, [delay, delay + 18], [0, 1]), clamp(frame, [delay + 76, delay + 104], [1, 0]));

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: 999,
        border: `3px solid ${color}55`,
        opacity,
        transform: `scale(${scale})`,
        boxShadow: `0 0 0 ${Math.round(size * 0.18)}px ${color}16`,
      }}
    />
  );
}

function KineticNode({
  x,
  y,
  size,
  color,
  delay,
  label,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
  label?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 160, stiffness: 120 } });
  const pulse = Math.sin((frame - delay) / 14) * 0.03 + 1;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        transform: `scale(${enter * pulse})`,
        opacity: clamp(frame, [delay, delay + 16], [0, 1]),
        boxShadow: `0 0 0 ${Math.round(size * 0.24)}px ${color}22, 0 28px 80px ${color}44`,
        fontSize: size * 0.24,
        fontWeight: 400,
      }}
    >
      {label}
    </div>
  );
}

function Connector({
  left,
  top,
  width,
  rotate,
  delay,
  color = palette.hairline,
}: {
  left: number;
  top: number;
  width: number;
  rotate: number;
  delay: number;
  color?: string;
}) {
  const frame = useCurrentFrame();
  const grow = clamp(frame, [delay, delay + 20], [0, 1]);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height: 2,
        transform: `rotate(${rotate}deg) scaleX(${grow})`,
        transformOrigin: "left center",
        background: color,
        opacity: 0.9,
      }}
    />
  );
}

function HeroScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headline = spring({ frame: frame - 8, fps, config: { damping: 180, stiffness: 95 } });
  const cameraScale = ease(frame, [0, 58, 120], [1.18, 1.02, 0.94]);
  const cameraX = ease(frame, [0, 58, 120], [110, 0, -42]);
  const cameraY = ease(frame, [0, 58, 120], [38, 0, -20]);
  const nodeShift = clamp(frame, [0, 110], [70, -42]);

  return (
    <AbsoluteFill style={{ fontFamily, color: palette.text }}>
      <GridBackground depth={1.4} />
      <SceneCamera scale={cameraScale} x={cameraX} y={cameraY}>
        <BrandRail />
        <div
          style={{
            position: "absolute",
            right: -210,
            top: -170,
            width: 620,
            height: 620,
            borderRadius: 999,
            background: `${palette.twin}18`,
            transform: `scale(${clamp(frame, [0, 80], [0.7, 1.08])})`,
          }}
        />
        <FocusRing x={1248 + nodeShift} y={184} size={250} color={palette.twin} delay={10} />
        <KineticNode x={1290 + nodeShift} y={226} size={170} color={palette.twin} delay={18} label="AI" />
        <KineticNode x={1515 + nodeShift * 0.55} y={505} size={124} color={palette.accent} delay={28} label="HR" />
        <KineticNode x={1165 + nodeShift * 0.8} y={665} size={138} color={palette.success} delay={36} label="Ops" />
        <Connector left={1345 + nodeShift} top={410} width={310} rotate={48} delay={28} color={palette.twin} />
        <Connector left={1296 + nodeShift * 0.7} top={710} width={280} rotate={-31} delay={36} color={palette.accent} />

        <div
          style={{
            position: "absolute",
            left: 112,
            top: 198,
            width: 1030,
            opacity: clamp(frame, [0, 22], [0, 1]),
            transform: `translateY(${(1 - headline) * 42}px) translateX(${clamp(frame, [0, 108], [0, -24])}px)`,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              border: `1px solid ${palette.hairline}`,
              borderRadius: 999,
              background: "rgba(251,248,242,.82)",
              color: palette.accentDeep,
              fontSize: 22,
              fontWeight: 400,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 99, background: palette.accent }} />
            Your next hire may already work here
          </div>
          <div style={{ fontSize: 118, lineHeight: 0.92, fontWeight: 300, marginTop: 30, letterSpacing: 0 }}>
            Your best employees,
            <br />
            multiplied.
          </div>
          <div style={{ width: 720, fontSize: 32, lineHeight: 1.25, color: palette.muted, marginTop: 32 }}>
            Five reasons CEOs use Employee001 to turn institutional knowledge into governed AI employees.
          </div>
        </div>
      </SceneCamera>
    </AbsoluteFill>
  );
}

function UspScene({ beat }: { beat: (typeof uspBeats)[number] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 180, stiffness: 110 } });
  const cameraScale = ease(frame, [0, 42, 132], [1.26, 1.04, 0.96]);
  const cameraX = ease(frame, [0, 42, 132], [160, 0, -82]);
  const cameraY = ease(frame, [0, 42, 132], [-76, 0, 24]);
  const orbitScale = ease(frame, [0, 52, 132], [1.34, 1, 1.1]);
  const textSlide = ease(frame, [0, 34, 132], [70, 0, -34]);
  const wordIn = (delay: number) => ({
    opacity: clamp(frame, [delay, delay + 14], [0, 1]),
    transform: `translateY(${clamp(frame, [delay, delay + 18], [28, 0])}px)`,
  });

  return (
    <AbsoluteFill style={{ fontFamily, color: palette.text }}>
      <GridBackground depth={1.2} />
      <SceneCamera scale={cameraScale} x={cameraX} y={cameraY}>
        <BrandRail />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(115deg, transparent 0 54%, ${beat.color}1f 54% 100%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 112,
            top: 210,
            width: 1100,
            transform: `translateY(${(1 - enter) * 34}px) translateX(${textSlide}px)`,
            opacity: clamp(frame, [0, 18], [0, 1]),
          }}
        >
          <div
            style={{
              fontSize: 30,
              color: beat.color,
              fontWeight: 400,
              letterSpacing: 0,
              textTransform: "uppercase",
            }}
          >
            USP {beat.index}
          </div>
          <div style={{ ...wordIn(6), fontSize: 96, lineHeight: 0.96, fontWeight: 300, marginTop: 22, letterSpacing: 0 }}>
            {beat.title}
          </div>
          <div style={{ ...wordIn(22), width: 850, fontSize: 34, lineHeight: 1.24, color: palette.muted, marginTop: 30 }}>
            {beat.detail}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 130,
            top: 220,
            width: 510,
            height: 510,
            borderRadius: 999,
            border: `2px solid ${beat.color}33`,
            transform: `scale(${orbitScale}) rotate(${clamp(frame, [0, 132], [-3, 4])}deg)`,
            opacity: clamp(frame, [0, 24], [0, 1]),
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 72,
              borderRadius: 999,
              border: `2px solid ${beat.color}66`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 164,
              borderRadius: 999,
              background: beat.color,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 54,
              fontWeight: 400,
              boxShadow: `0 0 0 34px ${beat.color}22, 0 28px 90px ${beat.color}44`,
            }}
          >
            {beat.index}
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const angle = (i / 6) * Math.PI * 2 + frame / 72;
            const radius = 228 + Math.sin(frame / 18 + i) * 12;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 252 + Math.cos(angle) * radius,
                  top: 252 + Math.sin(angle) * radius,
                  width: 14,
                  height: 14,
                  borderRadius: 99,
                  background: i % 2 === 0 ? beat.color : palette.text,
                  opacity: clamp(frame, [12 + i * 3, 28 + i * 3], [0, 1]),
                }}
              />
            );
          })}
        </div>

        <div
          style={{
            position: "absolute",
            left: 112,
            bottom: 100,
            right: 112,
            display: "flex",
            alignItems: "center",
            gap: 22,
            opacity: clamp(frame, [18, 42], [0, 1]),
            transform: `translateY(${clamp(frame, [18, 52], [36, 0])}px)`,
          }}
        >
          <div
            style={{
              height: 2,
              flex: 1,
              background: `linear-gradient(90deg, ${beat.color}, ${palette.hairline})`,
            }}
          />
          <div
            style={{
              padding: "14px 20px",
              borderRadius: 999,
              background: palette.elevated,
              border: `1px solid ${palette.hairline}`,
              color: beat.color,
              fontSize: 24,
              fontWeight: 400,
            }}
          >
            {beat.metric}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: -160,
            bottom: -230,
            fontSize: 330,
            lineHeight: 0.8,
            fontWeight: 300,
            color: `${beat.color}14`,
            transform: `translateX(${clamp(frame, [0, 132], [-80, 80])}px)`,
          }}
        >
          {beat.index}
        </div>
      </SceneCamera>
    </AbsoluteFill>
  );
}

function FinaleScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 8, fps, config: { damping: 190, stiffness: 100 } });
  const cameraScale = ease(frame, [0, 56, 120], [1.22, 1, 0.96]);
  const cameraY = ease(frame, [0, 56, 120], [66, 0, -18]);

  return (
    <AbsoluteFill style={{ fontFamily, color: palette.text }}>
      <GridBackground depth={1.3} />
      <SceneCamera scale={cameraScale} x={0} y={cameraY}>
        <BrandRail />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 205,
            textAlign: "center",
            transform: `translateY(${(1 - enter) * 40}px)`,
            opacity: clamp(frame, [0, 24], [0, 1]),
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
            <LogoMark size={96} />
          </div>
          <div style={{ fontSize: 110, lineHeight: 0.92, fontWeight: 300, letterSpacing: 0 }}>
            Employee001
          </div>
          <div style={{ fontSize: 40, color: palette.muted, marginTop: 24 }}>
            AI employees trained on your company, governed by your company.
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              marginTop: 42,
              padding: "18px 28px",
              borderRadius: 8,
              background: palette.text,
              color: palette.bg,
              fontSize: 28,
              fontWeight: 400,
              transform: `scale(${clamp(frame, [42, 66], [0.9, 1])})`,
            }}
          >
            Book the CEO walkthrough
            <span style={{ color: palette.accentSoft }}>employee001.ai</span>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: 160,
            right: 160,
            bottom: 150,
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
            transform: `translateY(${clamp(frame, [20, 70], [60, 0])}px)`,
          }}
        >
          {uspBeats.map((beat, i) => (
            <div
              key={beat.index}
              style={{
                height: 96,
                border: `1px solid ${palette.hairline}`,
                borderRadius: 8,
                background: "rgba(251,248,242,.78)",
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: 18,
                opacity: clamp(frame, [28 + i * 4, 46 + i * 4], [0, 1]),
                transform: `translateY(${clamp(frame, [28 + i * 4, 48 + i * 4], [34, 0])}px) scale(${clamp(frame, [28 + i * 4, 48 + i * 4], [0.94, 1])})`,
              }}
            >
              <span style={{ width: 12, height: 48, borderRadius: 99, background: beat.color }} />
              <div>
                <div style={{ color: beat.color, fontWeight: 400, fontSize: 18 }}>{beat.index}</div>
                <div style={{ fontWeight: 400, fontSize: 19, lineHeight: 1.08 }}>{beat.title}</div>
              </div>
            </div>
          ))}
        </div>
      </SceneCamera>
    </AbsoluteFill>
  );
}

function TransitionSweep({ color, start }: { color: string; start: number }) {
  const frame = useCurrentFrame();
  const local = frame - start;
  const x = interpolate(local, [0, 18, 38], [2100, -160, -2300], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const opacity = local < 0 || local > 40 ? 0 : 1;
  return (
      <div
        style={{
          position: "absolute",
          left: x,
          top: -240,
          width: 620,
          height: 1560,
          transform: "rotate(17deg)",
          background: color,
          opacity,
          boxShadow: `0 0 90px ${color}55`,
        }}
      />
  );
}

export const Employee001SocialDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <Sequence durationInFrames={120}>
        <HeroScene />
      </Sequence>
      {uspBeats.map((beat, i) => (
        <Sequence key={beat.index} from={120 + i * 132} durationInFrames={132}>
          <UspScene beat={beat} />
        </Sequence>
      ))}
      <Sequence from={780} durationInFrames={120}>
        <FinaleScene />
      </Sequence>
      {[108, 240, 372, 504, 636, 768].map((start, i) => (
        <TransitionSweep key={start} start={start} color={uspBeats[i % uspBeats.length].color} />
      ))}
    </AbsoluteFill>
  );
};
