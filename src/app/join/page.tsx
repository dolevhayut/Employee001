"use client";

import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// The employee lands here from a /join?invite=inv_... URL the CEO shared.
// We validate the invite once, surface a short welcome, and route forward
// to /onboarding?invite=... where the actual profile gets filled in.
//
// When the employee returns from /onboarding with ?done=1, this page flips
// into a three-mode "twin training" view:
//   A: build is running   -> live SSE progress
//   B: pending_toolkits   -> static "connect a tool" message
//   C: build completed    -> final summary

type InviteShape = {
  token: string;
  name?: string;
  role?: string;
  expiresAt: string;
  employeeId?: string;
};

type ValidateResponse =
  | { status: "redeemable"; invite: InviteShape }
  | { status: "used"; invite: InviteShape; message?: string }
  | { status: "already_redeemed"; invite: InviteShape; message?: string }
  | { status: "expired"; invite: InviteShape; message?: string }
  | { status: "not_found"; message?: string };

type BuildStatus = "training" | "pending_toolkits" | "completed";

type CompleteSnapshot = {
  employeeId?: string;
  buildId?: string;
  buildStatus?: BuildStatus;
  invite?: InviteShape;
};

// Fonts loaded at the root layout (src/app/layout.tsx).
const SANS_FONT =
  'var(--font-manrope), "Manrope", ui-sans-serif, system-ui, sans-serif';
const SERIF_FONT =
  'var(--font-instrument-serif), "Instrument Serif", ui-serif, Georgia, serif';

const BRAND_ORANGE = "#9E6B47";
const BG_DARK = "#0A0A0A";
const TEXT_LIGHT = "#F5F1EA";
const TEXT_MUTED = "#9A9490";
const PANEL_BG = "#141414";
const PANEL_BORDER = "#262626";

const TWIN_FILE_NAMES = [
  "CONTEXT.md",
  "EXPERTISE.md",
  "PROJECTS.md",
  "PEOPLE.md",
  "DECISIONS.md",
  "PREFERENCES.md",
  "TONE.md",
  "BOUNDARIES.md",
  "EMPLOYMENT.md",
] as const;
type TwinFileName = (typeof TWIN_FILE_NAMES)[number];

const SS_KEY_PREFIX = "e001_join_complete:";

function readSnapshot(token: string): CompleteSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY_PREFIX + token);
    if (!raw) return null;
    return JSON.parse(raw) as CompleteSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(token: string, snap: CompleteSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SS_KEY_PREFIX + token, JSON.stringify(snap));
  } catch {
    /* quota or disabled — non-fatal */
  }
}

// ---------- Live build progress (SSE) ----------

type BuilderEvent =
  | { type: "start"; activeLookbackDays?: number; activeToolkits?: string[] }
  | { type: "plan"; text?: string }
  | { type: "tool_use"; tool?: string; input?: unknown }
  | { type: "tool_result"; tool?: string }
  | { type: "text_delta"; delta?: string }
  | { type: "file_writing"; filename?: string }
  | { type: "file_done"; filename?: string }
  | { type: "error"; message?: string }
  | {
      type: "done";
      filesWritten?: string[];
      turns?: number;
      costUsd?: number;
      stoppedReason?: string;
    }
  | { type: string; [k: string]: unknown };

type ProgressState = {
  lookbackDays: number | null;
  currentActivity: string | null;
  filesWriting: Set<TwinFileName>;
  filesDone: Set<TwinFileName>;
  finished: null | {
    turns: number;
    costUsd: number;
    stoppedReason: string;
    filesWritten: string[];
  };
  errorMessage: string | null;
};

const initialProgress: ProgressState = {
  lookbackDays: null,
  currentActivity: null,
  filesWriting: new Set(),
  filesDone: new Set(),
  finished: null,
  errorMessage: null,
};

