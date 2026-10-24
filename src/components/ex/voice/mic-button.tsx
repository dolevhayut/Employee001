"use client";

// The mic in the orb's input pill. Same 38px round shape as the send button;
// while listening it fills with the accent and a halo breathes with the live
// input level, so the CEO sees the twin is hearing them. A spinner while live
// voice connects (press to cancel) or a clip is transcribed.

import { motion, useTransform, type MotionValue } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import type { VoiceInputState } from "./use-voice-input";

export function MicButton({
  state,
  level,
  onClick,
  label,
  disabled,
}: {
  state: VoiceInputState;
  level: MotionValue<number>;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  const listening = state === "listening";
  const haloScale = useTransform(level, [0, 1], [1, 1.45]);
  const haloOpacity = useTransform(level, [0, 0.05, 1], [0.18, 0.3, 0.55]);
  const bars = [0.55, 1, 0.7];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === "transcribing"}
      aria-label={label}
      aria-pressed={listening}
      title={label}
      style={{
        position: "relative",
        flex: "none",
        width: 38,
        height: 38,
        display: "grid",
        placeItems: "center",
        border: 0,
        borderRadius: "50%",
        padding: 0,
        background: listening ? "var(--accent)" : "var(--bg-sunken)",
        color: listening ? "var(--bg-elevated, #fff)" : "var(--text-subtle)",
        cursor: disabled ? "default" : "pointer",
        transition: "background 0.2s, color 0.2s",
      }}
    >
      {listening && (
        <motion.span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "var(--accent)",
            scale: haloScale,
            opacity: haloOpacity,
            pointerEvents: "none",
          }}
        />
      )}
      <span style={{ position: "relative", display: "grid", placeItems: "center" }}>
        {state === "transcribing" || state === "connecting" ? (
          <Icons.Loader size={16} />
        ) : listening ? (
          // live level as three bars, like the voice memo meter
          <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 2.5, height: 16 }}>
            {bars.map((k, i) => (
              <LevelBar key={i} level={level} weight={k} />
            ))}
          </span>
        ) : (
          <Icons.Mic size={17} />
        )}
      </span>
    </button>
  );
}

function LevelBar({ level, weight }: { level: MotionValue<number>; weight: number }) {
  const height = useTransform(level, (v) => `${Math.round(4 + Math.min(1, v * weight * 1.6) * 12)}px`);
  return <motion.span style={{ width: 3, height, borderRadius: 2, background: "currentColor" }} />;
}
