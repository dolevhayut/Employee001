"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "iconoir-react";

const TEAM_SIZES = ["2 – 10", "11 – 50", "51 – 200", "201+"];

const REASONS = [
  {
    id: "preserve",
    headline: "Preserve employee knowledge",
    sub: "Every twin captures what one person knows — so nothing leaves with them.",
  },
  {
    id: "orgbrain",
    headline: "Build an organizational brain",
    sub: "Twins share a knowledge layer the whole company can query.",
  },
  {
    id: "execute",
    headline: "Execute work, not just answer",
    sub: "Twins use employee context to draft, decide, and act through real tools.",
  },
  {
    id: "routines",
    headline: "Autonomous routines",
    sub: "Recurring work runs on a schedule — digests, reports, follow-ups — without you in the loop.",
  },
] as const;

const stepVariants = {
  enter: { opacity: 0, y: 18 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
};

function StepOrg({
  company,
  setCompany,
  size,
  setSize,
}: {
  company: string;
  setCompany: (v: string) => void;
  size: string | null;
  setSize: (v: string) => void;
}) {
  return (
    <motion.div
      key="org"
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{ width: "100%", maxWidth: 480 }}
    >
      <h1
        style={{
          fontSize: "clamp(26px, 3.5vw, 36px)",
          fontWeight: 300,
          letterSpacing: "-0.025em",
          color: "#0A0A0A",
          margin: "0 0 10px",
          lineHeight: 1.2,
        }}
      >
        Set up your workspace.
      </h1>
      <p style={{ fontSize: "var(--fs-body)", color: "#9A9490", margin: "0 0 48px", fontWeight: 400 }}>
        A few details and you're in.
      </p>

      <div style={{ marginBottom: "var(--sp-36)" }}>
        <label
          style={{
            display: "block",
            fontSize: "var(--fs-meta)",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#9A9490",
            marginBottom: "var(--sp-10)",
          }}
        >
          Company name
        </label>
        <input
          autoFocus
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Employee001"
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: "var(--fs-lg)",
            fontFamily: '"Manrope", sans-serif',
            fontWeight: 400,
            color: "#0A0A0A",
            background: "#FFFFFF",
            border: "1.5px solid #DDD8D0",
            borderRadius: 8,
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color .15s",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#0A0A0A")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#DDD8D0")}
        />
      </div>

      <div>
        <label
          style={{
            display: "block",
            fontSize: "var(--fs-meta)",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#9A9490",
            marginBottom: "var(--sp-10)",
          }}
        >
          Team size
        </label>
        <div style={{ display: "flex", gap: "var(--sp-10)" }}>
          {TEAM_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              style={{
                flex: 1,
                padding: "12px 8px",
                fontSize: "var(--fs-ui)",
                fontWeight: 500,
                fontFamily: '"Manrope", sans-serif',
                background: size === s ? "#0A0A0A" : "#FFFFFF",
                color: size === s ? "#F5F2ED" : "#0A0A0A",
                border: `1.5px solid ${size === s ? "#0A0A0A" : "#DDD8D0"}`,
                borderRadius: 8,
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function StepReason({
  reason,
  setReason,
}: {
  reason: string | null;
  setReason: (v: string) => void;
}) {
  return (
    <motion.div
      key="reason"
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{ width: "100%", maxWidth: 480 }}
    >
      <h1
        style={{
          fontSize: "clamp(26px, 3.5vw, 36px)",
          fontWeight: 300,
          letterSpacing: "-0.025em",
          color: "#0A0A0A",
          margin: "0 0 10px",
          lineHeight: 1.2,
        }}
      >
        What's the main goal?
      </h1>
      <p style={{ fontSize: "var(--fs-body)", color: "#9A9490", margin: "0 0 40px", fontWeight: 400 }}>
        We'll tailor your workspace accordingly.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-12)" }}>
        {REASONS.map((r) => {
          const active = reason === r.id;
          return (
            <button
              key={r.id}
              onClick={() => setReason(r.id)}
              style={{
                padding: "20px 18px",
                textAlign: "left",
                background: active ? "#0A0A0A" : "#FFFFFF",
                border: `1.5px solid ${active ? "#0A0A0A" : "#DDD8D0"}`,
                borderRadius: 12,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-8)",
                transition: "all .15s",
                fontFamily: '"Manrope", sans-serif',
              }}
            >
              <span
                style={{
                  fontSize: "var(--fs-base)",
                  fontWeight: 600,
                  color: active ? "#F5F2ED" : "#0A0A0A",
                  letterSpacing: "-0.01em",
                }}
              >
                {r.headline}
              </span>
              <span
                style={{
                  fontSize: "var(--fs-sm)",
                  fontWeight: 400,
                  color: active ? "rgba(245,242,237,0.55)" : "#9A9490",
                  lineHeight: 1.5,
                }}
              >
                {r.sub}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

type ThemeId = "light" | "dark" | "cool";

const THEMES: ReadonlyArray<{
  id: ThemeId;
  name: string;
  tagline: string;
  surface: string;
  ink: string;
  accent: string;
  border: string;
}> = [
  {
    id: "light",
    name: "Cream",
    tagline: "Museum-quiet. Warm. The brand surface.",
    surface: "#F2EBE0",
    ink: "#1A1612",
    accent: "#9E6B47",
    border: "#DDD1C4",
  },
  {
    id: "dark",
    name: "Studio",
    tagline: "Cinematic. Focused. The workspace at night.",
    surface: "#0F0E0D",
    ink: "#F3EDE6",
    accent: "#C68B5F",
    border: "#2A2520",
  },
  {
    id: "cool",
    name: "Cool",
    tagline: "Crisp. Cool grays. Clarity over warmth.",
    surface: "#EEF1F4",
    ink: "#13171C",
    accent: "#5E7896",
    border: "#D1D8DF",
  },
];

function StepTheme({
  theme,
  setTheme,
}: {
  theme: ThemeId | null;
  setTheme: (t: ThemeId) => void;
}) {
  return (
    <motion.div
      key="theme"
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{ width: "100%", maxWidth: 720, opacity: 1 }}
    >
      <h1
        style={{
          fontSize: "clamp(26px, 3.5vw, 36px)",
          fontWeight: 300,
          letterSpacing: "-0.025em",
          color: "#0A0A0A",
          margin: "0 0 10px",
          lineHeight: 1.2,
        }}
      >
        Pick your workspace theme.
      </h1>
      <p
        style={{
          fontSize: "var(--fs-body)",
          color: "#9A9490",
          margin: "0 0 40px",
          fontWeight: 400,
        }}
      >
        Sets the tone of your daily view. You can change it later in Settings.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--sp-12)",
        }}
      >
        {THEMES.map((t) => {
          const selected = theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              style={{
                background: selected ? "#0A0A0A" : "#FFFFFF",
                border: `1.5px solid ${selected ? "#0A0A0A" : "#DDD8D0"}`,
                borderRadius: 14,
                padding: 14,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                textAlign: "left",
                fontFamily: "Manrope, sans-serif",
                transition: "0.15s",
              }}
            >
              {/* Preview window */}
              <div
                style={{
                  position: "relative",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: t.surface,
                  border: `1px solid ${t.border}`,
                  aspectRatio: "16 / 10",
                }}
              >
                {/* mini sidebar */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    gridTemplateColumns: "32% 1fr",
                  }}
                >
                  <div
                    style={{
                      background: t.surface,
                      borderRight: `1px solid ${t.border}`,
                      padding: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 4,
                        borderRadius: 2,
                        background: t.accent,
                      }}
                    />
                    <div
                      style={{
                        width: "70%",
                        height: 3,
                        borderRadius: 2,
                        background: t.ink,
                        opacity: 0.35,
                      }}
                    />
                    <div
                      style={{
                        width: "55%",
                        height: 3,
                        borderRadius: 2,
                        background: t.ink,
                        opacity: 0.22,
                      }}
                    />
                    <div
                      style={{
                        width: "62%",
                        height: 3,
                        borderRadius: 2,
                        background: t.ink,
                        opacity: 0.22,
                      }}
                    />
                  </div>
                  <div style={{ padding: 8 }}>
                    <div
                      style={{
                        width: "60%",
                        height: 4,
                        borderRadius: 2,
                        background: t.ink,
                        opacity: 0.6,
                        marginBottom: 6,
                      }}
                    />
                    <div
                      style={{
                        width: "85%",
                        height: 3,
                        borderRadius: 2,
                        background: t.ink,
                        opacity: 0.28,
                        marginBottom: 3,
                      }}
                    />
                    <div
                      style={{
                        width: "70%",
                        height: 3,
                        borderRadius: 2,
                        background: t.ink,
                        opacity: 0.28,
                        marginBottom: 10,
                      }}
                    />
                    <div
                      style={{
                        display: "inline-block",
                        background: t.accent,
                        color: t.surface,
                        fontSize: 7,
                        padding: "2px 6px",
                        borderRadius: 999,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                      }}
                    >
                      TWIN
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    fontSize: "var(--fs-base)",
                    fontWeight: 600,
                    color: selected ? "#F5F2ED" : "#0A0A0A",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {t.name}
                </span>
                <span
                  style={{
                    fontSize: "var(--fs-sm)",
                    fontWeight: 400,
                    color: selected ? "rgba(245,242,237,0.55)" : "#9A9490",
                    lineHeight: 1.5,
                  }}
                >
                  {t.tagline}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function StepReady({ company, reason }: { company: string; reason: string | null }) {
  const label = REASONS.find((r) => r.id === reason)?.headline ?? "";

  return (
    <motion.div
      key="ready"
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{ width: "100%", maxWidth: 480, textAlign: "center" }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: "#0A0A0A",
          display: "grid",
          placeItems: "center",
          margin: "0 auto 28px",
        }}
      >
        <Check width={22} height={22} strokeWidth={1.8} color="#F5F2ED" />
      </div>

      <h1
        style={{
          fontSize: "clamp(26px, 3.5vw, 36px)",
          fontWeight: 300,
          letterSpacing: "-0.025em",
          color: "#0A0A0A",
          margin: "0 0 10px",
          lineHeight: 1.2,
        }}
      >
        {company ? `${company} is ready.` : "You're all set."}
      </h1>
      <p style={{ fontSize: "var(--fs-body)", color: "#9A9490", margin: "0 0 40px", fontWeight: 400 }}>
        Your workspace is configured. Time to clone your first employee.
      </p>

      {(company || label) && (
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: "var(--sp-10)",
            background: "#FFFFFF",
            border: "1px solid #DDD8D0",
            borderRadius: 10,
            padding: "16px 24px",
            textAlign: "left",
            minWidth: 240,
          }}
        >
          {company && (
            <div style={{ display: "flex", gap: "var(--sp-10)", alignItems: "center" }}>
              <span style={{ fontSize: "var(--fs-meta)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9A9490", width: 64 }}>Company</span>
              <span style={{ fontSize: "var(--fs-ui)", fontWeight: 500, color: "#0A0A0A" }}>{company}</span>
            </div>
          )}
          {label && (
            <div style={{ display: "flex", gap: "var(--sp-10)", alignItems: "center" }}>
              <span style={{ fontSize: "var(--fs-meta)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9A9490", width: 64 }}>Goal</span>
              <span style={{ fontSize: "var(--fs-ui)", fontWeight: 500, color: "#0A0A0A" }}>{label}</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState("");
  const [size, setSize] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [theme, setThemeState] = useState<ThemeId | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Apply theme live the moment the CEO picks one, then carry it across to
  // the workspace by persisting to localStorage (matches the script in
  // src/app/layout.tsx that reads `em001-theme`).
  function setTheme(t: ThemeId) {
    setThemeState(t);
    try {
      localStorage.setItem("em001-theme", t);
      document.documentElement.setAttribute("data-theme", t);
    } catch {
      // Storage blocked (private mode, etc.). The dataset still applies.
    }
  }

  const canContinue =
    step === 0 ? company.trim().length > 1 && size !== null :
    step === 1 ? reason !== null :
    step === 2 ? theme !== null :
    true;

  function next() {
    if (step < 3) {
      setStep((s) => s + 1);
    } else {
      setLeaving(true);
      setTimeout(() => router.push("/launchpad"), 500);
    }
  }

  function back() {
    if (step > 0) setStep((s) => s - 1);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.4 }}
      style={{
        minHeight: "100vh",
        background: "#F5F2ED",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        fontFamily: '"Manrope", sans-serif',
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          position: "fixed",
          top: 32,
          left: 40,
          fontSize: "var(--fs-ui)",
          fontWeight: 600,
          letterSpacing: "0.12em",
          color: "#0A0A0A",
          textTransform: "uppercase",
        }}
      >
        Employee001
      </div>

      {/* Step dots */}
      <div style={{ position: "fixed", top: 38, right: 40, display: "flex", gap: "var(--sp-7)" }}>
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            animate={{ background: i <= step ? "#0A0A0A" : "#DDD8D0" }}
            transition={{ duration: 0.2 }}
            style={{ width: 6, height: 6, borderRadius: "50%" }}
          />
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        {step === 0 && (
          <StepOrg company={company} setCompany={setCompany} size={size} setSize={setSize} />
        )}
        {step === 1 && (
          <StepReason reason={reason} setReason={setReason} />
        )}
        {step === 2 && (
          <StepTheme theme={theme} setTheme={setTheme} />
        )}
        {step === 3 && (
          <StepReady company={company} reason={reason} />
        )}
      </AnimatePresence>

      {/* Navigation */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-16)",
          marginTop: "var(--sp-48)",
        }}
      >
        {step > 0 && (
          <button
            onClick={back}
            style={{
              fontSize: "var(--fs-ui)",
              color: "#9A9490",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: '"Manrope", sans-serif',
              padding: "4px 0",
            }}
          >
            ← Back
          </button>
        )}
        <motion.button
          onClick={next}
          disabled={!canContinue}
          whileHover={canContinue ? { scale: 1.02 } : {}}
          whileTap={canContinue ? { scale: 0.97 } : {}}
          style={{
            padding: step === 3 ? "16px 52px" : "14px 44px",
            background: canContinue ? "#0A0A0A" : "#E8E4DC",
            color: canContinue ? "#F5F2ED" : "#B8B0A8",
            border: "none",
            borderRadius: 100,
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: canContinue ? "pointer" : "default",
            fontFamily: '"Manrope", sans-serif',
            transition: "background .2s, color .2s",
          }}
        >
          {step === 3 ? "Open dashboard" : "Continue"}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
