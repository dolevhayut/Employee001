"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChatBubble, DotsGrid3x3, Flash, GitBranch, Mail, VideoCamera } from "iconoir-react";
import { EMPLOYEES, INTEGRATIONS, PROCESSING_MESSAGES } from "@/lib/demo";

const ICON_MAP: Record<string, React.ReactNode> = {
  mail: <Mail width={14} height={14} strokeWidth={1.8} />,
  "message-square": <ChatBubble width={14} height={14} strokeWidth={1.8} />,
  "git-branch": <GitBranch width={14} height={14} strokeWidth={1.8} />,
  "layout-grid": <DotsGrid3x3 width={14} height={14} strokeWidth={1.8} />,
  zap: <Flash width={14} height={14} strokeWidth={1.8} />,
  video: <VideoCamera width={14} height={14} strokeWidth={1.8} />,
};

function useCountUp(target: number, duration: number, started: boolean) {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (!started) return;
    startTime.current = null;

    function step(ts: number) {
      if (!startTime.current) startTime.current = ts;
      const elapsed = ts - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) {
        raf.current = requestAnimationFrame(step);
      }
    }

    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [started, target, duration]);

  return value;
}

function IntegrationRow({
  integrationId,
  startDelay,
  totalDuration,
  visible,
}: {
  integrationId: string;
  startDelay: number;
  totalDuration: number;
  visible: boolean;
}) {
  const integration = INTEGRATIONS[integrationId];
  const [progress, setProgress] = useState(0);
  const [started, setStarted] = useState(false);
  const raf = useRef<number | null>(null);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => {
      setStarted(true);
      startTime.current = null;

      function step(ts: number) {
        if (!startTime.current) startTime.current = ts;
        const elapsed = ts - startTime.current;
        const p = Math.min(elapsed / totalDuration, 1);
        const eased = 1 - Math.pow(1 - p, 2.5);
        setProgress(eased);
        if (p < 1) {
          raf.current = requestAnimationFrame(step);
        }
      }
      raf.current = requestAnimationFrame(step);
    }, startDelay);

    return () => {
      clearTimeout(timeout);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [visible, startDelay, totalDuration]);

  const countValue = useCountUp(
    integration.totalItems,
    totalDuration,
    started
  );

  const isDone = progress >= 1;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: visible ? 1 : 0, x: 0 }}
      transition={{ duration: 0.4, delay: startDelay / 1000 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-16)",
        padding: "14px 0",
        borderBottom: "1px solid #EDE8E1",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: isDone ? "#0A0A0A" : integration.bgColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: isDone ? "#F5F2ED" : integration.color,
          flexShrink: 0,
          transition: "all 0.4s ease",
        }}
      >
        {ICON_MAP[integration.icon]}
      </div>

      {/* Name */}
      <div style={{ width: 110, flexShrink: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
            color: "#0A0A0A",
            letterSpacing: "-0.01em",
          }}
        >
          {integration.name}
        </div>
        <div style={{ fontSize: "var(--fs-meta)", color: "#9A9490", marginTop: "var(--sp-1)" }}>
          {isDone ? "Complete" : started ? "Processing…" : "Queued"}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            height: 3,
            background: "#EDE8E1",
            borderRadius: 100,
            overflow: "hidden",
          }}
        >
          <motion.div
            style={{
              height: "100%",
              background: isDone ? "#0A0A0A" : "#B09080",
              borderRadius: 100,
              transformOrigin: "left",
            }}
            animate={{ scaleX: progress }}
            transition={{ ease: "linear", duration: 0.1 }}
          />
        </div>
      </div>

      {/* Count */}
      <div
        style={{
          width: 80,
          textAlign: "right",
          fontSize: "var(--fs-sm)",
          fontWeight: 500,
          color: isDone ? "#0A0A0A" : "#9A9490",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.01em",
        }}
      >
        {countValue.toLocaleString()} {integration.unit}
      </div>
    </motion.div>
  );
}

