"use client";

import { useState, type FocusEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "iconoir-react";
import { useT } from "@/components/ex/i18n-context";

const stepVariants = {
  enter: { opacity: 0, y: 18 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
};

const FOCUS_RING = "2px solid var(--accent)";

const focusRingHandlers = {
  onFocus: (e: FocusEvent<HTMLElement>) => {
    e.currentTarget.style.outline = FOCUS_RING;
    e.currentTarget.style.outlineOffset = "2px";
  },
  onBlur: (e: FocusEvent<HTMLElement>) => {
    e.currentTarget.style.outline = "none";
  },
};

function StepOrg({
  company,
  setCompany,
}: {
  company: string;
  setCompany: (v: string) => void;
}) {
  const { t } = useT();
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
          color: "var(--text)",
          margin: "0 0 10px",
          lineHeight: 1.2,
        }}
      >
        {t("setup.title")}
      </h1>
      <p style={{ fontSize: "var(--fs-body)", color: "var(--text-subtle)", margin: "0 0 48px", fontWeight: 400 }}>
        {t("setup.subtitle")}
      </p>

      <div>
        <label
          htmlFor="setup-company"
          style={{
            display: "block",
            fontSize: "var(--fs-meta)",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-subtle)",
            marginBottom: "var(--sp-10)",
          }}
        >
          {t("setup.company")}
        </label>
        <input
          id="setup-company"
          autoFocus
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Employee001"
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: "var(--fs-lg)",
            fontFamily: 'var(--font-geist), sans-serif',
            fontWeight: 400,
            color: "var(--text)",
            background: "var(--surface)",
            border: "1.5px solid var(--hairline-strong)",
            borderRadius: 8,
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color .15s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--text)";
            e.currentTarget.style.outline = FOCUS_RING;
            e.currentTarget.style.outlineOffset = "2px";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--hairline-strong)";
            e.currentTarget.style.outline = "none";
          }}
        />
      </div>
    </motion.div>
  );
}

// Exactly two themes: light (white, stone, dark brown) and dark (black, grey,
// white). Labels and taglines come from the onboarding catalog.
type ThemeId = "light" | "dark";

const THEMES: ReadonlyArray<{ id: ThemeId }> = [{ id: "light" }, { id: "dark" }];

