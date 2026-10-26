"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { useT } from "@/components/ex/i18n-context";
import type { MeetingPerson } from "@/lib/roomate-filing";

// "Send to Roomate" on a Team Meeting action item. The server claims the
// action and returns a prompt; this component then starts a normal twin run
// for the owner (/api/twin/chat, the path Ask uses), so the twin's Roomate
// skill, tool policy, approvals (create_tasks asks first, in the global
// approvals overlay), audit and read scope all apply. Run state lives at
// module level, so closing the history drawer doesn't lose a run in flight,
// and the drawer and the live summary card show the same state.

export type RoomateAction = { employeeId: string; action: string; due?: string; sentAt?: number; taskId?: string };

export type RoomateSummary = {
  decision: string;
  actions: RoomateAction[];
  open: string[];
  generatedAt: number;
  throughTurn: number;
};

type Live =
  | { status: "filing" }
  | { status: "done"; taskId: string | null; reply: string }
  | { status: "pick"; message: string; people: MeetingPerson[] }
  | { status: "error"; message: string };

const live = new Map<string, Live>();
const listeners = new Set<() => void>();

function setLive(key: string, next: Live | undefined) {
  if (next) live.set(key, next);
  else live.delete(key);
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

let availability: Promise<boolean> | null = null;

/** Whether an enabled Roomate MCP server exists; asked once per page load. */
function useRoomateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    availability ??= fetch("/api/council/roomate", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ available?: boolean }>) : { available: false }))
      .then((d) => d.available === true)
      .catch(() => {
        availability = null;
        return false;
      });
    void availability.then((v) => {
      if (!cancelled) setAvailable(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

type ApiError = { error?: string; message?: string; people?: MeetingPerson[]; summary?: RoomateSummary };

async function postPhase(meetingId: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: ApiError & Record<string, unknown> }> {
  try {
    const res = await fetch(`/api/council/meetings/${encodeURIComponent(meetingId)}/roomate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as ApiError & Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: {} };
  }
}

/** Read a /api/twin/chat SSE stream to the end: the reply text and any error.
 *  Approval requests are left alone: they wait in the approvals overlay. */
async function readTwinRun(res: Response): Promise<{ text: string; failure: string | null }> {
  let text = "";
  let failure: string | null = null;
  if (!res.body) return { text, failure };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const evt = JSON.parse(data) as { type?: string; delta?: string; message?: string };
        if (evt.type === "text_delta") text += evt.delta ?? "";
        else if (evt.type === "error") failure = evt.message?.trim() || failure;
      } catch {
        /* partial or non-JSON line */
      }
    }
  }
  return { text, failure };
}

async function fileAction(args: {
  key: string;
  meetingId: string;
  index: number;
  action: string;
  ownerId?: string;
  force?: boolean;
  onSummary?: (s: RoomateSummary) => void;
  errorText: string;
  runFailedText: (message: string) => string;
}) {
  const { key, meetingId, index, action, onSummary } = args;
  if (live.get(key)?.status === "filing") return;
  setLive(key, { status: "filing" });

  const start = await postPhase(meetingId, {
    phase: "start",
    index,
    action,
    ...(args.ownerId ? { ownerId: args.ownerId } : {}),
    ...(args.force ? { force: true } : {}),
  });
  if (!start.ok) {
    const d = start.data;
    if (d.summary) onSummary?.(d.summary);
    if (d.error === "pick_owner" || d.error === "retired" || d.error === "no_twin") {
      setLive(key, { status: "pick", message: d.message ?? args.errorText, people: d.people ?? [] });
    } else if (d.error === "already_sent") {
      // Sent from elsewhere meanwhile: show the stored state.
      setLive(key, undefined);
    } else {
      setLive(key, { status: "error", message: d.message ?? args.errorText });
    }
    return;
  }
  const { employeeId, prompt, summary } = start.data as { employeeId: string; prompt: string; summary: RoomateSummary };
  onSummary?.(summary);

  let res: Response | null = null;
  try {
    res = await fetch("/api/twin/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, question: prompt, history: [], followups: false }),
    });
  } catch {
    res = null;
  }
  if (!res?.ok) {
    // The run never started: undo the claim so it can be sent again freely.
    const msg = res ? (((await res.json().catch(() => ({}))) as { error?: string }).error ?? null) : null;
    const released = await postPhase(meetingId, { phase: "failed", index, action });
    if (released.data.summary) onSummary?.(released.data.summary);
    setLive(key, { status: "error", message: msg ? args.runFailedText(msg) : args.errorText });
    return;
  }

  const { text, failure } = await readTwinRun(res).catch(() => ({ text: "", failure: null as string | null }));
  const done = await postPhase(meetingId, { phase: "done", index, action, reply: text });
  if (done.data.summary) onSummary?.(done.data.summary);
  if (failure && !text.trim()) {
    setLive(key, { status: "error", message: args.runFailedText(failure) });
    return;
  }
  const taskId = typeof done.data.taskId === "string" ? done.data.taskId : null;
  setLive(key, { status: "done", taskId, reply: text });
}

const row = { display: "flex", alignItems: "center", flexWrap: "wrap" as const, gap: 6, marginTop: 4 };
const note = { fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: 1.45 };
const mono = { fontFamily: "var(--font-mono, ui-monospace, monospace)", fontWeight: 600 };

/** The "Send to Roomate" control for one action. Renders nothing when no
 *  enabled Roomate server is connected. */
export function SendToRoomate({
  meetingId,
  index,
  action,
  ownerName,
  ownerLeft,
  onSummary,
}: {
  meetingId: string;
  index: number;
  action: RoomateAction;
  ownerName: string;
  /** The owner's twin is retired: it can't file, someone else must. */
  ownerLeft: boolean;
  onSummary?: (s: RoomateSummary) => void;
}) {
  const { t, locale } = useT();
  const available = useRoomateAvailable();
  const key = `${meetingId}#${index}#${action.action}`;
  const state = useSyncExternalStore(subscribe, () => live.get(key), () => undefined);
  const [pick, setPick] = useState("");
  const [showReply, setShowReply] = useState(false);
  const selectId = useId();
  const replyId = useId();

  if (!available) return null;

  const send = (opts: { force?: boolean; ownerId?: string } = {}) =>
    void fileAction({
      key,
      meetingId,
      index,
      action: action.action,
      ...opts,
      onSummary,
      errorText: t("meeting.roomate.error"),
      runFailedText: (message) => t("meeting.roomate.runFailed", { message }),
    });

  const sendAgain = () => {
    if (!window.confirm(t("meeting.roomate.sendAgainConfirm"))) return;
    setLive(key, undefined);
    send({ force: true });
  };

  const when = (ts: number) =>
    new Date(ts).toLocaleString(locale === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const againButton = (
    <button type="button" className="btn sm ghost" onClick={sendAgain}>
      {t("meeting.roomate.sendAgain")}
    </button>
  );

  let body: ReactNode;
  if (state?.status === "filing") {
    body = (
      <>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--text)" }}>
          <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} style={{ display: "inline-flex" }} aria-hidden>
            <Icons.Loader size={11} />
          </motion.span>
          {t("meeting.roomate.filing")}
        </span>
        <span style={note}>{t("meeting.roomate.approveHint")}</span>
      </>
    );
  } else if (state?.status === "done") {
    body = state.taskId ? (
      <>
        <Filed id={state.taskId} label={t("meeting.roomate.filed", { id: state.taskId })} />
        {againButton}
      </>
    ) : (
      <>
        <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--text)" }}>{t("meeting.roomate.doneCheck")}</span>
        <button type="button" className="btn sm ghost" aria-expanded={showReply} aria-controls={replyId} onClick={() => setShowReply((v) => !v)}>
          {showReply ? t("meeting.roomate.hideReply") : t("meeting.roomate.showReply")}
        </button>
        {againButton}
      </>
    );
  } else if (state?.status === "pick") {
    body = (
      <>
        <span role="alert" style={{ ...note, color: "var(--text-muted)", flexBasis: "100%" }}>
          {state.message}
        </span>
        {state.people.length === 0 ? (
          <span style={note}>{t("meeting.roomate.noOne")}</span>
        ) : (
          <>
            <label htmlFor={selectId} style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              {t("meeting.roomate.pickOwner")}
            </label>
            <select
              id={selectId}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              style={{ font: "inherit", fontSize: "var(--fs-xs)", padding: "2px 6px", borderRadius: 6, border: "1px solid var(--hairline-strong)", background: "var(--surface)", color: "var(--text)" }}
            >
              <option value="">—</option>
              {state.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm" disabled={!pick} onClick={() => send({ ownerId: pick })} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icons.Send size={11} /> {t("meeting.roomate.send")}
            </button>
          </>
        )}
        <button type="button" className="btn sm ghost" onClick={() => setLive(key, undefined)}>
          {t("meeting.roomate.cancel")}
        </button>
      </>
    );
  } else if (state?.status === "error") {
    body = (
      <>
        <span role="alert" style={{ fontSize: "var(--fs-xs)", color: "var(--danger)" }}>{state.message}</span>
        <button type="button" className="btn sm" onClick={() => send({ force: true })}>
          {t("meeting.roomate.retry")}
        </button>
      </>
    );
  } else if (action.taskId) {
    body = (
      <>
        <Filed id={action.taskId} label={t("meeting.roomate.filed", { id: action.taskId })} />
        {againButton}
      </>
    );
  } else if (action.sentAt) {
    body = (
      <>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{t("meeting.roomate.sent", { when: when(action.sentAt) })}</span>
        {againButton}
      </>
    );
  } else {
    body = (
      <>
        <button
          type="button"
          className="btn sm"
          aria-label={t("meeting.roomate.sendLabel", { action: action.action })}
          onClick={() => send()}
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <Icons.Send size={11} /> {t("meeting.roomate.send")}
        </button>
        {ownerLeft && <span style={note}>{t("meeting.roomate.ownerLeft", { name: ownerName })}</span>}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div aria-live="polite" style={row}>
        {body}
      </div>
      {state?.status === "done" && !state.taskId && showReply && (
        <div
          id={replyId}
          dir="auto"
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--bg-sunken)", color: "var(--text)", fontSize: "var(--fs-xs)", lineHeight: 1.5 }}
        >
          <Markdown>{state.reply || "—"}</Markdown>
        </div>
      )}
    </div>
  );
}

function Filed({ id, label }: { id: string; label: string }) {
  const at = label.indexOf(id);
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: "color-mix(in oklab, var(--success) 14%, transparent)", color: "var(--success)", fontSize: "var(--fs-xs)", fontWeight: 650 }}
    >
      <Icons.Check size={11} />
      {at < 0 ? (
        <span>{label}</span>
      ) : (
        <span>
          {label.slice(0, at)}
          <span style={mono}>{id}</span>
          {label.slice(at + id.length)}
        </span>
      )}
    </span>
  );
}