function progressReducer(s: ProgressState, ev: BuilderEvent): ProgressState {
  switch (ev.type) {
    case "start":
      return {
        ...s,
        lookbackDays:
          typeof (ev as { activeLookbackDays?: unknown }).activeLookbackDays === "number"
            ? ((ev as { activeLookbackDays: number }).activeLookbackDays)
            : s.lookbackDays,
        currentActivity: "Reading your connected tools…",
        errorMessage: null,
      };
    case "plan": {
      const text = (ev as { text?: string }).text;
      return { ...s, currentActivity: text?.slice(0, 160) ?? s.currentActivity };
    }
    case "tool_use": {
      const tool = (ev as { tool?: string }).tool;
      return { ...s, currentActivity: tool ? `Using ${tool}` : s.currentActivity };
    }
    case "tool_result": {
      const tool = (ev as { tool?: string }).tool;
      return { ...s, currentActivity: tool ? `Got results from ${tool}` : s.currentActivity };
    }
    case "text_delta": {
      const delta = (ev as { delta?: string }).delta;
      if (!delta) return s;
      return { ...s, currentActivity: `Thinking: ${delta.replace(/\s+/g, " ").slice(0, 140)}` };
    }
    case "file_writing": {
      const filename = (ev as { filename?: string }).filename as TwinFileName | undefined;
      if (!filename || !(TWIN_FILE_NAMES as readonly string[]).includes(filename)) return s;
      const next = new Set(s.filesWriting);
      next.add(filename);
      return { ...s, filesWriting: next, currentActivity: `Writing ${filename}` };
    }
    case "file_done": {
      const filename = (ev as { filename?: string }).filename as TwinFileName | undefined;
      if (!filename || !(TWIN_FILE_NAMES as readonly string[]).includes(filename)) return s;
      const nextWriting = new Set(s.filesWriting);
      nextWriting.delete(filename);
      const nextDone = new Set(s.filesDone);
      nextDone.add(filename);
      return { ...s, filesWriting: nextWriting, filesDone: nextDone };
    }
    case "error": {
      const message = (ev as { message?: string }).message ?? "Build failed.";
      return { ...s, errorMessage: message };
    }
    case "done": {
      const d = ev as {
        turns?: number;
        costUsd?: number;
        stoppedReason?: string;
        filesWritten?: string[];
      };
      return {
        ...s,
        currentActivity: null,
        finished: {
          turns: d.turns ?? 0,
          costUsd: d.costUsd ?? 0,
          stoppedReason: d.stoppedReason ?? "natural",
          filesWritten: d.filesWritten ?? [],
        },
      };
    }
    default:
      return s;
  }
}

