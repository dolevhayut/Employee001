"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavArrowDown, NavArrowRight } from "iconoir-react";
import { PROFILE_SOURCES, SOURCE_TYPE_CONFIG, type ProfileSource } from "@/lib/sources-data";

function SourceRow({ source, index }: { source: ProfileSource["sources"][0]; index: number }) {
  const cfg = SOURCE_TYPE_CONFIG[source.type];
  const isHuman = source.type === "human";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-14)",
        padding: "14px 20px",
        borderBottom: "1px solid #F5F2ED",
        background: index % 2 === 0 ? "#FFFFFF" : "#FAFAF8",
      }}
    >
      {/* Type badge */}
      <div
        style={{
          flexShrink: 0,
          background: cfg.bg,
          color: cfg.text,
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          letterSpacing: "0.06em",
          padding: "3px 9px",
          borderRadius: 100,
          marginTop: "var(--sp-1)",
          fontFamily: '"Manrope", sans-serif',
          textTransform: "uppercase" as const,
          border: isHuman ? "none" : "1px solid #DDD8D0",
        }}
      >
        {cfg.label}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "var(--fs-ui)",
            color: "#0A0A0A",
            marginBottom: "var(--sp-4)",
            letterSpacing: "-0.01em",
          }}
        >
          {source.label}
        </div>
        <div
          style={{
            fontSize: "var(--fs-sm)",
            color: "#9A9490",
            lineHeight: 1.6,
            fontStyle: isHuman ? "italic" : "normal",
          }}
        >
          {source.detail}
        </div>
      </div>
    </motion.div>
  );
}

function ProfileCard({ profile }: { profile: ProfileSource }) {
  const [isOpen, setIsOpen] = useState(false);
  const systemCount = profile.sources.filter((s) => s.type === "system").length;
  const humanCount = profile.sources.filter((s) => s.type === "human").length;

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: `1.5px solid ${isOpen ? profile.accentColor + "44" : "#EDE8E1"}`,
        borderRadius: 14,
        overflow: "hidden",
        transition: "border-color 0.2s",
      }}
    >
      {/* Header row */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: '"Manrope", sans-serif',
          textAlign: "left" as const,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-14)" }}>
          {/* Accent strip */}
          <div
            style={{
              width: 3,
              height: 36,
              borderRadius: 100,
              background: profile.accentColor,
              opacity: 0.5,
              flexShrink: 0,
            }}
          />
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: "var(--fs-base)",
                color: "#0A0A0A",
                letterSpacing: "-0.01em",
                marginBottom: "var(--sp-3)",
              }}
            >
              {profile.title}
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: "var(--fs-meta)",
                color: profile.accentColor,
                letterSpacing: "0.02em",
              }}
            >
              {profile.file}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-16)" }}>
          {/* Source type dots */}
          <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
            {Array.from({ length: systemCount }).map((_, i) => (
              <div
                key={`s${i}`}
                style={{ width: 7, height: 7, borderRadius: "50%", background: "#B09080", opacity: 0.7 }}
              />
            ))}
            {Array.from({ length: humanCount }).map((_, i) => (
              <div
                key={`h${i}`}
                style={{ width: 7, height: 7, borderRadius: "50%", background: "#0A0A0A" }}
              />
            ))}
          </div>

          {/* Chevron */}
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <NavArrowDown width={14} height={14} strokeWidth={2} color="#B09080" />
          </motion.div>
        </div>
      </button>

      {/* Sources list */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ borderTop: "1px solid #EDE8E1" }}>
              {profile.sources.map((source, i) => (
                <SourceRow key={i} source={source} index={i} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SourcesPage() {
  const totalSystem = PROFILE_SOURCES.reduce(
    (a, p) => a + p.sources.filter((s) => s.type === "system").length,
    0
  );
  const totalHuman = PROFILE_SOURCES.reduce(
    (a, p) => a + p.sources.filter((s) => s.type === "human").length,
    0
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F2ED",
        fontFamily: '"Manrope", sans-serif',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: "24px 32px",
          borderBottom: "1px solid #EDE8E1",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#F5F2ED",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-16)" }}>
          <a
            href="/twin"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-6)",
              fontSize: "var(--fs-sm)",
              color: "#9A9490",
              textDecoration: "none",
              letterSpacing: "0.01em",
            }}
          >
            <NavArrowRight width={14} height={14} strokeWidth={2} />
            Back to Twin
          </a>
          <span style={{ color: "#DDD8D0" }}>·</span>
          <span
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: "#0A0A0A",
            }}
          >
            Employee001
          </span>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "var(--sp-20)", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-7)" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#B09080" }} />
            <span style={{ fontSize: "var(--fs-sm)", color: "#9A9490" }}>System sources</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-7)" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#0A0A0A" }} />
            <span style={{ fontSize: "var(--fs-sm)", color: "#9A9490" }}>Human questions</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "36px 24px 80px" }}>
        {/* Page title */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{ marginBottom: "var(--sp-40)" }}
        >
          <h1
            style={{
              fontSize: "clamp(22px, 3vw, 32px)",
              fontWeight: 300,
              color: "#0A0A0A",
              letterSpacing: "-0.02em",
              marginBottom: "var(--sp-8)",
            }}
          >
            Twin Data Sources
          </h1>
          <p style={{ fontSize: "var(--fs-base)", color: "#9A9490", lineHeight: 1.6 }}>
            Each profile file is built from a combination of automatic data from work systems and targeted questions asked directly to the employee.
          </p>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "var(--sp-12)",
            marginBottom: "var(--sp-32)",
          }}
        >
          {[
            { label: "Profile files", value: PROFILE_SOURCES.length, color: "#0A0A0A" },
            { label: "System sources", value: totalSystem, color: "#B09080" },
            { label: "Human questions", value: totalHuman, color: "#0A0A0A" },
          ].map((stat, i) => (
            <div
              key={i}
              style={{
                background: "#FFFFFF",
                border: "1.5px solid #EDE8E1",
                borderRadius: 12,
                padding: "20px 16px",
                textAlign: "center" as const,
              }}
            >
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: stat.color,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {stat.value}
              </div>
              <div style={{ fontSize: "var(--fs-sm)", color: "#9A9490", marginTop: "var(--sp-4)" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Profile cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)" }}>
          {PROFILE_SOURCES.map((profile, i) => (
            <motion.div
              key={profile.file}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.15 + i * 0.04 }}
            >
              <ProfileCard profile={profile} />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
