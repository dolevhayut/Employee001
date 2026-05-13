"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "iconoir-react";
import { INTEGRATIONS } from "@/lib/demo";

const DEMO_NAME = "Sarah";
const DEMO_COMPANY = "Acme Corp";

type Step =
  | { type: "welcome" }
  | { type: "connect"; integrationId: string }
  | { type: "done" };

const FLOW: Step[] = [
  { type: "welcome" },
  { type: "connect", integrationId: "gmail" },
  { type: "connect", integrationId: "slack" },
  { type: "connect", integrationId: "github" },
  { type: "connect", integrationId: "zoom" },
  { type: "done" },
];

// Step dots at bottom
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-8)", alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            width: i === current ? 20 : 6,
            background: i <= current ? "#0A0A0A" : "#DDD8D0",
          }}
          transition={{ duration: 0.3 }}
          style={{ height: 6, borderRadius: 100 }}
        />
      ))}
    </div>
  );
}

// Brand logo via Simple Icons CDN — real logos, monochrome black
function ServiceIcon({ integrationId }: { integrationId: string }) {
  const integration = INTEGRATIONS[integrationId];
  const iconUrl = integration?.simpleIconSlug
    ? `https://cdn.simpleicons.org/${integration.simpleIconSlug}/0A0A0A`
    : null;

  return (
    <motion.div
      initial={{ scale: 0.82, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 1.06, opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        width: 100,
        height: 100,
        borderRadius: 28,
        background: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: "var(--sp-32)",
        border: "1.5px solid #EDE8E1",
        boxShadow: "0 4px 24px rgba(10,10,10,0.06)",
      }}
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt={integration.name} width={46} height={46} />
      ) : (
        <span style={{ fontSize: "var(--fs-h1)", fontWeight: 300, color: "#0A0A0A" }}>
          {integrationId.charAt(0).toUpperCase()}
        </span>
      )}
    </motion.div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <motion.div
      key="welcome"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.5 }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        maxWidth: 420,
      }}
    >
      {/* Subtle avatar */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "#C4B4A8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--fs-h3)",
          fontWeight: 700,
          color: "#0A0A0A",
          marginBottom: "var(--sp-32)",
          letterSpacing: "0.04em",
        }}
      >
        SC
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        style={{
          fontSize: "clamp(26px, 4vw, 38px)",
          fontWeight: 300,
          color: "#0A0A0A",
          letterSpacing: "-0.02em",
          lineHeight: 1.25,
          marginBottom: "var(--sp-16)",
        }}
      >
        Hi {DEMO_NAME},
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5 }}
        style={{
          fontSize: "var(--fs-lg)",
          fontWeight: 400,
          color: "#696969",
          lineHeight: 1.6,
          marginBottom: "var(--sp-12)",
          maxWidth: 340,
        }}
      >
        <strong style={{ color: "#0A0A0A", fontWeight: 600 }}>{DEMO_COMPANY}</strong> invited you
        to create your digital twin.
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.5 }}
        style={{
          fontSize: "var(--fs-ui)",
          color: "#B09080",
          marginBottom: "var(--sp-48)",
          lineHeight: 1.5,
        }}
      >
        Your expertise, available 24/7.
        <br />
        Takes about 3 minutes.
      </motion.p>

      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.4 }}
        onClick={onNext}
        style={{
          padding: "15px 52px",
          background: "#0A0A0A",
          color: "#F5F2ED",
          border: "none",
          borderRadius: 100,
          fontSize: "var(--fs-ui)",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: '"Manrope", sans-serif',
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
      >
        Let&apos;s begin
      </motion.button>
    </motion.div>
  );
}