function StepTheme({
  theme,
  setTheme,
}: {
  theme: ThemeId | null;
  setTheme: (t: ThemeId) => void;
}) {
  const { t } = useT();
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
          color: "var(--text)",
          margin: "0 0 10px",
          lineHeight: 1.2,
        }}
      >
        {t("setup.theme")}
      </h1>
      <p
        style={{
          fontSize: "var(--fs-body)",
          color: "var(--text-subtle)",
          margin: "0 0 40px",
          fontWeight: 400,
        }}
      >
        {t("setup.themeSub")}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "var(--sp-12)",
        }}
      >
        {THEMES.map((themeOption) => {
          const selected = theme === themeOption.id;
          return (
            <button
              key={themeOption.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setTheme(themeOption.id)}
              style={{
                background: selected ? "var(--text)" : "var(--surface)",
                border: `1.5px solid ${selected ? "var(--text)" : "var(--hairline-strong)"}`,
                borderRadius: 14,
                padding: 14,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                textAlign: "start",
                fontFamily: "var(--font-geist), sans-serif",
                transition: "0.15s",
                outline: "none",
              }}
              {...focusRingHandlers}
            >
              {/* Preview window */}
              <div
                data-theme={themeOption.id}
                style={{
                  position: "relative",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--bg)",
                  border: "1px solid var(--hairline)",
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
                      background: "var(--bg)",
                      borderRight: "1px solid var(--hairline)",
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
                        background: "var(--accent)",
                      }}
                    />
                    <div
                      style={{
                        width: "70%",
                        height: 3,
                        borderRadius: 2,
                        background: "var(--text)",
                        opacity: 0.35,
                      }}
                    />
                    <div
                      style={{
                        width: "55%",
                        height: 3,
                        borderRadius: 2,
                        background: "var(--text)",
                        opacity: 0.22,
                      }}
                    />
                    <div
                      style={{
                        width: "62%",
                        height: 3,
                        borderRadius: 2,
                        background: "var(--text)",
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
                        background: "var(--text)",
                        opacity: 0.6,
                        marginBottom: 6,
                      }}
                    />
                    <div
                      style={{
                        width: "85%",
                        height: 3,
                        borderRadius: 2,
                        background: "var(--text)",
                        opacity: 0.28,
                        marginBottom: 3,
                      }}
                    />
                    <div
                      style={{
                        width: "70%",
                        height: 3,
                        borderRadius: 2,
                        background: "var(--text)",
                        opacity: 0.28,
                        marginBottom: 10,
                      }}
                    />
                    <div
                      style={{
                        display: "inline-block",
                        background: "var(--accent)",
                        color: "var(--bg)",
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
                    color: selected ? "var(--bg)" : "var(--text)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {t(`setup.theme.${themeOption.id}`)}
                </span>
                <span
                  style={{
                    fontSize: "var(--fs-sm)",
                    fontWeight: 400,
                    color: selected ? "color-mix(in oklch, var(--bg) 55%, transparent)" : "var(--text-subtle)",
                    lineHeight: 1.5,
                  }}
                >
                  {t(`setup.theme.${themeOption.id}Sub`)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function StepReady({ company }: { company: string }) {
  const { t } = useT();

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
          background: "var(--text)",
          display: "grid",
          placeItems: "center",
          margin: "0 auto 28px",
        }}
      >
        <Check width={22} height={22} strokeWidth={1.8} color="var(--bg)" />
      </div>

      <h1
        style={{
          fontSize: "clamp(26px, 3.5vw, 36px)",
          fontWeight: 300,
          letterSpacing: "-0.025em",
          color: "var(--text)",
          margin: "0 0 10px",
          lineHeight: 1.2,
        }}
      >
        {company ? t("setup.readyNamed", { company }) : t("setup.ready")}
      </h1>
      <p style={{ fontSize: "var(--fs-body)", color: "var(--text-subtle)", margin: "0 0 40px", fontWeight: 400 }}>
        {t("setup.readySub")}
      </p>

      {company && (
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: "var(--sp-10)",
            background: "var(--surface)",
            border: "1px solid var(--hairline-strong)",
            borderRadius: 10,
            padding: "16px 24px",
            textAlign: "start",
            minWidth: 240,
          }}
        >
          <div style={{ display: "flex", gap: "var(--sp-10)", alignItems: "center" }}>
            <span style={{ fontSize: "var(--fs-meta)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-subtle)", width: 64 }}>{t("setup.company")}</span>
            <span style={{ fontSize: "var(--fs-ui)", fontWeight: 500, color: "var(--text)" }}>{company}</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const { t, locale } = useT();
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState("");
  const [theme, setThemeState] = useState<ThemeId | null>(null);
  const [leaving, setLeaving] = useState(false);
  const isRtl = locale === "he";
  const backArrow = isRtl ? "→" : "←";
  const forwardArrow = isRtl ? "←" : "→";

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
    step === 0 ? company.trim().length > 1 :
    step === 1 ? theme !== null :
    true;

  function next() {
    if (step === 0) {
      // Twins introduce themselves as working at this company. Best-effort:
      // the name can always be fixed later in Settings → Workspace.
      void fetch("/api/org/identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: company }),
      }).catch(() => {});
    }
    if (step < 2) {
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
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        fontFamily: 'var(--font-geist), sans-serif',
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          position: "fixed",
          top: 32,
          insetInlineStart: 40,
          fontSize: "var(--fs-ui)",
          fontWeight: 600,
          letterSpacing: "0.12em",
          color: "var(--text)",
          textTransform: "uppercase",
        }}
      >
        Employee001
      </div>

      {/* Step dots */}
      <ol
        aria-label="Setup progress"
        style={{
          position: "fixed",
          top: 38,
          insetInlineEnd: 40,
          display: "flex",
          gap: "var(--sp-7)",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {[0, 1, 2].map((i) => (
          <li key={i} aria-current={i === step ? "step" : undefined}>
            <motion.span
              aria-hidden="true"
              animate={{ background: i <= step ? "var(--text)" : "var(--hairline-strong)" }}
              transition={{ duration: 0.2 }}
              style={{ display: "block", width: 6, height: 6, borderRadius: "50%" }}
            />
          </li>
        ))}
      </ol>

      {/* Step content */}
      <AnimatePresence mode="wait">
        {step === 0 && (
          <StepOrg company={company} setCompany={setCompany} />
        )}
        {step === 1 && (
          <StepTheme theme={theme} setTheme={setTheme} />
        )}
        {step === 2 && (
          <StepReady company={company} />
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
            type="button"
            onClick={back}
            {...focusRingHandlers}
            style={{
              fontSize: "var(--fs-ui)",
              color: "var(--text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: 'var(--font-geist), sans-serif',
              padding: "4px 0",
            }}
          >
            {backArrow} {t("setup.back")}
          </button>
        )}
        <motion.button
          type="button"
          onClick={next}
          disabled={!canContinue}
          whileHover={canContinue ? { scale: 1.02 } : {}}
          whileTap={canContinue ? { scale: 0.97 } : {}}
          {...focusRingHandlers}
          style={{
            padding: step === 2 ? "16px 52px" : "14px 44px",
            background: canContinue ? "var(--text)" : "var(--bg-sunken)",
            color: canContinue ? "var(--bg)" : "var(--text-subtle)",
            border: "none",
            borderRadius: 100,
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: canContinue ? "pointer" : "default",
            fontFamily: 'var(--font-geist), sans-serif',
            transition: "background .2s, color .2s",
          }}
        >
          {step === 2 ? (
            <>
              {t("setup.open")} {forwardArrow}
            </>
          ) : (
            <>
              {t("setup.continue")} {forwardArrow}
            </>
          )}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
