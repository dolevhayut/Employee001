"use client";

import { motion } from "framer-motion";
import { useWorkspaceMode } from "@/components/ex/workspace-mode-context";

type Props = {
  title: string;
  description: string;
};

export function AutonomyEmptyState({ title, description }: Props) {
  const { setMode } = useWorkspaceMode();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      style={{
        maxWidth: 440,
        margin: "64px auto 0",
        padding: "var(--sp-32) var(--sp-24)",
        textAlign: "center",
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        borderRadius: 12,
      }}
    >
      <h2
        style={{
          fontSize: "var(--fs-h3)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--text)",
          margin: "0 0 var(--sp-8)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: "var(--fs-ui)",
          lineHeight: 1.55,
          color: "var(--text-muted)",
          margin: "0 0 var(--sp-18)",
        }}
      >
        {description}
      </p>
      <button type="button" className="btn primary" onClick={() => setMode("x")}>
        Turn on Autonomy
      </button>
    </motion.div>
  );
}
