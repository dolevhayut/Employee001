"use client";

// ClarificationCard — renders an AskUserQuestion request as a stack of
// question cards with sanitised HTML option previews. CEO clicks a label,
// optionally adds notes, and submits — the card POSTs the answers map back
// to /api/council/approve so the paused agent can continue.

import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import type { ClarificationQuestion } from "@/lib/council-runner";

type ClarificationCardProps = {
  approvalId: string;
  questions: ClarificationQuestion[];
  onSubmit: (answers: Record<string, string>) => Promise<void>;
};

export function ClarificationCard({
  approvalId,
  questions,
  onSubmit,
}: ClarificationCardProps) {
  // Pick state — keyed by question text. Multi-select stores comma-joined labels.
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const allAnswered = useMemo(
    () => questions.every((q) => (picks[q.question]?.length ?? 0) > 0),
    [picks, questions]
  );

  function togglePick(question: ClarificationQuestion, label: string) {
    setPicks((prev) => {
      const current = prev[question.question] ?? [];
      if (question.multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [question.question]: next };
      }
      return { ...prev, [question.question]: [label] };
    });
  }

  async function handleSubmit() {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    try {
      const answers: Record<string, string> = {};
      for (const q of questions) {
        const labels = picks[q.question] ?? [];
        answers[q.question] = labels.join(", ");
      }
      await onSubmit(answers);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      style={{
        margin: "8px 0 12px 40px",
        padding: "var(--sp-14)",
        border: "1.5px solid var(--accent-deep)",
        borderRadius: 12,
        background: "var(--accent-soft)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-14)",
      }}
      data-approval-id={approvalId}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
          fontSize: "var(--fs-meta)",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--accent-deep)",
        }}
      >
        <span>🤔 Quick clarifications</span>
        <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
          {questions.length === 1 ? "1 question" : `${questions.length} questions`}
        </span>
      </div>

      {questions.map((q) => (
        <div key={q.question} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-8)" }}>
            <span
              style={{
                fontSize: "var(--fs-xs)",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 6,
                background: "var(--accent-deep)",
                color: "white",
                letterSpacing: "0.03em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              {q.header}
            </span>
            <span style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text)" }}>
              {q.question}
            </span>
            {q.multiSelect && (
              <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                (pick any)
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "var(--sp-8)",
            }}
          >
            {q.options.map((opt) => {
              const selected = (picks[q.question] ?? []).includes(opt.label);
              return (
                <OptionCard
                  key={opt.label}
                  label={opt.label}
                  description={opt.description}
                  preview={opt.preview}
                  selected={selected}
                  onClick={() => togglePick(q, opt.label)}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: "var(--sp-8)", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          style={{
            padding: "8px 16px",
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
            background: allAnswered ? "var(--accent-deep)" : "var(--hairline-strong)",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: allAnswered && !submitting ? "pointer" : "not-allowed",
            opacity: submitting ? 0.6 : 1,
            fontFamily: "inherit",
            transition: "background .2s, opacity .2s",
          }}
        >
          {submitting ? "Sending…" : "Continue"}
        </button>
      </div>
    </motion.div>
  );
}

function OptionCard({
  label,
  description,
  preview,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  preview?: string;
  selected: boolean;
  onClick: () => void;
}) {
  // Sanitise the HTML preview defensively — the model emits this string.
  const safePreview = useMemo(() => {
    if (!preview) return null;
    return DOMPurify.sanitize(preview, {
      // Block scripts, iframes, embed tags, on* event handlers.
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
    });
  }, [preview]);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-6)",
        padding: "var(--sp-10)",
        textAlign: "left",
        background: selected ? "var(--accent-deep)" : "var(--bg)",
        color: selected ? "white" : "var(--text)",
        border: `1.5px solid ${selected ? "var(--accent-deep)" : "var(--hairline)"}`,
        borderRadius: 10,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background .15s, border-color .15s, transform .15s",
        boxShadow: selected ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      <div style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}>{label}</div>
      {description && (
        <div
          style={{
            fontSize: "var(--fs-meta)",
            lineHeight: 1.4,
            color: selected ? "rgba(255,255,255,0.85)" : "var(--text-muted)",
          }}
        >
          {description}
        </div>
      )}
      {safePreview && (
        <div
          style={{
            marginTop: "var(--sp-4)",
            padding: "var(--sp-6)",
            borderRadius: 6,
            background: selected ? "rgba(255,255,255,0.12)" : "var(--bg-soft, rgba(0,0,0,0.03))",
            fontSize: "var(--fs-meta)",
            maxHeight: 160,
            overflow: "hidden",
            color: selected ? "white" : "var(--text)",
          }}
          dangerouslySetInnerHTML={{ __html: safePreview }}
        />
      )}
    </button>
  );
}
