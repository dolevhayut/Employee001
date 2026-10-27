"use client";

import { useEffect, useId, useState } from "react";
import { Markdown } from "@/components/ex/markdown";

// Meeting memory on the Team Meeting page. Before the first message it
// previews the "Since the last meeting" brief the room will start from (what
// earlier meetings decided, open actions, routine results since), with
// "Start fresh" to skip it and "Don't remember" to keep this meeting out of
// later briefs. Once the meeting has started, the brief is frozen server-side
// and only "Don't remember" can still change.

type Preview = { text: string; meetings: number; routines: number };

export function MeetingMemoryCard({
  meetingId,
  started,
  participantIds,
  frozenBrief,
  fresh,
  onFresh,
  forget,
  onForget,
}: {
  meetingId: string | null;
  started: boolean;
  participantIds: string[];
  /** The brief a stored meeting started from, when it was reopened. */
  frozenBrief?: string | null;
  fresh: boolean;
  onFresh: (v: boolean) => void;
  forget: boolean;
  onForget: (v: boolean) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();
  const roomKey = participantIds.join(",");

  useEffect(() => {
    if (started) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch("/api/council/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeIds: roomKey ? roomKey.split(",") : [] }),
      })
        .then((res) => (res.ok ? (res.json() as Promise<{ brief: Preview | null }>) : { brief: null }))
        .then((d) => {
          if (!cancelled) setPreview(d.brief);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [roomKey, started]);

  async function toggleForget(next: boolean) {
    if (!started || !meetingId) {
      onForget(next);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/council/meetings/${encodeURIComponent(meetingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forget: next }),
      });
      if (res.ok) onForget(next);
      else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't save. Try again.");
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // Once started, only the copy the server froze for the twins: a meeting
  // without one (started fresh, or from before meeting memory) shows none.
  const text = started ? frozenBrief ?? null : preview?.text ?? null;
  const showBrief = Boolean(text) && !(fresh && !started);
  const sources = !started && preview
    ? [preview.meetings && `${preview.meetings} earlier meeting${preview.meetings === 1 ? "" : "s"}`, preview.routines && `${preview.routines} routine result${preview.routines === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" and ")
    : "";
  // Nothing to show once started without a brief, unless the toggle matters.
  if (started && !text && !meetingId) return null;

  return (
    <div
      style={{
        margin: "0 24px var(--sp-8)",
        border: "1px solid var(--hairline)",
        borderRadius: 12,
        background: "var(--surface)",
        fontSize: "var(--text-sm)",
        color: "var(--text-muted)",
      }}
    >
      {text && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          disabled={fresh && !started}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "baseline",
            gap: 8,
            padding: "10px 14px",
            background: "none",
            border: 0,
            cursor: fresh && !started ? "default" : "pointer",
            color: "inherit",
            textAlign: "start",
            opacity: fresh && !started ? 0.5 : 1,
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Since the last meeting</span>
          <span style={{ color: "var(--text-subtle)" }}>
            {started
              ? "What this meeting started from"
              : fresh
                ? "Skipped: this meeting starts fresh"
                : `From ${sources}. Every twin in the room gets this.`}
          </span>
          <span aria-hidden style={{ marginInlineStart: "auto", color: "var(--text-subtle)" }}>{open ? "Hide" : "Show"}</span>
        </button>
      )}
      {showBrief && open && (
        <div id={bodyId} style={{ padding: "0 14px 10px", borderTop: "1px solid var(--hairline)", maxHeight: 280, overflowY: "auto" }}>
          <Markdown>{text!}</Markdown>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          padding: "8px 14px",
          borderTop: text ? "1px solid var(--hairline)" : undefined,
        }}
      >
        {!started && text && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={fresh} onChange={(e) => onFresh(e.target.checked)} />
            Start fresh
          </label>
        )}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: saving ? "wait" : "pointer" }}>
          {/* While the first round runs the meeting has no id yet: the choice
              already went with the request, so it can't change until then. */}
          <input type="checkbox" checked={forget} disabled={saving || (started && !meetingId)} onChange={(e) => void toggleForget(e.target.checked)} />
          Don&apos;t remember this meeting
          <span style={{ color: "var(--text-subtle)" }}>(later meetings won&apos;t see it)</span>
        </label>
        {error && (
          <span role="alert" style={{ color: "var(--danger, var(--text))" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