function ConnectStep({
  integrationId,
  onNext,
  stepIndex,
  totalConnectSteps,
}: {
  integrationId: string;
  onNext: () => void;
  stepIndex: number;
  totalConnectSteps: number;
}) {
  const integration = INTEGRATIONS[integrationId];
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  function handleConnect() {
    setConnecting(true);
    setTimeout(() => {
      setConnected(true);
      setTimeout(onNext, 800);
    }, 1600);
  }

  return (
    <motion.div
      key={integrationId}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        maxWidth: 380,
      }}
    >
      <ServiceIcon integrationId={integrationId} />

      <motion.h2
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        style={{
          fontSize: "clamp(20px, 3vw, 28px)",
          fontWeight: 300,
          color: "#0A0A0A",
          letterSpacing: "-0.02em",
          marginBottom: "var(--sp-10)",
        }}
      >
        Connect {integration.name}
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.18, duration: 0.4 }}
        style={{
          fontSize: "var(--fs-base)",
          color: "#9A9490",
          lineHeight: 1.55,
          marginBottom: "var(--sp-40)",
          maxWidth: 300,
        }}
      >
        {integration.description}
      </motion.p>

      <AnimatePresence mode="wait">
        {connected ? (
          <motion.div
            key="check"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, ease: "backOut" }}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "#0A0A0A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check width={20} height={20} strokeWidth={2.5} color="#F5F2ED" />
          </motion.div>
        ) : (
          <motion.button
            key="btn"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            onClick={handleConnect}
            disabled={connecting}
            style={{
              padding: "14px 44px",
              background: connecting ? "#EDE8E1" : "#0A0A0A",
              color: connecting ? "#9A9490" : "#F5F2ED",
              border: "none",
              borderRadius: 100,
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: connecting ? "default" : "pointer",
              fontFamily: '"Manrope", sans-serif',
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-10)",
              transition: "all 0.3s ease",
            }}
            whileHover={!connecting ? { scale: 1.02 } : {}}
            whileTap={!connecting ? { scale: 0.97 } : {}}
          >
            {connecting ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid #B09080",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                  }}
                />
                Connecting…
              </>
            ) : (
              `Connect`
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Skip */}
      {!connecting && !connected && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          onClick={onNext}
          style={{
            marginTop: "var(--sp-16)",
            background: "none",
            border: "none",
            fontSize: "var(--fs-sm)",
            color: "#B09080",
            cursor: "pointer",
            fontFamily: '"Manrope", sans-serif',
            letterSpacing: "0.02em",
          }}
        >
          Skip for now
        </motion.button>
      )}

      {/* Progress: n of total */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        style={{ marginTop: "var(--sp-32)", fontSize: "var(--fs-meta)", color: "#C4B4A8", letterSpacing: "0.04em" }}
      >
        {stepIndex} of {totalConnectSteps}
      </motion.p>
    </motion.div>
  );
}

function DoneStep() {
  return (
    <motion.div
      key="done"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        maxWidth: 380,
      }}
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.1, duration: 0.5, ease: "backOut" }}
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "#0A0A0A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "var(--sp-32)",
        }}
      >
        <Check width={32} height={32} strokeWidth={2} color="#F5F2ED" />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5 }}
        style={{
          fontSize: "clamp(22px, 3.5vw, 32px)",
          fontWeight: 300,
          color: "#0A0A0A",
          letterSpacing: "-0.02em",
          marginBottom: "var(--sp-14)",
        }}
      >
        You&apos;re all set, {DEMO_NAME}.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.5 }}
        style={{
          fontSize: "var(--fs-base)",
          color: "#9A9490",
          lineHeight: 1.6,
          maxWidth: 300,
        }}
      >
        Your digital twin is being built.
        <br />
        {DEMO_COMPANY} will notify you when it&apos;s ready.
      </motion.p>
    </motion.div>
  );
}

export default function JoinPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const step = FLOW[stepIndex];

  const connectSteps = FLOW.filter((s) => s.type === "connect");

  function next() {
    setStepIndex((i) => Math.min(i + 1, FLOW.length - 1));
  }

  // Which connect step number is this?
  const connectStepNumber =
    step.type === "connect"
      ? FLOW.slice(0, stepIndex).filter((s) => s.type === "connect").length + 1
      : 0;

  // Dot progress: exclude welcome and done
  const dotTotal = connectSteps.length + 1; // +1 for done state
  const dotCurrent =
    step.type === "welcome"
      ? 0
      : step.type === "connect"
      ? connectStepNumber
      : dotTotal - 1;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#F5F2ED",
        fontFamily: '"Manrope", sans-serif',
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          padding: "28px 40px",
          fontSize: "var(--fs-ui)",
          fontWeight: 600,
          letterSpacing: "0.12em",
          color: "#0A0A0A",
          textTransform: "uppercase",
        }}
      >
        Employee001
      </div>

      {/* Center content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
          position: "relative",
        }}
      >
        <AnimatePresence mode="wait">
          {step.type === "welcome" && <WelcomeStep key="welcome" onNext={next} />}
          {step.type === "connect" && (
            <ConnectStep
              key={step.integrationId}
              integrationId={step.integrationId}
              onNext={next}
              stepIndex={connectStepNumber}
              totalConnectSteps={connectSteps.length}
            />
          )}
          {step.type === "done" && <DoneStep key="done" />}
        </AnimatePresence>
      </div>

      {/* Bottom progress dots */}
      {step.type !== "welcome" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "24px 0 40px",
          }}
        >
          <StepDots current={dotCurrent - 1} total={dotTotal} />
        </motion.div>
      )}
    </div>
  );
}
