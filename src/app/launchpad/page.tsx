"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useT } from "@/components/ex/i18n-context";

const SERIF_FONT =
  'var(--font-instrument-serif), "Instrument Serif", ui-serif, Georgia, serif';
const SANS_FONT =
  'var(--font-geist), ui-sans-serif, system-ui, sans-serif';

type Action = {
  id: "knowledge" | "invite" | "budgets";
  title: string;
  blurb: string;
  cta: string;
  href: string;
  glyph: React.ReactNode;
};

// Stroke-only SVG glyphs, hairline weight — matches the brand surface in the
// campaigns rather than filled iconography from a UI kit.
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ACTIONS: Action[] = [
  {
    id: "knowledge",
    title: "Add organizational knowledge",
    blurb:
      "Drop in what your company already knows — playbooks, decisions, context. The brain starts here.",
    cta: "Open knowledge editor →",
    href: "/settings#company-brain",
    glyph: (
      <Glyph>
        <path d="M7 8h22v20H7z" />
        <path d="M7 14h22M12 8v20" />
        <path d="M17 19h9M17 23h7" />
      </Glyph>
    ),
  },
  {
    id: "invite",
    title: "Invite your first employee",
    blurb:
      "Generate a one-time link. They connect their own tools — Slack, Gmail, GitHub — and a twin is built automatically.",
    cta: "Create first invite →",
    href: "/employees",
    glyph: (
      <Glyph>
        <circle cx="14" cy="14" r="5" />
        <path d="M5 30c0-5 4-9 9-9s9 4 9 9" />
        <path d="M26 13v7M22.5 16.5h7" />
      </Glyph>
    ),
  },
  {
    id: "budgets",
    title: "Set spend budgets",
    blurb:
      "Choose monthly caps per twin so AI runs are predictable. You can always adjust later.",
    cta: "Configure budgets →",
    href: "/budgets",
    glyph: (
      <Glyph>
        <circle cx="18" cy="18" r="11" />
        <path d="M18 11v14M22 14h-6a2 2 0 100 4h4a2 2 0 110 4h-6" />
      </Glyph>
    ),
  },
];

const PALETTE = {
  surface: "var(--bg)",
  surfaceCard: "var(--surface)",
  border: "var(--hairline)",
  ink: "var(--text)",
  inkMuted: "var(--text-muted)",
  inkDim: "var(--text-subtle)",
  copper: "var(--accent)",
};

export default function LaunchpadPage() {
  const router = useRouter();
  const { t } = useT();
  const actions = ACTIONS.map((action) => ({ ...action, title: t(`launch.${action.id === "budgets" ? "budget" : action.id}` as "launch.knowledge"), blurb: t(`launch.${action.id === "budgets" ? "budget" : action.id}Sub` as "launch.knowledgeSub"), cta: t(`launch.${action.id === "budgets" ? "budget" : action.id}Cta` as "launch.knowledgeCta") }));

  return (
    <main
      style={{
        minHeight: "100vh",
        background: PALETTE.surface,
        color: PALETTE.ink,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
        fontFamily: SANS_FONT,
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          position: "fixed",
          top: 32,
          insetInlineStart: 40,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          letterSpacing: "0.12em",
          color: PALETTE.ink,
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: PALETTE.copper,
          }}
        />
        Employee001
      </div>

      {/* Skip */}
      <button
        onClick={() => router.push("/employees")}
        style={{
          position: "fixed",
          top: 30,
          insetInlineEnd: 40,
          background: "transparent",
          border: `1px solid ${PALETTE.border}`,
          color: PALETTE.inkMuted,
          padding: "6px 14px",
          borderRadius: 999,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {t("launch.skip")} ←
      </button>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        style={{ width: "100%", maxWidth: 1100, textAlign: "center" }}
      >
        <h1
          style={{
            fontFamily: SERIF_FONT,
            fontWeight: 400,
            fontSize: "clamp(34px, 4.8vw, 56px)",
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            margin: "0 0 14px",
            color: PALETTE.ink,
          }}
        >
          {t("launch.title")}
        </h1>
        <p
          style={{
            fontSize: "clamp(15px, 1.4vw, 17px)",
            color: PALETTE.inkMuted,
            margin: "0 auto 56px",
            maxWidth: 560,
            lineHeight: 1.55,
          }}
        >
          {t("launch.sub")}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 18,
          }}
        >
          {actions.map((a, i) => (
            <motion.button
              key={a.id}
              onClick={() => router.push(a.href)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.08, ease: "easeOut" }}
              whileHover={{
                y: -3,
                boxShadow: "var(--shadow-lg)",
              }}
              whileTap={{ scale: 0.98 }}
              style={{
                background: PALETTE.surfaceCard,
                border: `1px solid ${PALETTE.border}`,
                borderRadius: 16,
                padding: "28px 24px 24px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 18,
                textAlign: "start",
                fontFamily: "inherit",
                color: PALETTE.ink,
                minHeight: 280,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: PALETTE.surface,
                  display: "grid",
                  placeItems: "center",
                  color: PALETTE.copper,
                  border: `1px solid ${PALETTE.border}`,
                }}
              >
                {a.glyph}
              </div>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: SERIF_FONT,
                    fontSize: 24,
                    lineHeight: 1.2,
                    letterSpacing: "-0.01em",
                    color: PALETTE.ink,
                    marginBottom: 10,
                  }}
                >
                  {a.title}
                </div>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: PALETTE.inkMuted,
                    margin: 0,
                  }}
                >
                  {a.blurb}
                </p>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  fontSize: 13,
                  fontWeight: 600,
                  color: PALETTE.copper,
                  letterSpacing: "-0.01em",
                }}
              >
                {a.cta}
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </main>
  );
}
