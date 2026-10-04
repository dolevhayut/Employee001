"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavArrowDown, NavArrowLeft } from "iconoir-react";
import { PROFILE_SOURCES, type ProfileSource } from "@/lib/sources-data";
import { useT } from "@/components/ex/i18n-context";

function SourceRow({ source, index }: { source: ProfileSource["sources"][0]; index: number }) {
  const { t } = useT();
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
        borderBottom: "1px solid var(--bg)",
        background: index % 2 === 0 ? "var(--surface)" : "var(--surface-soft)",
      }}
    >
      {/* Type badge */}
      <div
        style={{
          flexShrink: 0,
          background: isHuman ? "var(--text)" : "var(--bg-sunken)",
          color: isHuman ? "var(--bg)" : "var(--text-muted)",
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          letterSpacing: "0.06em",
          padding: "3px 9px",
          borderRadius: 100,
          marginTop: "var(--sp-1)",
          fontFamily: 'var(--font-geist), sans-serif',
          textTransform: "uppercase" as const,
          border: isHuman ? "none" : "1px solid var(--hairline-strong)",
        }}
      >
        {isHuman ? t("sources.human") : t("sources.system")}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "var(--fs-ui)",
            color: "var(--text)",
            marginBottom: "var(--sp-4)",
            letterSpacing: "-0.01em",
          }}
        >
          {source.label}
        </div>
        <div
          style={{
            fontSize: "var(--fs-sm)",
            color: "var(--text-subtle)",
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
        background: "var(--surface)",
        border: `1.5px solid ${isOpen ? `color-mix(in oklch, ${profile.accentColor} 27%, transparent)` : "var(--hairline)"}`,
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
          fontFamily: 'var(--font-geist), sans-serif',
          textAlign: "start" as const,
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
                color: "var(--text)",
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
                style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", opacity: 0.7 }}
              />
            ))}
            {Array.from({ length: humanCount }).map((_, i) => (
              <div
                key={`h${i}`}
                style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text)" }}
              />
            ))}
          </div>

          {/* Chevron */}
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <NavArrowDown width={14} height={14} strokeWidth={2} color="var(--accent)" />
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
            <div style={{ borderTop: "1px solid var(--hairline)" }}>
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
  const { t } = useT();
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
        background: "var(--bg)",
        fontFamily: 'var(--font-geist), sans-serif',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: "24px 32px",
          borderBottom: "1px solid var(--hairline)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg)",
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
              color: "var(--text-subtle)",
              textDecoration: "none",
              letterSpacing: "0.01em",
            }}
          >
            <NavArrowLeft width={14} height={14} strokeWidth={2} />
            {t("sources.back")}
          </a>
          <span style={{ color: "var(--hairline-strong)" }}>·</span>
          <span
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: "var(--text)",
            }}
          >
            Employee001
          </span>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "var(--sp-20)", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-7)" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>{t("sources.system")}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-7)" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text)" }} />
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>{t("sources.human")}</span>
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
              color: "var(--text)",
              letterSpacing: "-0.02em",
              marginBottom: "var(--sp-8)",
            }}
          >
            {t("sources.title")}
          </h1>
          <p style={{ fontSize: "var(--fs-base)", color: "var(--text-subtle)", lineHeight: 1.6 }}>
            {t("sources.subtitle")}
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
            { label: t("sources.files"), value: PROFILE_SOURCES.length, color: "var(--text)" },
            { label: t("sources.system"), value: totalSystem, color: "var(--accent)" },
            { label: t("sources.human"), value: totalHuman, color: "var(--text)" },
          ].map((stat, i) => (
            <div
              key={i}
              style={{
                background: "var(--surface)",
                border: "1.5px solid var(--hairline)",
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
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)", marginTop: "var(--sp-4)" }}>
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
