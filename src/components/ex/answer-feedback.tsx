"use client";

import { useState } from "react";
import { useT } from "@/components/ex/i18n-context";

/**
 * "Wrong or outdated?" under an Ask answer: one text field, one button.
 * Sends a pending knowledge proposal to the twin's owner; nothing changes
 * in the twin's files until they approve it.
 */
export function AnswerFeedback({
  twinId,
  twinName,
  question,
  answer,
  onSent,
}: {
  twinId: string;
  twinName: string;
  question: string;
  answer: string;
  onSent?: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p role="status" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
        {t("ask.fix.done", { name: twinName })}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ marginTop: 6, padding: 0, border: 0, background: "none", cursor: "pointer", fontSize: 12, color: "var(--text-muted)", textDecoration: "underline" }}
      >
        {t("ask.fix.open")}
      </button>
    );
  }

  async function send() {
    if (!text.trim()) {
      setError(t("ask.fix.empty"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/employees/${encodeURIComponent(twinId)}/knowledge/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, correction: text }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setDone(true);
      onSent?.();
    } catch {
      setError(t("ask.fix.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {t("ask.fix.label")}
        <textarea
          dir="auto"
          rows={2}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 13, fontFamily: "inherit", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 6, resize: "vertical" }}
        />
      </label>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <div>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void send()}>
          {busy ? t("ask.fix.sending") : t("ask.fix.send")}
        </button>
      </div>
    </div>
  );
}