function useBuildStream(
  employeeId: string | undefined,
  buildId: string | undefined,
  enabled: boolean,
): {
  progress: ProgressState;
  connectionLost: boolean;
  startedAt: number;
} {
  const [progress, dispatch] = useReducer(progressReducer, initialProgress);
  const [connectionLost, setConnectionLost] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const retryRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled || !employeeId) return;
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    setConnectionLost(false);

    function open() {
      const qs = buildId ? `?buildId=${encodeURIComponent(buildId)}` : "";
      const url = `/api/twin-builder/${encodeURIComponent(employeeId!)}/stream${qs}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (ev) => {
        if (!ev.data) return;
        try {
          const parsed = JSON.parse(ev.data) as BuilderEvent;
          dispatch(parsed);
          retryRef.current = 0;
        } catch {
          /* ignore malformed lines */
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelledRef.current) return;
        // EventSource will fire onerror on natural close (after `done`) too,
        // so only reconnect if we don't yet have a `finished` snapshot.
        retryRef.current += 1;
        if (retryRef.current > 2) {
          setConnectionLost(true);
          return;
        }
        const delay = 500 * Math.pow(2, retryRef.current);
        setTimeout(() => {
          if (!cancelledRef.current) open();
        }, delay);
      };
    }

    open();
    return () => {
      cancelledRef.current = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [employeeId, buildId, enabled]);

  // Stop reconnecting after we see `done`.
  useEffect(() => {
    if (progress.finished) {
      cancelledRef.current = true;
      esRef.current?.close();
      esRef.current = null;
    }
  }, [progress.finished]);

  return { progress, connectionLost, startedAt: startedAtRef.current };
}

// ---------- UI primitives ----------

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: 14,
        padding: "44px 36px",
        boxShadow: "0 24px 60px -28px rgba(0,0,0,0.6)",
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow() {
  return (
    <div
      style={{
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: TEXT_MUTED,
        marginBottom: 14,
      }}
    >
      Employee001
    </div>
  );
}

// ---------- Mode A: Training in progress ----------

function ModeTraining({
  employeeId,
  buildId,
  onFinished,
  onRetry,
}: {
  employeeId: string;
  buildId?: string;
  onFinished: (summary: ProgressState["finished"]) => void;
  onRetry: () => void;
}) {
  const { progress, connectionLost, startedAt } = useBuildStream(
    employeeId,
    buildId,
    true,
  );
  const [comeBackLater, setComeBackLater] = useState(false);

  useEffect(() => {
    if (progress.finished) onFinished(progress.finished);
  }, [progress.finished, onFinished]);

  const elapsedMs = Date.now() - startedAt;
  // Force a render every second while training so elapsed time ticks visibly.
  const [, tick] = useState(0);
  useEffect(() => {
    if (progress.finished) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [progress.finished]);

  return (
    <Card>
      <Eyebrow />
      <h1
        style={{
          fontFamily: SERIF_FONT,
          fontSize: 36,
          margin: "0 0 12px",
          lineHeight: 1.1,
        }}
      >
        Building your twin.
      </h1>
      <p
        style={{
          color: TEXT_MUTED,
          fontSize: 15,
          lineHeight: 1.55,
          marginBottom: 20,
        }}
      >
        An autonomous Claude agent is studying the lookback window your manager
        chose, through your connected tools (Slack, GitHub, Gmail, Linear,
        calendar). This usually takes a few minutes.
      </p>

      {progress.lookbackDays !== null && (
        <div
          style={{
            display: "inline-block",
            padding: "4px 10px",
            background: "rgba(158,107,71,0.12)",
            color: BRAND_ORANGE,
            border: `1px solid rgba(158,107,71,0.3)`,
            borderRadius: 999,
            fontSize: 12,
            letterSpacing: "0.02em",
            marginBottom: 18,
          }}
        >
          Lookback: {progress.lookbackDays} days
        </div>
      )}

      {progress.errorMessage ? (
        <div
          style={{
            marginTop: 8,
            padding: "14px 16px",
            border: "1px solid #5a2a2a",
            borderRadius: 10,
            background: "#1d0f0f",
            color: "#f1c2c2",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <div style={{ marginBottom: 10 }}>Build error: {progress.errorMessage}</div>
          <button
            type="button"
            onClick={onRetry}
            style={{
              background: BRAND_ORANGE,
              color: TEXT_LIGHT,
              border: "none",
              padding: "8px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Retry build
          </button>
        </div>
      ) : connectionLost ? (
        <div
          style={{
            marginTop: 8,
            padding: "14px 16px",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 10,
            color: TEXT_MUTED,
            fontSize: 14,
          }}
        >
          Connection lost — your training continues in the background. Ask your
          manager for status, or refresh this page.
        </div>
      ) : (
        <>
          <div
            style={{
              marginBottom: 16,
              color: TEXT_LIGHT,
              fontSize: 14,
              minHeight: 22,
            }}
          >
            {progress.currentActivity
              ? `Currently: ${progress.currentActivity}`
              : "Connecting to the builder…"}
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 18px",
              display: "grid",
              gap: 6,
            }}
          >
            {TWIN_FILE_NAMES.map((name) => {
              const done = progress.filesDone.has(name);
              const writing = progress.filesWriting.has(name);
              return (
                <li
                  key={name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    color: done ? TEXT_LIGHT : TEXT_MUTED,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      display: "inline-block",
                      textAlign: "center",
                      color: done ? BRAND_ORANGE : writing ? BRAND_ORANGE : "#404040",
                    }}
                  >
                    {done ? "✓" : writing ? "•" : "·"}
                  </span>
                  <span>{name}</span>
                  {writing && !done ? (
                    <span style={{ color: TEXT_MUTED, fontSize: 11 }}>writing…</span>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div style={{ color: TEXT_MUTED, fontSize: 12, marginBottom: 14 }}>
            Elapsed: {Math.floor(elapsedMs / 1000)}s · {progress.filesDone.size}/
            {TWIN_FILE_NAMES.length} files written
          </div>
        </>
      )}

      {!comeBackLater ? (
        <button
          type="button"
          onClick={() => setComeBackLater(true)}
          style={{
            background: "transparent",
            color: TEXT_MUTED,
            border: "none",
            padding: 0,
            fontSize: 13,
            cursor: "pointer",
            textDecoration: "underline",
            fontFamily: "inherit",
          }}
        >
          I&apos;ll come back later
        </button>
      ) : (
        <p style={{ color: TEXT_MUTED, fontSize: 13, margin: 0 }}>
          We&apos;ll keep working in the background. Close this tab any time.
        </p>
      )}
    </Card>
  );
}

// ---------- Mode B: Pending toolkits ----------

function ModePendingToolkits() {
  return (
    <Card>
      <Eyebrow />
      <h1
        style={{
          fontFamily: SERIF_FONT,
          fontSize: 36,
          margin: "0 0 12px",
          lineHeight: 1.1,
        }}
      >
        Connect a tool to start training.
      </h1>
      <p
        style={{
          color: TEXT_MUTED,
          fontSize: 15,
          lineHeight: 1.55,
          marginBottom: 14,
        }}
      >
        Your twin can&apos;t be trained until at least one work tool is
        connected (Slack, GitHub, Gmail, Linear, calendar, etc.).
      </p>
      <p
        style={{
          color: TEXT_MUTED,
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        Ask your manager to connect a tool from their workspace — once one is
        live, training resumes automatically in the background. You can close
        this tab.
      </p>
    </Card>
  );
}

// ---------- Mode C: Done ----------

function ModeDone({ summary }: { summary: ProgressState["finished"] }) {
  const turns = summary?.turns ?? 0;
  const cost = summary?.costUsd ?? 0;
  return (
    <Card>
      <Eyebrow />
      <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 18, color: BRAND_ORANGE }}>
        ✓
      </div>
      <h1
        style={{
          fontFamily: SERIF_FONT,
          fontSize: 36,
          margin: "0 0 12px",
          lineHeight: 1.1,
        }}
      >
        Your twin is live.
      </h1>
      <p
        style={{
          color: TEXT_MUTED,
          fontSize: 15,
          lineHeight: 1.55,
          marginBottom: 14,
        }}
      >
        Your manager can review the 9 profile files you produced and refine
        them. From there, your twin can answer questions in your voice and act
        on your behalf — always behind a human-approval gate.
      </p>
      {summary ? (
        <div
          style={{
            color: TEXT_MUTED,
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            marginBottom: 14,
          }}
        >
          ${cost.toFixed(4)} · {turns} turn{turns === 1 ? "" : "s"}
          {summary.stoppedReason ? ` · ${summary.stoppedReason}` : ""}
        </div>
      ) : null}
      <p style={{ color: TEXT_MUTED, fontSize: 13, lineHeight: 1.55, margin: 0 }}>
        You can revoke consent any time at <span style={{ fontFamily: "ui-monospace, monospace" }}>/profile</span>{" "}
        (your manager will share the link).
      </p>
    </Card>
  );
}

// ---------- Page ----------

type DoneViewState =
  | { kind: "resolving" }
  | { kind: "training"; employeeId: string; buildId?: string }
  | { kind: "pending_toolkits" }
  | { kind: "completed"; summary: ProgressState["finished"] }
  | { kind: "generic_done" };

function Page() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("invite") ?? "";
  const justFinished = params.get("done") === "1";

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "no_token" }
    | { kind: "error"; status: ValidateResponse["status"] }
    | { kind: "ready"; invite: InviteShape }
    | { kind: "done" }
  >(justFinished ? { kind: "done" } : { kind: "loading" });

  const [doneView, setDoneView] = useState<DoneViewState>({ kind: "resolving" });

  // Resolve which "done" sub-view to render.
  useEffect(() => {
    if (!justFinished || !token) return;
    let cancelled = false;

    async function resolve() {
      // 1) sessionStorage rehydrate (refresh-friendly).
      const cached = readSnapshot(token);
      if (cached?.buildStatus === "pending_toolkits") {
        setDoneView({ kind: "pending_toolkits" });
        return;
      }
      if (cached?.buildStatus === "training" && cached.employeeId) {
        setDoneView({
          kind: "training",
          employeeId: cached.employeeId,
          buildId: cached.buildId,
        });
        return;
      }

      // 2) Validate invite to discover employeeId.
      try {
        const r = await fetch(`/api/invites/${encodeURIComponent(token)}`);
        const data = (await r.json()) as ValidateResponse;
        if (cancelled) return;

        const invite =
          "invite" in data && data.invite ? (data.invite as InviteShape) : undefined;
        const employeeId = invite?.employeeId;

        if (!employeeId) {
          // Wave 2A response missing or invite never completed — show a
          // generic confirmation rather than a broken state.
          setDoneView({ kind: "generic_done" });
          return;
        }

        // 3) Probe active build sentinel.
        try {
          const a = await fetch(
            `/api/twin-builder/${encodeURIComponent(employeeId)}/active`,
          );
          if (cancelled) return;
          if (a.ok) {
            const body = (await a.json()) as {
              active: null | { buildId: string };
            };
            if (body.active?.buildId) {
              const snap: CompleteSnapshot = {
                employeeId,
                buildId: body.active.buildId,
                buildStatus: "training",
                invite,
              };
              writeSnapshot(token, snap);
              setDoneView({
                kind: "training",
                employeeId,
                buildId: body.active.buildId,
              });
              return;
            }
          }
        } catch {
          /* swallow — fall through */
        }

        // No active build. We don't have explicit buildStatus here without
        // Wave 2A, so default to a generic "you're set" confirmation.
        setDoneView({ kind: "generic_done" });
      } catch {
        if (!cancelled) setDoneView({ kind: "generic_done" });
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [justFinished, token]);

  // Pre-redemption invite validation (unchanged from previous behaviour).
  useEffect(() => {
    if (justFinished) return;
    if (!token) {
      setState({ kind: "no_token" });
      return;
    }
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data: ValidateResponse = await r.json();
        if (data.status === "redeemable") {
          setState({ kind: "ready", invite: data.invite });
        } else {
          setState({ kind: "error", status: data.status });
        }
      })
      .catch(() => setState({ kind: "error", status: "not_found" }));
  }, [token, justFinished]);

  function go() {
    router.push(`/onboarding?invite=${encodeURIComponent(token)}`);
  }

  const handleFinished = useCallback(
    (summary: ProgressState["finished"]) => {
      const cached = readSnapshot(token) ?? {};
      writeSnapshot(token, { ...cached, buildStatus: "completed" });
      setDoneView({ kind: "completed", summary });
    },
    [token],
  );

  const handleRetry = useCallback(async () => {
    if (doneView.kind !== "training") return;
    try {
      await fetch(`/api/twin-builder/${encodeURIComponent(doneView.employeeId)}`, {
        method: "POST",
      });
      // Re-probe for a new buildId.
      const a = await fetch(
        `/api/twin-builder/${encodeURIComponent(doneView.employeeId)}/active`,
      );
      if (a.ok) {
        const body = (await a.json()) as { active: null | { buildId: string } };
        if (body.active?.buildId) {
          setDoneView({
            kind: "training",
            employeeId: doneView.employeeId,
            buildId: body.active.buildId,
          });
          writeSnapshot(token, {
            employeeId: doneView.employeeId,
            buildId: body.active.buildId,
            buildStatus: "training",
          });
        }
      }
    } catch {
      /* swallow */
    }
  }, [doneView, token]);

  // ---- "done" branch dispatches to the new three-mode view ----
  if (state.kind === "done") {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: BG_DARK,
          color: TEXT_LIGHT,
          display: "grid",
          placeItems: "center",
          padding: "48px 24px",
          fontFamily: SANS_FONT,
        }}
      >
        <div style={{ maxWidth: 560, width: "100%" }}>
          {doneView.kind === "resolving" && (
            <Card>
              <Eyebrow />
              <div style={{ color: TEXT_MUTED, fontSize: 14 }}>
                Checking on your twin…
              </div>
            </Card>
          )}
          {doneView.kind === "training" && (
            <ModeTraining
              employeeId={doneView.employeeId}
              buildId={doneView.buildId}
              onFinished={handleFinished}
              onRetry={handleRetry}
            />
          )}
          {doneView.kind === "pending_toolkits" && <ModePendingToolkits />}
          {doneView.kind === "completed" && <ModeDone summary={doneView.summary} />}
          {doneView.kind === "generic_done" && (
            <Card>
              <Eyebrow />
              <div
                style={{
                  fontSize: 36,
                  lineHeight: 1,
                  marginBottom: 18,
                  color: BRAND_ORANGE,
                }}
              >
                ✓
              </div>
              <h1
                style={{
                  fontFamily: SERIF_FONT,
                  fontSize: 36,
                  margin: "0 0 12px",
                  lineHeight: 1.1,
                }}
              >
                You&apos;re all set.
              </h1>
              <p
                style={{
                  color: TEXT_MUTED,
                  fontSize: 15,
                  lineHeight: 1.55,
                }}
              >
                Your twin profile has been saved. Your manager will take it from
                here — once a work tool is connected, your twin starts training.
                You can close this tab.
              </p>
            </Card>
          )}
        </div>
      </main>
    );
  }

  // ---- Pre-redemption views (kept on the existing light brand surface so
  // the "you're invited" handoff stays consistent with the email-style
  // welcome card the employee originally saw). ----
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F5F1EA",
        color: "#1A1816",
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        fontFamily: SANS_FONT,
      }}
    >
      <div style={{ maxWidth: 520, width: "100%" }}>
        <div
          className="card"
          style={{
            background: "#FFFFFF",
            border: "1px solid #E5DDD0",
            borderRadius: 14,
            padding: "44px 36px",
            boxShadow: "0 8px 24px -16px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8F8678",
              marginBottom: 14,
            }}
          >
            Employee001
          </div>

          {state.kind === "loading" && (
            <div style={{ color: "#6B6359", fontSize: 14 }}>
              Checking your invite…
            </div>
          )}

          {state.kind === "no_token" && (
            <>
              <h1 style={{ fontFamily: SERIF_FONT, fontSize: 32, margin: "0 0 12px" }}>
                Invite link required.
              </h1>
              <p style={{ color: "#6B6359", fontSize: 15, lineHeight: 1.55 }}>
                This page expects an invitation token. Ask your CEO for the
                /join link they generated.
              </p>
            </>
          )}

          {state.kind === "error" && (
            <>
              <h1 style={{ fontFamily: SERIF_FONT, fontSize: 32, margin: "0 0 12px" }}>
                {state.status === "used" || state.status === "already_redeemed"
                  ? "This invite was already redeemed."
                  : state.status === "expired"
                    ? "This invite expired."
                    : "Invite not found."}
              </h1>
              <p style={{ color: "#6B6359", fontSize: 15, lineHeight: 1.55 }}>
                Ask your CEO to send a fresh link.
              </p>
            </>
          )}

          {state.kind === "ready" && (
            <>
              <h1 style={{ fontFamily: SERIF_FONT, fontSize: 36, margin: "0 0 12px", lineHeight: 1.1 }}>
                Welcome{state.invite.name ? `, ${state.invite.name}` : ""}.
              </h1>
              <p
                style={{
                  color: "#6B6359",
                  fontSize: 15,
                  lineHeight: 1.55,
                  marginBottom: 28,
                }}
              >
                You&apos;ve been invited to set up your AI twin
                {state.invite.role ? ` as ${state.invite.role}` : ""}.
                It&apos;ll run on your team&apos;s machine and answer questions
                in your voice, drawing only from what you tell it.
              </p>
              <button
                type="button"
                onClick={go}
                style={{
                  background: "#1A1816",
                  color: "#F5F1EA",
                  border: "none",
                  padding: "12px 22px",
                  borderRadius: 999,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                Set up my twin →
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
