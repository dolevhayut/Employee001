"use client";

import { useRouter } from "next/navigation";
import { WelcomeHero3D } from "@/components/welcome/WelcomeHero3D";

// Manrope + Instrument Serif are loaded at the root layout
// (src/app/layout.tsx) and exposed as CSS variables. These pages reference
// them so the brand fonts apply consistently across welcome, join, and the
// rest of the app.
const SERIF_FONT =
  'var(--font-instrument-serif), "Instrument Serif", ui-serif, Georgia, serif';
const SANS_FONT =
  'var(--font-manrope), "Manrope", ui-sans-serif, system-ui, sans-serif';

// Brand palette — drawn from social/main.png + campaign carousels.
const PALETTE = {
  surface: "#F2EBE0",
  surfaceDeep: "#E6DDCE",
  copper: "#9E6B47",
  ink: "#1A1612",
  inkMuted: "#5E544B",
  inkDim: "#8A7F73",
};

// Shown once on first-run after `npx employee001 setup && npx employee001 start`.
// The proxy redirects "/" here unless the `e001_welcomed` cookie is set.
// Hitting "Enter the workspace" sets that cookie for a year, so the page
// will not reappear on subsequent visits unless the cookie is cleared.

const WELCOME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export default function WelcomePage() {
  const router = useRouter();

  function dismiss() {
    document.cookie = `e001_welcomed=1; path=/; max-age=${WELCOME_COOKIE_MAX_AGE}; samesite=lax`;
    router.push("/setup");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: PALETTE.surface,
        color: PALETTE.ink,
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        fontFamily: SANS_FONT,
      }}
    >
      <div style={{ maxWidth: 980, width: "100%" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 14,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: PALETTE.inkMuted,
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
          <button
            onClick={dismiss}
            style={{
              background: "transparent",
              border: `1px solid ${PALETTE.surfaceDeep}`,
              color: PALETTE.inkMuted,
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Skip →
          </button>
        </header>

        <div
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            borderRadius: 16,
            overflow: "hidden",
            background: PALETTE.surfaceDeep,
            border: `1px solid ${PALETTE.surfaceDeep}`,
            boxShadow:
              "0 30px 80px -20px rgba(158, 107, 71, 0.30), 0 0 0 1px rgba(26,22,18,0.04)",
          }}
        >
          <WelcomeHero3D />
        </div>

        <section
          style={{
            marginTop: 48,
            display: "grid",
            gap: 24,
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontFamily: SERIF_FONT,
              fontWeight: 400,
              fontSize: "clamp(36px, 6vw, 64px)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: 0,
              color: PALETTE.ink,
            }}
          >
            Welcome to the future.
          </h1>
          <p
            style={{
              fontSize: "clamp(15px, 1.6vw, 18px)",
              lineHeight: 1.6,
              color: PALETTE.inkMuted,
              margin: 0,
              maxWidth: 620,
              marginInline: "auto",
            }}
          >
            Your company&apos;s organizational brain. Agent twins of every person
            on your team, running on your own machine. No cloud. No telemetry.
            Yours to shape.
          </p>
          <p
            style={{
              fontSize: "clamp(15px, 1.6vw, 18px)",
              lineHeight: 1.6,
              color: PALETTE.inkMuted,
              margin: 0,
              maxWidth: 620,
              marginInline: "auto",
            }}
          >
            Get ready for 2030.
          </p>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: PALETTE.inkDim,
              fontSize: 14,
              letterSpacing: "0.02em",
            }}
          >
            <div
              style={{
                width: 48,
                height: 1,
                background:
                  `linear-gradient(90deg, transparent, ${PALETTE.inkDim}, transparent)`,
              }}
            />
            <div style={{ fontStyle: "italic", color: PALETTE.inkMuted }}>
              With my blessing,
            </div>
            <div
              style={{
                fontFamily: SERIF_FONT,
                fontSize: 22,
                color: PALETTE.ink,
                letterSpacing: "-0.01em",
              }}
            >
              Dolev Hayut
            </div>
            <div
              style={{
                fontSize: 12,
                color: PALETTE.inkDim,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              Founder, Employee001
            </div>
          </div>

          <button
            onClick={dismiss}
            style={{
              marginTop: 32,
              alignSelf: "center",
              justifySelf: "center",
              background: PALETTE.ink,
              color: PALETTE.surface,
              border: "none",
              padding: "14px 32px",
              borderRadius: 999,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
              transition: "transform 0.15s ease, background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = PALETTE.copper;
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = PALETTE.ink;
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Setup Your Workspace →
          </button>
        </section>
      </div>
    </main>
  );
}
