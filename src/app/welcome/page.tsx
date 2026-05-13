"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Loaded inline so the serif appears even though the root layout has no
// font setup. Browser falls through to system serif while it streams.
const SERIF_FONT =
  '"Instrument Serif", ui-serif, Georgia, Cambria, "Times New Roman", serif';
const SANS_FONT =
  'ui-sans-serif, -apple-system, "Manrope", system-ui, sans-serif';

// Shown once on first-run after `npx employee001 setup && npx employee001 start`.
// The proxy redirects "/" here unless the `e001_welcomed` cookie is set.
// Hitting "Enter the workspace" sets that cookie for a year, so the page
// will not reappear on subsequent visits unless the cookie is cleared.

const WELCOME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export default function WelcomePage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  // Autoplay once the metadata is loaded. Muted is required by every browser
  // for inline autoplay; user can unmute via the native controls.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onReady = () => {
      setVideoReady(true);
      v.play().catch(() => {
        // some browsers still block; that's fine — the controls show.
      });
    };
    v.addEventListener("loadedmetadata", onReady, { once: true });
    return () => v.removeEventListener("loadedmetadata", onReady);
  }, []);

  function dismiss() {
    document.cookie = `e001_welcomed=1; path=/; max-age=${WELCOME_COOKIE_MAX_AGE}; samesite=lax`;
    router.push("/onboarding");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0A0A0A",
        color: "#F5F1EA",
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
              color: "#9A9490",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#9E6B47",
              }}
            />
            Employee001
          </div>
          <button
            onClick={dismiss}
            style={{
              background: "transparent",
              border: "1px solid #2A2A2A",
              color: "#9A9490",
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
            background: "#141414",
            border: "1px solid #1F1F1F",
            boxShadow:
              "0 30px 80px -20px rgba(158, 107, 71, 0.25), 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          {!videoReady && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "#4A4540",
                fontSize: 13,
                letterSpacing: "0.04em",
              }}
            >
              loading welcome…
            </div>
          )}
          <video
            ref={videoRef}
            src="/welcome.mp4"
            preload="auto"
            playsInline
            muted
            controls
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              opacity: videoReady ? 1 : 0,
              transition: "opacity 0.4s ease",
            }}
          />
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
              color: "#F5F1EA",
            }}
          >
            Welcome to the future.
          </h1>
          <p
            style={{
              fontSize: "clamp(15px, 1.6vw, 18px)",
              lineHeight: 1.6,
              color: "#A8A39D",
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
              color: "#A8A39D",
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
              color: "#6B6359",
              fontSize: 14,
              letterSpacing: "0.02em",
            }}
          >
            <div
              style={{
                width: 48,
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, #6B6359, transparent)",
              }}
            />
            <div style={{ fontStyle: "italic", color: "#9A9490" }}>
              With my blessing,
            </div>
            <div
              style={{
                fontFamily: SERIF_FONT,
                fontSize: 22,
                color: "#F5F1EA",
                letterSpacing: "-0.01em",
              }}
            >
              Dolev Hayut
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#6B6359",
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
              background: "#F5F1EA",
              color: "#0A0A0A",
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
              e.currentTarget.style.background = "#FFFFFF";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#F5F1EA";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Enter the workspace →
          </button>
        </section>
      </div>
    </main>
  );
}