function DashboardContent() {
  const params = useSearchParams();
  const router = useRouter();
  const employeeId = params.get("employee") ?? EMPLOYEES[0]?.id ?? "";
  const employee = EMPLOYEES.find((e) => e.id === employeeId) ?? EMPLOYEES[0];

  const [phase, setPhase] = useState<"loading" | "done">("loading");
  const [msgIndex, setMsgIndex] = useState(0);
  const [totalDataPoints, setTotalDataPoints] = useState(0);

  // Total duration = max(startDelay + duration) across integrations used
  const integrationDefs = employee.integrations.map((id) => INTEGRATIONS[id]).filter(Boolean);
  const maxDuration = Math.max(...integrationDefs.map((i) => i.startDelay + i.duration));

  useEffect(() => {
    // Rotate processing messages every 2.2s
    const interval = setInterval(() => {
      setMsgIndex((m) => (m + 1) % PROCESSING_MESSAGES.length);
    }, 2200);

    // Mark done after all bars finish
    const timeout = setTimeout(() => setPhase("done"), maxDuration + 400);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [maxDuration]);

  // Count up total data points
  const totalTarget = integrationDefs.reduce((s, i) => s + i.totalItems, 0);
  useEffect(() => {
    let raf: number;
    let start: number | null = null;
    const dur = maxDuration;

    function step(ts: number) {
      if (!start) start = ts;
      const elapsed = ts - start;
      const p = Math.min(elapsed / dur, 1);
      const eased = 1 - Math.pow(1 - p, 2);
      setTotalDataPoints(Math.floor(eased * totalTarget));
      if (p < 1) raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [maxDuration, totalTarget]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      style={{
        minHeight: "100vh",
        backgroundColor: "#F5F2ED",
        fontFamily: '"Manrope", sans-serif',
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "28px 40px",
          borderBottom: "1px solid #EDE8E1",
        }}
      >
        <div
          style={{
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
            letterSpacing: "0.12em",
            color: "#0A0A0A",
            textTransform: "uppercase",
          }}
        >
          Employee001
        </div>

        {/* Live indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
          <motion.div
            animate={phase === "loading" ? { scale: [1, 1.4, 1], opacity: [1, 0.4, 1] } : { scale: 1, opacity: 1 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: phase === "done" ? "#22C55E" : "#B09080",
            }}
          />
          <span style={{ fontSize: "var(--fs-sm)", color: "#9A9490", letterSpacing: "0.04em" }}>
            {phase === "done" ? "Complete" : "Live"}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          maxWidth: 780,
          margin: "0 auto",
          padding: "56px 24px 80px",
          width: "100%",
        }}
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          style={{ marginBottom: 52 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--sp-12)",
              marginBottom: "var(--sp-8)",
            }}
          >
            {/* Employee avatar mini */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: employee.avatarColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--fs-sm)",
                fontWeight: 700,
                color: "#0A0A0A",
                flexShrink: 0,
              }}
            >
              {employee.initials}
            </div>
            <h1
              style={{
                fontSize: "clamp(22px, 3.5vw, 36px)",
                fontWeight: 300,
                color: "#0A0A0A",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}
            >
              Building{" "}
              <span style={{ fontWeight: 600 }}>{employee.firstName}&apos;s</span>{" "}
              twin.
            </h1>
          </div>

          {/* Total data points */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-8)", marginTop: "var(--sp-16)" }}>
            <span
              style={{
                fontSize: "clamp(32px, 5vw, 52px)",
                fontWeight: 700,
                color: "#0A0A0A",
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {totalDataPoints.toLocaleString()}
            </span>
            <span style={{ fontSize: "var(--fs-base)", color: "#9A9490", fontWeight: 400 }}>
              data points ingested
            </span>
          </div>
        </motion.div>

        {/* Integration rows */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {integrationDefs.map((integration) => (
            <IntegrationRow
              key={integration.id}
              integrationId={integration.id}
              startDelay={integration.startDelay}
              totalDuration={integration.duration}
              visible
            />
          ))}
        </motion.div>

        {/* Processing message */}
        <div style={{ marginTop: "var(--sp-40)", minHeight: 28 }}>
          <AnimatePresence mode="wait">
            {phase === "loading" ? (
              <motion.p
                key={msgIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
                style={{
                  fontSize: "var(--fs-ui)",
                  color: "#9A9490",
                  letterSpacing: "0.02em",
                  fontStyle: "italic",
                }}
              >
                {PROCESSING_MESSAGES[msgIndex]}
              </motion.p>
            ) : (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                style={{ display: "flex", flexDirection: "column", gap: "var(--sp-20)", alignItems: "flex-start" }}
              >
                <p
                  style={{
                    fontSize: "var(--fs-lg)",
                    fontWeight: 600,
                    color: "#0A0A0A",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {employee.firstName}&apos;s twin is ready.
                </p>
                <div style={{ display: "flex", gap: "var(--sp-12)" }}>
                  <motion.button
                    style={{
                      padding: "12px 32px",
                      background: "#0A0A0A",
                      color: "#F5F2ED",
                      border: "none",
                      borderRadius: 100,
                      fontSize: "var(--fs-ui)",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      fontFamily: '"Manrope", sans-serif',
                    }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => router.push(`/flow?employee=${employeeId}`)}
                  >
                    Open Twin
                  </motion.button>
                  <motion.button
                    style={{
                      padding: "12px 24px",
                      background: "transparent",
                      color: "#9A9490",
                      border: "1.5px solid #DDD8D0",
                      borderRadius: 100,
                      fontSize: "var(--fs-ui)",
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: '"Manrope", sans-serif',
                    }}
                    whileHover={{ borderColor: "#9A9490" }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => router.push("/")}
                  >
                    Clone another
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
