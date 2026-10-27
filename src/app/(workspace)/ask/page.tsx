"use client";

// Ask — one question at a time to a twin. The stage (70%) turns the input into
// a thinking orb that unfolds into the answer; the side panel (30%) keeps the
// whole conversation and shows, live, how the twin got there: what it recalled
// from the company brain, which tools it ran, what was blocked, and its
// reasoning when the model streams it. Read-only by design: a tool call that
// would need approval is declined, so the orb never waits on a hidden card.

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { displayRole } from "@/lib/employees";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { useRoster } from "@/components/ex/roster-context";
import { useT } from "@/components/ex/i18n-context";
import MorphOrb, { type MorphOrbHandle } from "@/components/ex/morph-orb/morph-orb";
import { useVoiceInput, type VoiceInputError } from "@/components/ex/voice/use-voice-input";
import { MicButton } from "@/components/ex/voice/mic-button";
import { LiveSpeaker, playbackContext } from "@/components/ex/voice/live-speaker";
import { playAck, prepareAcks, type PlayingAck } from "@/components/ex/voice/voice-ack";
import { playDemoClip, type DemoClip } from "@/components/ex/voice/demo-clip";
import { normalizeDemoQuestion } from "@/lib/demo-ask-recording";
import { VOICE_ANSWER_STYLE, ackPhrase, voiceLaneInContext } from "@/lib/voice-lane";
import { heardSpeech, looksLikeEcho, speakable, takeSentences, twinWordsInTheRoom } from "@/lib/speech-text";
import { bcp47 } from "@/lib/i18n/format";
import { describeToolCall, words } from "@/components/ex/morph-orb/tool-nodes";
import { FlowCanvas } from "@/components/ex/morph-orb/flow-canvas";
import { CitedAnswer, type CitedSource } from "@/components/ex/cited-answer";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { parseCitedAnswer } from "@/lib/org-answer";

const FOCUS_RING = "2px solid var(--accent)";
const focusRingHandlers = {
  onFocus: (e: FocusEvent<HTMLElement>) => {
    e.currentTarget.style.outline = FOCUS_RING;
    e.currentTarget.style.outlineOffset = "2px";
  },
  onBlur: (e: FocusEvent<HTMLElement>) => {
    e.currentTarget.style.outline = "none";
  },
};

const ANSWER_STYLE =
  "Answer in the language of the question, in at most three short sentences and " +
  "under 70 words, as plain text (no markdown, no lists). Be concrete: name the people, " +
  "projects or numbers involved. After each fact, cite where it came from as [[source]] with " +
  "no spaces, before the period: [[profile]] for your own profile, [[brain]] for the company " +
  "brain, [[web]] for the web, or a connected system's name in lowercase, e.g. [[companysim]]. " +
  "Several sources: [[companysim,profile]].";

/** Collapse spaces inside citation markers so each one stays a single word. */
const tidyCites = (s: string) => s.replace(/\[\[([^\]]+)\]\]/g, (_, ids: string) => `[[${ids.replace(/\s+/g, "")}]]`);
/** The answer without citation markers (for speech). */
const stripCites = (s: string) => s.replace(/\s*\[\[[^\]]*\]\]/g, "");

type Source = CitedSource & { kind: StepKind; logo?: string };

/** The sources a turn can cite, from the steps it actually took. */
function sourcesOf(steps: { kind: StepKind; label: string; detail?: string; logo?: string }[]): Source[] {
  const out = new Map<string, Source>();
  const add = (id: string, src: Omit<Source, "id" | "snippet">, detail?: string) => {
    const prev = out.get(id);
    const items = new Set((prev?.snippet ?? "").split(" · ").filter(Boolean));
    if (detail) items.add(detail);
    out.set(id, { id, ...src, snippet: [...items].join(" · ") });
  };
  // The profile is always in the twin's context, even when nothing lit up.
  add("profile", { name: "Profile", title: "Own profile", initials: "P", color: "var(--accent-soft)", kind: "read" });
  for (const st of steps) {
    if (st.kind === "read" && st.label.startsWith("Recalled from handover notes")) add("handover", { name: "Handover notes", title: "Reviewed when they left", initials: "H", color: "var(--accent-soft)", kind: "read" }, st.detail);
    else if (st.kind === "read" && st.label.startsWith("Recalled from profile")) add("profile", { name: "Profile", title: "Own profile", initials: "P", color: "var(--accent-soft)", kind: "read" }, st.detail);
    else if (st.kind === "brain") add("brain", { name: "Company brain", title: "Documents", initials: "B", color: "var(--accent-soft)", kind: "brain" }, st.detail);
    else if (st.kind === "web") add("web", { name: "Web", title: "Searched the web", initials: "W", color: "var(--accent-soft)", kind: "web" }, st.detail);
    else if (st.logo) add(st.logo, { name: st.label, title: "Connected system", initials: st.label.charAt(0), color: "var(--accent-soft)", kind: "tool", logo: st.logo }, st.detail);
  }
  return [...out.values()];
}

/** A source chip inside the orb's answer card. */
function CiteChip({ src }: { src: Source[] }) {
  if (src.length === 0) return null;
  const first = src[0];
  return (
    <span
      title={src.map((s) => `${s.name}${s.snippet ? `: ${s.snippet}` : ""}`).join("\n")}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 19, padding: "0 7px 0 4px", marginInlineStart: 2, verticalAlign: "middle", transform: "translateY(-1px)", borderRadius: 999, background: "var(--bg-sunken)", border: "1px solid var(--hairline)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}
    >
      <span style={{ display: "inline-flex", color: "var(--accent-deep)" }}>
        {first.logo ? <ToolkitIcon slug={first.logo} size={12} /> : first.kind === "brain" ? <Icons.Database size={11} /> : first.kind === "web" ? <Icons.Eye size={11} /> : <Icons.Doc size={11} />}
      </span>
      {first.name}
      {src.length > 1 && <span style={{ opacity: 0.6 }}>+{src.length - 1}</span>}
    </span>
  );
}

type StepKind = "read" | "search" | "tool" | "web" | "brain" | "skill" | "delegate" | "blocked";
type Step = { id: number; kind: StepKind; label: string; detail?: string; logo?: string; done: boolean };

type Turn = {
  id: number;
  twinId: string;
  twinName: string;
  initials: string;
  color: string;
  voiceId?: string;
  question: string;
  /** Asked by voice: the answer is spoken back, like a conversation. */
  viaVoice?: boolean;
  steps: Step[];
  thinking: string;
  answer: string | null;
  /** Set when the CEO handed this as a task instead of asking. */
  task?: {
    itemId?: string;
    status: "queued" | "leased" | "done" | "failed" | "skipped";
    result?: string;
    /** The run behind it, followed live through its log. */
    runId?: string;
    logOffset?: number;
    /** Documents the twin wrote while working. */
    docs?: { name: string; content: string }[];
  };
};

/** A step as saved in the twin's history (ids and live state aren't kept). */
type SavedStep = { kind: StepKind; label: string; detail?: string; logo?: string };
type SavedMessage = { role: "user" | "twin"; text: string; ts?: number; conversationId?: string; steps?: SavedStep[]; viaVoice?: boolean };

/** When "New conversation" was clicked for a twin, so a reload doesn't bring the old one back. */
const freshKey = (twinId: string) => `e001.ask.fresh.${twinId}`;
function markFresh(twinId: string) {
  try {
    localStorage.setItem(freshKey(twinId), String(Date.now()));
  } catch {
    // not remembered across a reload; the view still starts fresh
  }
}
function freshSince(twinId: string): number {
  try {
    return Number(localStorage.getItem(freshKey(twinId))) || 0;
  } catch {
    return 0;
  }
}

const newConversationId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`;

/** Save a question and its answer to the twin's history, in one request so they stay in order. */
function saveExchange(twinId: string, messages: (SavedMessage & { id: string })[]) {
  const ts = Date.now();
  void fetch(`/api/employees/${encodeURIComponent(twinId)}/chat-history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: messages.map((m) => ({ ...m, surface: "ask", ts })) }),
  }).catch(() => {
    // History is a convenience: the answer is already on screen.
  });
}

type TraceEvent = {
  type?: string;
  delta?: string;
  name?: string;
  args?: Record<string, unknown>;
  nodes?: { label: string }[];
  skills?: { label: string }[];
  tool?: string;
  reason?: string;
  approvalId?: string;
  message?: string;
};

/** A failure the server explained (a bad key, Claude Code signed out, a
 *  demo question with no recording): shown as is, not as "no answer". */
class TwinError extends Error {}

async function serverError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    const text = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";
    return text.trim() || null;
  } catch {
    return null;
  }
}

function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^\d+\.\s/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function askTwin(
  employeeId: string,
  question: string,
  history: { role: "user" | "assistant"; text: string }[],
  on: {
    step: (s: Omit<Step, "id" | "done">) => void;
    stepDone: () => void;
    thinking: (d: string) => void;
    /** The answer's text as it streams (spoken sentence by sentence in live voice). */
    text?: (d: string) => void;
  },
  signal?: AbortSignal,
  /** Asked by voice: the server's voice fast lane and a spoken-answer style. */
  voice = false,
  /** Temporary ask: the server writes no memory and keeps no run text. */
  temporary = false,
): Promise<string> {
  const res = await fetch("/api/twin/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    // Name the language outright: a twin whose memory is in Hebrew otherwise
    // drifts into Hebrew for an English question.
    body: JSON.stringify({
      employeeId,
      history,
      question: `${question}\n\n(${voice ? VOICE_ANSWER_STYLE : ANSWER_STYLE} Reply in ${/[\u0590-\u05FF]/.test(question) ? "Hebrew" : "English"}.)`,
      voice,
      ...(temporary ? { temporary: true } : {}),
      // Ask doesn't show follow-up chips: don't wait on a model call for them.
      followups: false,
    }),
  });
  if (!res.ok || !res.body) {
    const explained = res.ok ? null : await serverError(res);
    throw explained ? new TwinError(explained) : new Error(`chat failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let failure: string | null = null;
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
      let evt: TraceEvent;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      switch (evt.type) {
        case "text_delta":
          text += evt.delta ?? "";
          if (evt.delta) on.text?.(evt.delta);
          break;
        case "error":
          failure = evt.message?.trim() || failure;
          break;
        case "thinking_delta":
          on.thinking(evt.delta ?? "");
          break;
        case "tool_call":
          if (evt.name) on.step(describeToolCall(evt.name, evt.args));
          break;
        case "tool_result":
          on.stepDone();
          break;
        case "brain_recall":
          if (evt.nodes?.length) {
            on.step({ kind: "brain", label: "Recalled from the company brain", detail: evt.nodes.slice(0, 3).map((n) => n.label).join(", ") });
          }
          break;
        case "skill_recall":
          if (evt.skills?.length) {
            on.step({ kind: "skill", label: "Applied a playbook", detail: evt.skills.map((s) => s.label).join(", ") });
          }
          break;
        case "tool_blocked":
          on.step({ kind: "blocked", label: "Blocked by policy", detail: words(evt.tool ?? "").replace(/^mcp /, "") });
          break;
        case "tool_approval_request":
          on.step({ kind: "blocked", label: "Needed approval, declined in Ask mode", detail: words(evt.name ?? evt.tool ?? "") });
          if (evt.approvalId) {
            void fetch("/api/council/approve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                approvalId: evt.approvalId,
                action: "deny",
                message: "Ask mode is read-only. Answer from what you can read.",
              }),
            });
          }
          break;
      }
    }
  }
  if (failure && !text.trim()) throw new TwinError(failure);
  return plain(text);
}

const STEP_ICON: Record<StepKind, (p: { size?: number }) => ReactNode> = {
  read: (p) => <Icons.Doc {...p} />,
  search: (p) => <Icons.Search {...p} />,
  tool: (p) => <Icons.Plug {...p} />,
  web: (p) => <Icons.Eye {...p} />,
  brain: (p) => <Icons.Flow {...p} />,
  skill: (p) => <Icons.Spark {...p} />,
  delegate: (p) => <Icons.Team {...p} />,
  blocked: (p) => <Icons.Lock {...p} />,
};

function Avatar({ initials, color, size = 26 }: { initials: string; color: string; size?: number }) {
  return (
    <span
      style={{
        flex: "none",
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.38,
        fontWeight: 600,
        color: "#fff",
        background: color,
      }}
    >
      {initials}
    </span>
  );
}

type AudioState = { id: number; status: "loading" | "playing" } | null;

/** Speaker button: plays an answer in the twin's voice (ElevenLabs). */
function SpeakButton({ state, onClick, label, size = 26 }: { state: "idle" | "loading" | "playing"; onClick: () => void; label: string; size?: number }) {
  const icon = size * 0.5;
  return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        {...focusRingHandlers}
        style={{
        width: size,
        height: size,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        border: `1px solid ${state === "idle" ? "var(--hairline)" : "var(--accent)"}`,
        background: state === "playing" ? "color-mix(in oklab, var(--accent) 16%, var(--surface))" : "var(--surface)",
        color: state === "idle" ? "var(--text-muted)" : "var(--accent)",
        cursor: "pointer",
        boxShadow: state === "playing" ? "0 0 0 4px color-mix(in oklab, var(--accent) 14%, transparent)" : "none",
        transition: "all 0.2s",
      }}
    >
      {state === "loading" ? <Icons.Loader size={icon} /> : state === "playing" ? <Icons.VolumeOff size={icon} /> : <Icons.Volume size={icon} />}
    </button>
  );
}

function Trace({ turn, live }: { turn: Turn; live: boolean }) {
  const { t } = useT();
  // Open while the twin works; once the answer is in, the steps fold away
  // behind their count (click to open) so the answer stays in front.
  const [open, setOpen] = useState(false);
  const visible = live || open;
  if (!turn.steps.length && !turn.thinking) return null;
  return (
    <div
      style={{
        borderInlineStart: "2px solid var(--hairline)",
        paddingInlineStart: 12,
        marginInlineStart: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={live}
        aria-expanded={visible}
        aria-label={live ? t("ask.trace.working") : t("ask.trace.steps", { count: turn.steps.length })}
        {...focusRingHandlers}
        style={{
          alignSelf: "flex-start",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 0,
          border: 0,
          background: "transparent",
          color: "var(--text-subtle)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: live ? "default" : "pointer",
        }}
      >
        {live ? <Icons.Loader size={11} /> : <Icons.Check size={11} />}
        {live ? t("ask.trace.working") : t("ask.trace.steps", { count: turn.steps.length })}
        {!live && (
          <span aria-hidden style={{ display: "inline-flex", transition: "transform 160ms ease", transform: `rotate(${open ? 90 : 0}deg)` }}>
            <Icons.Chevron size={11} />
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {visible &&
          turn.steps.map((step) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                fontSize: 12.5,
                lineHeight: 1.45,
                color: step.kind === "blocked" ? "var(--danger)" : "var(--text-muted)",
              }}
            >
              <span style={{ flex: "none", position: "relative", top: 2, color: step.kind === "blocked" ? "var(--danger)" : "var(--accent)" }}>
                {STEP_ICON[step.kind]({ size: 12 })}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ color: step.kind === "blocked" ? "var(--danger)" : "var(--text)" }}>{step.label}</span>
                {step.detail ? (
                  <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11.5, color: "var(--text-subtle)" }}>
                    {" "}
                    {step.detail.length > 60 ? `${step.detail.slice(0, 60)}…` : step.detail}
                  </span>
                ) : null}
              </span>
            </motion.div>
          ))}
      </AnimatePresence>
      {visible && turn.thinking && (
        <div
          style={{
            marginTop: 2,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-sunken)",
            fontSize: 12,
            lineHeight: 1.55,
            fontStyle: "italic",
            color: "var(--text-muted)",
            maxHeight: 140,
            overflowY: "auto",
          }}
        >
          {live && turn.thinking.length > 420 ? `…${turn.thinking.slice(-420)}` : turn.thinking}
        </div>
      )}
    </div>
  );
}

const noopSubscribe = () => () => {};

// Conversation panel width (px), dragged by the CEO and remembered.
const PANEL_KEY = "ask.panelWidth";
const PANEL_DEFAULT = 400;
const PANEL_MIN = 320;
const panelListeners = new Set<() => void>();
function panelSubscribe(cb: () => void) {
  panelListeners.add(cb);
  return () => panelListeners.delete(cb);
}
function panelSnapshot(): number {
  try {
    const n = Number(localStorage.getItem(PANEL_KEY));
    if (Number.isFinite(n) && n >= PANEL_MIN) return n;
  } catch {
    // ignore
  }
  return PANEL_DEFAULT;
}
function writePanelWidth(px: number) {
  try {
    localStorage.setItem(PANEL_KEY, String(Math.round(px)));
  } catch {
    // ignore
  }
  for (const cb of panelListeners) cb();
}
// Reading answers aloud is opt-in: off until the person turns it on, then
// remembered. A question asked by voice is still answered by voice.
const VOICE_KEY = "e001.ask.voiceOn";
const voiceListeners = new Set<() => void>();
function voiceSubscribe(cb: () => void) {
  voiceListeners.add(cb);
  return () => voiceListeners.delete(cb);
}
function voiceSnapshot(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeVoiceOn(on: boolean) {
  try {
    localStorage.setItem(VOICE_KEY, on ? "1" : "0");
  } catch {
    // ignore: the choice just won't be remembered
  }
  for (const cb of voiceListeners) cb();
}
/** Live voice stops listening after this long with nothing said or playing. */
const LIVE_IDLE_MS = 30_000;
/** A spoken question is acknowledged this soon after it's sent, unless the
 *  answer has already started (it can't arrive sooner: the SDK alone takes
 *  ~0.7s to start). */
const ACK_AFTER_MS = 300;
/** How long a voice notice stays over the stage. */
const HINT_MS = 4_500;
const linkedTwin = () => new URLSearchParams(window.location.search).get("twin");

/** A question the zero-key demo has a recorded answer (and voice) for. */
type DemoAsk = { id: string; employeeId: string; question: string; audio: boolean };
type DemoStatus = { demo: boolean; live?: boolean; ask?: DemoAsk[] };

export default function AskPage() {
  const { t, locale } = useT();
  const roster = useRoster();
  const twins = roster.filter((e) => e.twinStatus === "ready");
  const [selected, setSelected] = useState<string | null>(null);
  const [modePick, setMode] = useState<"ask" | "task">("ask");
  const askModeTabRef = useRef<HTMLButtonElement>(null);
  const taskModeTabRef = useRef<HTMLButtonElement>(null);
  const panelWidth = useSyncExternalStore(panelSubscribe, panelSnapshot, () => PANEL_DEFAULT);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const rtl = document.documentElement.dir === "rtl";
      // The panel hugs the inline-end edge: its width is the distance from the pointer to it.
      const px = rtl ? e.clientX - 8 : window.innerWidth - e.clientX - 8;
      writePanelWidth(Math.max(PANEL_MIN, Math.min(window.innerWidth * 0.6, px)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);
  const [busy, setBusy] = useState(false);
  const voiceOn = useSyncExternalStore(voiceSubscribe, voiceSnapshot, () => false);
  const [voiceReady, setVoiceReady] = useState(false);
  // Voice off on this install (EMPLOYEE001_VOICE=off or EU mode): no browser
  // speech recognition either.
  const [voiceAllowed, setVoiceAllowed] = useState(false);
  // Live voice (Scribe v2 Realtime in, Eleven v4 Turbo out): off in EU mode.
  const [voiceLive, setVoiceLive] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  // `employee001 demo` without --live: recorded answers only, and their
  // pre-rendered voice instead of ElevenLabs.
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const demoReplay = Boolean(demo?.demo && !demo.live);
  const demoAsks = demoReplay ? demo?.ask ?? [] : [];
  const demoVoice = demoAsks.some((a) => a.audio);
  const demoClipFor = (employeeId: string, question: string) => {
    const asked = normalizeDemoQuestion(question);
    const hit = demoAsks.find((a) => a.audio && a.employeeId === employeeId && normalizeDemoQuestion(a.question) === asked);
    return hit ? `/api/demo/audio/${encodeURIComponent(hit.id)}` : null;
  };
  // A suggested question for another twin waits for that twin to be picked.
  const pendingAskRef = useRef<DemoAsk | null>(null);
  const clipRef = useRef<DemoClip | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnSeq = useRef(0);
  const stepSeq = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [audio, setAudio] = useState<AudioState>(null);
  // A short notice over the stage; `settings` links it to where keys are set.
  const [voiceHint, setVoiceHint] = useState<{ text: string; settings: boolean; mic: boolean } | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);
  const flashHint = (text: string, { settings = false, mic = false } = {}) => {
    setVoiceHint({ text, settings, mic });
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setVoiceHint(null), HINT_MS);
  };
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);
  const orbRef = useRef<MorphOrbHandle | null>(null);
  // Set while a spoken question is handed to the orb, read by onSubmit.
  const viaVoiceRef = useRef(false);
  // A question said (live) while the last answer was still being written.
  const queuedVoiceRef = useRef<string | null>(null);
  // The turn whose answer the orb last showed.
  const answeredTurnRef = useRef<number | null>(null);

  // ?twin=<id> preselects a twin (the Company brain links here when a twin is clicked).
  const linked = useSyncExternalStore(noopSubscribe, linkedTwin, () => null);
  const twinId = selected ?? (linked && twins.some((e) => e.id === linked) ? linked : null) ?? twins[0]?.id ?? null;
  // The flow stays on the stage until the CEO starts a new question.
  const flowTurn = busy ? turns[turns.length - 1] : undefined;
  const twin = twins.find((e) => e.id === twinId);
  // Someone who has left takes no tasks (the work queue refuses them): ask only.
  const retired = twin?.lifecycle === "retired";
  const mode = retired || demoReplay ? "ask" : modePick;

  function onAskModeTabKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (retired || demoReplay) return;
    const tabs: { mode: "ask" | "task"; ref: typeof askModeTabRef }[] = [
      { mode: "ask", ref: askModeTabRef },
      { mode: "task", ref: taskModeTabRef },
    ];
    const i = tabs.findIndex((tab) => tab.mode === modePick);
    if (i < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      setMode(next.mode);
      next.ref.current?.focus();
    }
  }

  // Your last conversation with each twin comes back when you pick it; each
  // person sees only what they asked. "New conversation" starts a fresh one.
  const conversationRef = useRef<Record<string, string>>({});
  const loadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!twin || loadedRef.current.has(twin.id)) return;
    let alive = true;
    fetch(`/api/employees/${encodeURIComponent(twin.id)}/chat-history?surface=ask`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<SavedMessage[]>) : []))
      .then((loaded) => {
        let rows = loaded;
        // Marked only once applied: a run React cancels (StrictMode) loads again.
        if (!alive || loadedRef.current.has(twin.id)) return;
        loadedRef.current.add(twin.id);
        // Started fresh after the last saved message: keep it fresh.
        if (rows.length && (rows[rows.length - 1].ts ?? 0) < freshSince(twin.id)) rows = [];
        conversationRef.current[twin.id] = rows.find((m) => m.conversationId)?.conversationId ?? newConversationId();
        const restored: Turn[] = [];
        for (const m of rows) {
          if (m.role === "user") {
            restored.push({ id: ++turnSeq.current, twinId: twin.id, twinName: twin.name, initials: twin.initials, color: twin.avatarColor, voiceId: twin.ttsVoiceId, question: m.text, viaVoice: m.viaVoice, steps: [], thinking: "", answer: null });
          } else if (restored.length && restored[restored.length - 1].answer === null) {
            const last = restored[restored.length - 1];
            last.answer = m.text;
            last.steps = (m.steps ?? []).map((st) => ({ ...st, id: ++stepSeq.current, done: true }));
          }
        }
        const complete = restored.filter((r) => r.answer !== null);
        // Earlier answers go above anything already asked on this visit.
        if (complete.length) setTurns((prev) => [...complete, ...prev]);
      })
      .catch(() => {
        conversationRef.current[twin.id] ??= newConversationId();
      });
    return () => {
      alive = false;
    };
  }, [twin]);

  const newConversation = () => {
    if (!twinId || busy) return;
    stopAudio();
    conversationRef.current[twinId] = newConversationId();
    markFresh(twinId);
    setTurns((prev) => prev.filter((turn) => turn.twinId !== twinId || turn.task));
  };

  // Temporary Ask: a fresh chat that is not saved to history and writes no
  // memory. Switching either way starts a new conversation, so a saved one is
  // never mixed with an unsaved one on the same screen.
  const [temporary, setTemporary] = useState(false);
  const temporaryRef = useRef(false);
  const toggleTemporary = () => {
    if (busy) return;
    temporaryRef.current = !temporaryRef.current;
    setTemporary(temporaryRef.current);
    newConversation();
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/demo", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<DemoStatus>) : null))
      .then((d) => {
        if (alive) setDemo(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const pending = pendingAskRef.current;
    if (!pending || twinId !== pending.employeeId) return;
    pendingAskRef.current = null;
    orbRef.current?.submit(pending.question);
  }, [twinId]);

  useEffect(() => {
    fetch("/api/system/config")
      .then((r) => r.json())
      .then((c: { voice?: boolean; voiceAllowed?: boolean; voiceLive?: boolean }) => {
        setVoiceReady(Boolean(c.voice));
        setVoiceAllowed(Boolean(c.voiceAllowed));
        setVoiceLive(Boolean(c.voiceLive));
      })
      .catch(() => setVoiceReady(false));
  }, []);

  // Keep the newest step in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // The live speaker saying the current answer, sentence by sentence.
  const speakerRef = useRef<LiveSpeaker | null>(null);
  // "Let me check." playing while the twin works on a spoken question.
  const ackRef = useRef<PlayingAck | null>(null);
  // The turn spoken live while it streamed, so it isn't spoken again at the end.
  const liveTurnRef = useRef<number | null>(null);
  // Live speech failed to connect once: whole-answer playback for this visit.
  const liveTtsBroken = useRef(false);
  // What the twin is saying (or just said), to tell its echo from the person.
  const spokenRef = useRef<{ text: string; endedAt: number | null }>({ text: "", endedAt: null });

  // Stop any playing answer when leaving the page.
  useEffect(
    () => () => {
      audioRef.current?.pause();
      speakerRef.current?.stop();
      ackRef.current?.stop();
      clipRef.current?.stop();
    },
    [],
  );

  // Answers play on one AudioContext; browsers only let it start from a click
  // or key press, so wake it on the first one while answers are read aloud.
  useEffect(() => {
    if (!(voiceLive || demoVoice) || !voiceOn) return;
    const unlock = () => void playbackContext();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [voiceLive, demoVoice, voiceOn]);

  // Every stop bumps the generation, so a speakWhole() still fetching its
  // audio gives up instead of playing over the mic (or over a newer answer).
  // Stopping also silences the live speaker.
  const speakGen = useRef(0);
  const voiceStateRef = useRef<"idle" | "connecting" | "listening" | "transcribing">("idle");
  // The live engine keeps the mic open while the twin talks (talking over it
  // stops it), so playback isn't held back for an open mic.
  const liveEngineRef = useRef(false);
  const stopAudio = () => {
    speakGen.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    const speaker = speakerRef.current;
    speakerRef.current = null;
    speaker?.stop();
    ackRef.current?.stop();
    ackRef.current = null;
    clipRef.current?.stop();
    clipRef.current = null;
    setAudio(null);
  };

  /** The demo's recorded answer in the twin's voice (no key needed). */
  const playClip = async (turnId: number, url: string) => {
    const gen = speakGen.current;
    setAudio({ id: turnId, status: "loading" });
    const clip: DemoClip | null = await playDemoClip(url, {
      ended: () => {
        if (clipRef.current !== clip) return;
        clipRef.current = null;
        setAudio(null);
      },
    });
    // Stopped (or a newer answer started) while the clip was loading.
    if (gen !== speakGen.current) {
      clip?.stop();
      return;
    }
    clipRef.current = clip;
    setAudio(clip ? { id: turnId, status: "playing" } : null);
  };

  /** A live speaker for one turn, or null when live speech isn't available.
   *  `fallback` runs if it can't connect, before anything was said. */
  const openSpeaker = (turnId: number, voiceId: string | undefined, fallback?: () => void): LiveSpeaker | null => {
    if (!voiceLive || liveTtsBroken.current) return null;
    const speaker: LiveSpeaker = new LiveSpeaker(voiceId, {
      playing: () => {
        if (speakerRef.current === speaker) setAudio({ id: turnId, status: "playing" });
      },
      ended: () => {
        spokenRef.current = { text: speaker.spoken, endedAt: Date.now() };
        if (speakerRef.current !== speaker) return;
        speakerRef.current = null;
        setAudio(null);
      },
      failed: () => {
        liveTtsBroken.current = true;
        if (speakerRef.current !== speaker) return;
        speakerRef.current = null;
        setAudio(null);
        fallback?.();
      },
    });
    speakerRef.current = speaker;
    spokenRef.current = { text: "", endedAt: null };
    setAudio({ id: turnId, status: "loading" });
    return speaker;
  };

  /** Play (or stop) one answer in the twin's voice, through ElevenLabs. */
  const speak = async (turnId: number, answer: string, voiceId?: string) => {
    if (audio?.id === turnId) {
      stopAudio();
      return;
    }
    if (demoReplay) {
      const turn = turns.find((x) => x.id === turnId);
      const clip = turn ? demoClipFor(turn.twinId, turn.question) : null;
      if (!clip) {
        flashHint(t("ask.demo.voiceOnly"));
        return;
      }
      playbackContext(); // inside the click
      stopAudio();
      return playClip(turnId, clip);
    }
    if (!voiceReady) {
      flashHint(t("ask.voiceSetup"), { settings: true });
      return;
    }
    if (!answer) return;
    playbackContext(); // inside the click when there is one
    answer = stripCites(answer);
    stopAudio();
    const speaker = openSpeaker(turnId, voiceId, () => void speakWhole(turnId, answer, voiceId));
    if (speaker) {
      for (const sentence of takeSentences(answer, true).sentences) speaker.say(speakable(sentence));
      speaker.finish();
      return;
    }
    return speakWhole(turnId, answer, voiceId);
  };

  /** The whole answer as one clip (/api/tts/stream), when live speech is off. */
  const speakWhole = async (turnId: number, answer: string, voiceId?: string) => {
    const gen = speakGen.current;
    setAudio({ id: turnId, status: "loading" });
    spokenRef.current = { text: answer, endedAt: null };
    try {
      const res = await fetch("/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer, voiceId }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      // Stopped (or the mic opened) while the audio was on its way: drop it.
      if (gen !== speakGen.current || (!liveEngineRef.current && voiceStateRef.current !== "idle")) return;
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      audioRef.current = player;
      player.onended = () => {
        URL.revokeObjectURL(url);
        spokenRef.current = { text: answer, endedAt: Date.now() };
        if (audioRef.current === player) stopAudio();
      };
      await player.play();
      setAudio({ id: turnId, status: "playing" });
    } catch {
      setAudio(null); /* voice is a bonus; the answer is already on screen */
    }
  };
  const audioStateFor = (id: number) => (audio?.id === id ? audio.status : "idle");

  const patchTurn = (id: number, fn: (turn: Turn) => Turn) =>
    setTurns((prev) => prev.map((turn) => (turn.id === id ? fn(turn) : turn)));

  // Hand the twin a task, like you would a colleague: it goes on the twin's
  // work queue and starts now; the conversation shows its status and result.
  const assign = async (task: string, viaVoice = false) => {
    if (!twinId || !twin) return t("ask.noTwin");
    setBusy(true);
    stopAudio();
    const id = ++turnSeq.current;
    setTurns((prev) => [
      ...prev,
      { id, twinId, twinName: twin.name, initials: twin.initials, color: twin.avatarColor, voiceId: twin.ttsVoiceId, question: task, viaVoice, steps: [], thinking: "", answer: null, task: { status: "queued" } },
    ]);
    const hebrew = /[\u0590-\u05FF]/.test(task);
    try {
      const res = await fetch("/api/work-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeEmployeeId: twinId,
          title: task.replace(/\s+/g, " ").slice(0, 90),
          task: `The CEO handed you this task directly. Do it, then end with a short summary of what you did and the result${hebrew ? ", in Hebrew" : ""}.\n\n${task}`,
          startNow: true,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { item } = (await res.json()) as { item: { id: string } };
      const ack = hebrew ? `קיבלתי, אני על זה. אעדכן כאן כשאסיים.` : `On it. I'll work on this now and report back here.`;
      patchTurn(id, (turn) => ({ ...turn, answer: ack, task: { itemId: item.id, status: "queued" } }));
      return ack;
    } catch {
      patchTurn(id, (turn) => ({ ...turn, answer: t("ask.error"), task: { status: "failed" } }));
      return t("ask.error");
    }
  };

  // Follow handed tasks live until they finish: status from the work queue,
  // and every tool call, thought and written document from the run's log.
  const openTasks = turns.filter((turn) => turn.task?.itemId && (turn.task.status === "queued" || turn.task.status === "leased")).length;
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    if (!openTasks) return;
    let stopped = false;
    const poll = async () => {
      let items: { id: string; status: NonNullable<Turn["task"]>["status"]; resultSummary?: string; runId?: string }[] = [];
      try {
        items = await fetch("/api/work-items", { cache: "no-store" }).then((r) => r.json());
      } catch {
        return;
      }
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const turn of turnsRef.current) {
        const task = turn.task;
        if (!task?.itemId) continue;
        const item = byId.get(task.itemId);
        if (!item) continue;
        const runId = item.runId ?? task.runId;
        // Read what the run logged since last time.
        let fresh: { type: string; tool?: string; full?: string; input?: Record<string, unknown>; text?: string }[] = [];
        let read = 0;
        if (runId && task.status !== "done" && task.status !== "failed") {
          try {
            const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/log?offset=${task.logOffset ?? 0}`, { cache: "no-store" });
            if (res.ok) {
              const buf = new Uint8Array(await res.arrayBuffer());
              const text = new TextDecoder().decode(buf);
              const lastNl = text.lastIndexOf("\n");
              if (lastNl >= 0) {
                read = new TextEncoder().encode(text.slice(0, lastNl + 1)).length;
                fresh = text
                  .slice(0, lastNl)
                  .split("\n")
                  .filter(Boolean)
                  .map((l) => {
                    try {
                      return JSON.parse(l);
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean);
              }
            }
          } catch {
            // next tick
          }
        }
        if (stopped) return;
        patchTurn(turn.id, (tu) => {
          let steps = tu.steps;
          let thinking = tu.thinking;
          const docs = [...(tu.task?.docs ?? [])];
          for (const ev of fresh) {
            if (ev.type === "tool_use" && ev.tool) {
              const name = ev.full ?? ev.tool;
              if (name === "ToolSearch" || name === "TodoWrite") continue;
              if (name === "Write" && typeof ev.input?.content === "string") {
                const fp = String(ev.input.file_path ?? "document.md");
                docs.push({ name: fp.split("/").pop() ?? fp, content: ev.input.content });
                steps = [...steps.map((x) => ({ ...x, done: true })), { kind: "read" as const, label: "Wrote a document", detail: fp.split("/").pop(), id: ++stepSeq.current, done: false }];
                continue;
              }
              if (name === "Edit" && typeof ev.input?.old_string === "string" && typeof ev.input?.new_string === "string") {
                // The twin revised a document it wrote: keep the shown copy current.
                const fname = String(ev.input.file_path ?? "").split("/").pop();
                const at = docs.findIndex((d) => d.name === fname);
                if (at >= 0) docs[at] = { ...docs[at], content: docs[at].content.replace(ev.input.old_string, ev.input.new_string) };
                steps = [...steps.map((x) => ({ ...x, done: true })), { kind: "read" as const, label: "Revised the document", detail: fname, id: ++stepSeq.current, done: false }];
                continue;
              }
              steps = [...steps.map((x) => ({ ...x, done: true })), { ...describeToolCall(name, ev.input ?? {}), id: ++stepSeq.current, done: false }];
            } else if (ev.type === "thinking" && ev.text) {
              thinking += ev.text;
            }
          }
          const status = item.status;
          const finished = status === "done" || status === "failed" || status === "skipped";
          if (finished) steps = steps.map((x) => ({ ...x, done: true }));
          return {
            ...tu,
            steps,
            thinking,
            task: { ...tu.task!, status, result: item.resultSummary, runId, logOffset: (tu.task?.logOffset ?? 0) + read, docs },
          };
        });
      }
    };
    void poll();
    const iv = setInterval(() => void poll(), 1500);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [openTasks]);

  const onSubmit = async (question: string, signal: AbortSignal) => {
    const viaVoice = viaVoiceRef.current;
    viaVoiceRef.current = false;
    if (mode === "task") return assign(question, viaVoice);
    if (!twinId || !twin) return t("ask.noTwin");
    setBusy(true);
    stopAudio();
    // Earlier answers from the same twin give follow-up questions context.
    const history = turns
      .filter((turn) => turn.twinId === twinId && turn.answer)
      .slice(-4)
      .flatMap((turn) => [
        { role: "user" as const, text: turn.question },
        { role: "assistant" as const, text: turn.answer ?? "" },
      ]);
    const id = ++turnSeq.current;
    setTurns((prev) => [
      ...prev,
      { id, twinId, twinName: twin.name, initials: twin.initials, color: twin.avatarColor, voiceId: twin.ttsVoiceId, question, viaVoice, steps: [], thinking: "", answer: null },
    ]);
    // Spoken back while it's written: each finished sentence goes to the
    // speaker as soon as the twin streams it.
    const speaker = voiceReady && (voiceOn || viaVoice) ? openSpeaker(id, twin.ttsVoiceId) : null;
    liveTurnRef.current = speaker ? id : null;
    // The demo speaks its recorded answer as the text starts, like live voice.
    let demoClip = voiceOn && !signal.aborted ? demoClipFor(twinId, question) : null;
    let unsaid = "";
    const sayStreamed = (delta: string, final = false) => {
      if (demoClip && delta) {
        void playClip(id, demoClip);
        demoClip = null;
      }
      if (!speaker) return;
      const { sentences, rest } = takeSentences(unsaid + delta, final);
      unsaid = rest;
      for (const sentence of sentences) speaker.say(speakable(sentence));
      if (final) speaker.finish();
    };
    // A spoken question gets an immediate "Let me check." while the twin
    // works, unless the answer has already started by then.
    const ackTimer =
      viaVoice && speaker
        ? window.setTimeout(() => {
            if (speakerRef.current !== speaker || speaker.spoken || signal.aborted) return;
            const previous = [...history].reverse().find((h) => h.role === "user")?.text;
            const phrase = ackPhrase(question, voiceLaneInContext(question, previous));
            const ack = playAck(twin.ttsVoiceId, phrase, () => {
              if (ackRef.current === ack) ackRef.current = null;
              // Its words stay echo for a moment after, even if the answer's voice failed.
              if (spokenRef.current.text === phrase) spokenRef.current = { text: phrase, endedAt: Date.now() };
            });
            if (!ack) return;
            ackRef.current = ack;
            speaker.after(ack.endsAt, phrase);
            spokenRef.current = { text: phrase, endedAt: null };
            setAudio({ id, status: "playing" });
          }, ACK_AFTER_MS)
        : undefined;
    // Escaped before the answer was shown: stop the run, its voice and the queue.
    const onAbort = () => {
      if (speakerRef.current === speaker) stopAudio();
      else speaker?.stop();
      ackRef.current?.stop();
      ackRef.current = null;
      queuedVoiceRef.current = null;
      setBusy(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // The steps as they'll be saved with the answer (same folding as on screen).
    const savedSteps: SavedStep[] = [];
    let answer: string;
    let answered = false;
    try {
      answer =
        (await askTwin(twinId, question, history, {
          step: (s) => {
            const lastSaved = savedSteps[savedSteps.length - 1];
            if (s.label === "Read profile" && lastSaved?.label === "Read profile") lastSaved.detail = t("ask.trace.profileFiles");
            else savedSteps.push({ kind: s.kind, label: s.label, detail: s.detail, logo: s.logo });
            patchTurn(id, (turn) => {
              // The route reports the twin's pre-loaded profile as a burst of Reads: fold them.
              const last = turn.steps[turn.steps.length - 1];
              if (s.label === "Read profile" && last?.label === "Read profile") {
                return { ...turn, steps: [...turn.steps.slice(0, -1), { ...last, detail: t("ask.trace.profileFiles"), done: true }] };
              }
              return { ...turn, steps: [...turn.steps, { ...s, id: ++stepSeq.current, done: false }] };
            });
          },
          stepDone: () =>
            patchTurn(id, (turn) => ({
              ...turn,
              steps: turn.steps.map((s, i) => (i === turn.steps.length - 1 ? { ...s, done: true } : s)),
            })),
          thinking: (d) => patchTurn(id, (turn) => ({ ...turn, thinking: turn.thinking + d })),
          text: (d) => sayStreamed(d),
        }, signal, viaVoice, temporaryRef.current)) || t("ask.empty");
      answer = tidyCites(answer);
      answered = true;
    } catch (err) {
      answer = signal.aborted ? t("ask.stopped") : err instanceof TwinError ? err.message : t("ask.error");
    } finally {
      signal.removeEventListener("abort", onAbort);
      window.clearTimeout(ackTimer);
    }
    if (!signal.aborted) sayStreamed("", true);
    patchTurn(id, (turn) => ({ ...turn, answer }));
    // A temporary ask is never saved: it lives on this screen only.
    if (answered && !signal.aborted && !temporaryRef.current) {
      const conversationId = (conversationRef.current[twinId] ??= newConversationId());
      saveExchange(twinId, [
        { id: `q${id}-${conversationId}`, role: "user", text: question, conversationId, viaVoice },
        { id: `a${id}-${conversationId}`, role: "twin", text: answer, conversationId, steps: savedSteps },
      ]);
    }
    return answer;
  };

  /** Asks a spoken question; the orb may still be on its way back to idle. */
  const submitVoice = (text: string, tries = 20) => {
    viaVoiceRef.current = true;
    if (orbRef.current?.submit(text)) return;
    viaVoiceRef.current = false;
    if (tries > 0) window.setTimeout(() => submitVoice(text, tries - 1), 100);
  };

  // Talk instead of type: the transcript is asked (or handed as a task, per
  // the mode) exactly as if it had been typed into the orb.
  const echoSource = () =>
    twinWordsInTheRoom(speakerRef.current?.spoken ?? null, spokenRef.current, Boolean(audioRef.current || ackRef.current));
  const voice = useVoiceInput({
    serverStt: voiceReady,
    liveStt: voiceLive,
    allowBrowser: voiceAllowed && !demoReplay,
    lang: bcp47(locale),
    // Barge-in: the person talking over the twin stops it at once. Only once
    // it's actually talking: words said while it thinks are queued instead.
    onPartial: (text) => {
      if (!speakerRef.current?.playing && !audioRef.current && !ackRef.current) return;
      if (!heardSpeech(text) || looksLikeEcho(text, echoSource())) return;
      // While "Let me check." is still sounding (the answer queues behind it).
      if (ackRef.current && (playbackContext()?.currentTime ?? Infinity) < ackRef.current.endsAt) {
        // Talking over "Let me check." ("okay") cuts only that; the answer
        // still comes, right away.
        ackRef.current.stop();
        ackRef.current = null;
        speakerRef.current?.cancelHold();
        return;
      }
      stopAudio();
    },
    onTranscript: (text) => {
      // The twin's own voice through the speakers, not a question.
      const echo = echoSource();
      if (echo && looksLikeEcho(text, echo)) return;
      viaVoiceRef.current = true;
      if (orbRef.current?.submit(text)) return;
      viaVoiceRef.current = false;
      if (liveEngineRef.current) {
        // Said over an answer that's still being written: one word ("stop",
        // "wait") only interrupts; anything longer is asked as soon as the
        // answer lands (several in a row are asked together).
        if (text.trim().split(/\s+/).length <= 1) return;
        queuedVoiceRef.current = queuedVoiceRef.current ? `${queuedVoiceRef.current} ${text}` : text;
        flashHint(t("ask.mic.queued"), { mic: true });
        return;
      }
      // The orb is busy (a typed question is still running): say so.
      flashHint(t("ask.mic.busy"), { mic: true });
    },
    onError: (err: VoiceInputError) => {
      if (err === "live_lost") flashHint(t("ask.mic.liveLost"), { mic: true });
      else if (err === "unsupported") flashHint(t("ask.mic.setup"), { settings: true, mic: true });
      else if (err === "denied") flashHint(t("ask.mic.denied"), { mic: true });
      else if (err === "no_speech") flashHint(t("ask.mic.noSpeech"), { mic: true });
      else flashHint(t("ask.mic.failed"), { mic: true });
    },
  });
  const onMic = () => {
    // Talking needs an ElevenLabs key: the demo has none.
    if (demoReplay) {
      flashHint(t("ask.demo.mic"), { mic: true });
      return;
    }
    // Don't let the mic hear the twin's last answer.
    if (voice.state === "idle") {
      stopAudio();
      if (voice.engine === "live") playbackContext(); // the answer will be spoken

      // Without an ElevenLabs key the browser transcribes, through its vendor's
      // servers (Google in Chrome, Apple in Safari). Say so once.
      if (voice.engine === "browser") {
        try {
          if (!localStorage.getItem("ask.mic.browserNotice")) {
            localStorage.setItem("ask.mic.browserNotice", "1");
            flashHint(t("ask.mic.browserNotice"), { mic: true });
          }
        } catch {
          // storage blocked: skip the notice
        }
      }
    }
    voice.toggle();
  };
  useEffect(() => {
    voiceStateRef.current = voice.state;
    liveEngineRef.current = voice.engine === "live";
  }, [voice.state, voice.engine]);
  // Have the twin's "Let me check." ready before the first spoken question.
  const ackVoice = twin?.ttsVoiceId;
  useEffect(() => {
    if (voice.engine === "live" && voice.state !== "idle") prepareAcks(ackVoice);
  }, [voice.engine, voice.state, ackVoice]);
  // Live voice listens across questions; it lets go after a quiet spell with
  // nothing said, nothing being answered and nothing playing.
  const live = voice.engine === "live";
  const answering = busy && turns[turns.length - 1]?.answer == null;
  const stopVoice = voice.stop;
  const idleEnd = useEffectEvent(() => {
    stopVoice();
    flashHint(t("ask.mic.idleEnd"), { mic: true });
  });
  useEffect(() => {
    if (!live || voice.state !== "listening" || audio || answering) return;
    const timer = window.setTimeout(idleEnd, LIVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [live, voice.state, voice.interim, audio, answering]);
  // Escape drops a question still being spoken. In a live conversation it
  // also silences the twin; a second Escape then reaches the orb.
  const listening = voice.state === "listening";
  const cancelVoice = voice.cancel;
  const escapeVoice = useEffectEvent(() => {
    cancelVoice();
    if (live) stopAudio();
  });
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase + stop: it must not also reach the orb's own Escape
      // (which resets the answer).
      e.stopImmediatePropagation();
      escapeVoice();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);
  const voiceCopy = listening
    ? voice.interim || t(live ? "ask.mic.live" : "ask.mic.listening")
    : voice.state === "connecting"
      ? t("ask.mic.connecting")
      : voice.state === "transcribing"
        ? t("ask.mic.transcribing")
        : null;
  const micLabel =
    voice.state === "connecting"
      ? t("ask.mic.connecting")
      : !listening
        ? t("ask.mic.start")
        : live && !voice.interim
          ? t("ask.mic.end")
          : t("ask.mic.stop");

  return (
    // minHeight 0: the shell panel is shorter than the viewport (inset, plus
    // the consent banner), so the page must shrink or the composer is cut off.
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      <Topbar
        crumbs={[t("nav.ask")]}
        actions={
          voiceReady || demoVoice ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                if (!voiceOn) playbackContext(); // unlock audio inside the click
                writeVoiceOn(!voiceOn);
                stopAudio();
              }}
              title={t("ask.voiceTitle")}
              aria-pressed={voiceOn}
              aria-label={t("ask.voiceTitle")}
              {...focusRingHandlers}
              style={{ height: 28, display: "flex", alignItems: "center", gap: 6 }}
            >
              {voiceOn ? <Icons.Volume size={12} /> : <Icons.VolumeOff size={12} />}
              {voiceOn ? t("ask.voiceOn") : t("ask.voiceOff")}
            </button>
          ) : undefined
        }
      />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* stage: 70% */}
        <div style={{ position: "relative", flex: 7, minWidth: 0, minHeight: 520 }}>
          {/* While the twin talks: one click silences it; the mic stays open.
              Outside the composer, which is inert while the answer streams. */}
          <AnimatePresence>
            {audio?.status === "playing" && (
              <motion.button
                type="button"
                onClick={stopAudio}
                aria-label={t("ask.stopSpeaking")}
                {...focusRingHandlers}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18 }}
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: 104,
                  translateX: "-50%",
                  zIndex: 30,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 14px 7px 12px",
                  borderRadius: 999,
                  border: "1px solid var(--hairline)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: 13,
                  fontWeight: 500,
                  boxShadow: "0 6px 20px rgba(0,0,0,.25)",
                  cursor: "pointer",
                }}
              >
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: "currentColor" }} />
                {t("ask.stopSpeaking")}
              </motion.button>
            )}
          </AnimatePresence>
          <MorphOrb
            ref={orbRef}
            onSubmit={onSubmit}
            // Asks start during the launch animation; a task waits, so an
            // Escape during launch never hands one out.
            eagerSubmit={mode === "ask"}
            inputAccessory={
              <MicButton
                state={voice.state}
                level={voice.level}
                onClick={onMic}
                label={micLabel}
              />
            }
            // The run as an n8n-style flow around the orb: question → orb →
            // answer, every source the twin reaches for, and the tools pulled
            // through MCP. Inside the stage, under the orb and the answer card.
            // [[source]] markers in the answer become source chips in the card.
            renderCite={(ids) => {
              const last = turns[turns.length - 1];
              const srcs = last ? sourcesOf(last.steps).filter((x) => ids.includes(x.id)) : [];
              return <CiteChip src={srcs} />;
            }}
            backdrop={
              <FlowCanvas
                steps={flowTurn?.steps ?? []}
                visible={Boolean(flowTurn)}
                answered={flowTurn?.task ? flowTurn.task.status === "done" : flowTurn?.answer != null}
                questionLabel={t("ask.flow.question")}
                answerLabel={t("ask.flow.answer")}
              />
            }
            onAnswered={(answer) => {
              const last = turns[turns.length - 1];
              answeredTurnRef.current = last?.id ?? null;
              const queued = queuedVoiceRef.current;
              if (queued) {
                // The person already asked the next thing: ask it now.
                queuedVoiceRef.current = null;
                window.setTimeout(() => submitVoice(queued), 0);
                return;
              }
              // A spoken question always gets a spoken answer. Live voice
              // already said it while it streamed.
              if (!last || !voiceReady || !(voiceOn || last.viaVoice)) return;
              if (liveTurnRef.current === last.id && !liveTtsBroken.current) return;
              void speak(last.id, answer, last.voiceId);
            }}
            answerAction={(() => {
              const last = turns[turns.length - 1];
              if (!last?.answer) return null;
              return (
                <SpeakButton
                  state={audioStateFor(last.id)}
                  label={t("ask.listen")}
                  onClick={() => void speak(last.id, last.answer ?? "", last.voiceId)}
                />
              );
            })()}
            onReset={() => {
              // A follow-up can already be running (the orb asks as it
              // starts): leave its voice and busy state alone then.
              if (turnSeq.current === answeredTurnRef.current) {
                setBusy(false);
                stopAudio();
              }
              const queued = queuedVoiceRef.current;
              queuedVoiceRef.current = null;
              if (queued) submitVoice(queued);
            }}
            minThinkMs={2600}
            copy={{
              placeholder: voiceCopy ?? (twin ? (mode === "task" ? t("ask.task.placeholder", { name: twin.firstName }) : t("ask.placeholder", { name: twin.firstName })) : t("ask.placeholderAny")),
              labels: [t("ask.l.thinking"), t("ask.l.searching"), t("ask.l.reading"), t("ask.l.composing")],
              done: t("ask.done"),
              answerTitle: twin ? `${twin.name} · ${displayRole(twin)}` : t("ask.answer"),
              reset: t("ask.reset"),
              send: t("ask.send"),
              followUp: voiceCopy ?? (twin ? t("ask.followUp", { name: twin.firstName }) : t("ask.placeholderAny")),
            }}
          />



          <AnimatePresence>
            {voiceHint && (
              <motion.a
                href={voiceHint.settings ? "/settings" : undefined}
                role={voiceHint.settings ? undefined : "status"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 20,
                  translateX: "-50%",
                  zIndex: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  borderRadius: 999,
                  background: "var(--surface)",
                  border: "1px solid var(--hairline)",
                  boxShadow: "0 8px 24px color-mix(in oklab, var(--text) 10%, transparent)",
                  color: "var(--text)",
                  fontSize: 13,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {voiceHint.mic ? <Icons.Mic size={13} /> : <Icons.Volume size={13} />} {voiceHint.text}
              </motion.a>
            )}
          </AnimatePresence>

          {/* who answers */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: busy ? 0 : 1, y: busy ? -8 : 0 }}
            transition={{ duration: 0.3 }}
            style={{
              position: "absolute",
              top: 28,
              left: 0,
              right: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              zIndex: 5,
              pointerEvents: busy ? "none" : "auto",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("ask.title")}</div>
            <div role="group" aria-label="Choose a twin" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", padding: "0 16px" }}>
              {twins.map((e) => {
                const active = e.id === twinId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelected(e.id)}
                    title={`${e.name} · ${displayRole(e)}`}
                    aria-pressed={active}
                    aria-label={`${e.name}, ${displayRole(e)}`}
                    {...focusRingHandlers}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 12px 4px 4px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "var(--hairline-strong)" : "var(--hairline)"}`,
                      background: active ? "var(--surface)" : "transparent",
                      boxShadow: active ? "0 2px 8px color-mix(in oklab, var(--text) 8%, transparent)" : "none",
                      color: active ? "var(--text)" : "var(--text-muted)",
                      fontSize: 13,
                      fontWeight: active ? 500 : 400,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <Avatar initials={e.initials} color={e.avatarColor} size={24} />
                    {e.firstName}
                  </button>
                );
              })}
            </div>
            {/* ask a question, or hand over a task, like you would a colleague */}
            <div
              role="tablist"
              aria-label="Ask or hand off a task"
              onKeyDown={onAskModeTabKey}
              style={{ display: "flex", padding: 3, gap: 2, borderRadius: 10, background: "var(--bg-sunken)", border: "1px solid var(--hairline)" }}
            >
              {(retired || demoReplay ? (["ask"] as const) : (["ask", "task"] as const)).map((m) => {
                const on = mode === m;
                return (
                  <button
                    key={m}
                    ref={m === "ask" ? askModeTabRef : taskModeTabRef}
                    role="tab"
                    aria-selected={on}
                    tabIndex={on ? 0 : -1}
                    type="button"
                    onClick={() => setMode(m)}
                    {...focusRingHandlers}
                    style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600, color: on ? "var(--text)" : "var(--text-muted)" }}
                  >
                    {on && (
                      <motion.span
                        layoutId="ask-mode"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        style={{ position: "absolute", inset: 0, borderRadius: 8, background: "var(--surface)", boxShadow: "0 1px 3px color-mix(in oklab, var(--text) 12%, transparent)" }}
                      />
                    )}
                    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {m === "ask" ? <Icons.MessageSquare size={12} /> : <Icons.Zap size={12} />}
                      {m === "ask" ? t("ask.mode.ask") : t("ask.mode.task")}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* the demo's recorded questions: no key, no model call */}
            {demoAsks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, maxWidth: 640, padding: "0 16px" }}>
                <div style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{t("ask.demo.suggested")}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {demoAsks.map((a) => {
                    const who = twins.find((e) => e.id === a.employeeId);
                    if (!who) return null;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        title={`${who.name} · ${displayRole(who)}`}
                        onClick={() => {
                          playbackContext(); // the answer may be spoken: unlock audio inside the click
                          if (twinId === a.employeeId) orbRef.current?.submit(a.question);
                          else {
                            pendingAskRef.current = a;
                            setSelected(a.employeeId);
                          }
                        }}
                        aria-label={`${who.name}: ${a.question}`}
                        {...focusRingHandlers}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px", borderRadius: 999, border: "1px dashed var(--hairline-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5, cursor: "pointer", textAlign: "start" }}
                      >
                        <Avatar initials={who.initials} color={who.avatarColor} size={20} />
                        <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{who.firstName}{who.lifecycle === "retired" ? ` (${t("ask.demo.former")})` : ""}:</span>
                        {a.question}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </div>

        {/* conversation + how the twin got there: 30% */}
        {/* drag to widen the conversation (double-click resets) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("ask.resize")}
          title={t("ask.resize")}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDoubleClick={() => writePanelWidth(PANEL_DEFAULT)}
          tabIndex={0}
          {...focusRingHandlers}
          style={{ flex: "0 0 12px", cursor: "col-resize", display: "grid", placeItems: "center", touchAction: "none" }}
        >
          <motion.span
            animate={{ height: dragging ? 56 : 32, opacity: dragging ? 1 : 0.55 }}
            whileHover={{ height: 48, opacity: 1 }}
            style={{ width: 4, borderRadius: 4, background: dragging ? "var(--accent)" : "var(--hairline-strong)" }}
          />
        </div>

        {/* detached like the sidebar: same radius, border, shadow and gutter */}
        <aside
          style={{
            flex: `0 0 ${panelWidth}px`,
            minWidth: PANEL_MIN,
            display: "flex",
            flexDirection: "column",
            margin: "var(--sp-8)",
            marginInlineStart: 0,
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--shadow-sm)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 44,
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 18px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-subtle)",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            <Icons.MessageSquare size={12} />
            {t("ask.conversation")}
            {temporary && (
              <span
                role="status"
                data-testid="ask-temporary-label"
                title={t("ask.temporaryHint")}
                style={{ padding: "2px 7px", borderRadius: 6, border: "1px dashed var(--hairline)", color: "var(--text)", fontSize: 10, letterSpacing: "0.06em" }}
              >
                {t("ask.temporaryLabel")}
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={temporary}
              onClick={toggleTemporary}
              disabled={busy}
              title={t("ask.temporaryHint")}
              {...focusRingHandlers}
              style={{ marginInlineStart: "auto", padding: "3px 8px", borderRadius: 6, border: "1px solid var(--hairline)", background: temporary ? "var(--surface)" : "transparent", color: temporary ? "var(--text)" : "var(--text-muted)", fontSize: 11, fontWeight: 500, letterSpacing: 0, textTransform: "none", cursor: busy ? "default" : "pointer" }}
            >
              {t("ask.temporaryToggle")}
            </button>
            {twinId && turns.some((turn) => turn.twinId === twinId && !turn.task) && (
              <button
                type="button"
                onClick={newConversation}
                disabled={busy}
                title={t("ask.newConversationTitle")}
                aria-label={t("ask.newConversationTitle")}
                {...focusRingHandlers}
                style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--hairline)", background: "transparent", color: "var(--text-muted)", fontSize: 11, fontWeight: 500, letterSpacing: 0, textTransform: "none", cursor: busy ? "default" : "pointer" }}
              >
                {t("ask.newConversation")}
              </button>
            )}
          </div>
          <div
            ref={listRef}
            style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: 22 }}
          >
            {turns.length === 0 && (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-subtle)" }}>{t("ask.conversationEmpty")}</div>
            )}
            {turns.map((turn) => (
              <motion.div
                key={turn.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div
                  dir="auto"
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "88%",
                    padding: "8px 12px",
                    borderRadius: "14px 14px 4px 14px",
                    background: "var(--accent-soft)",
                    color: "var(--text)",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                  }}
                >
                  {turn.question}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar initials={turn.initials} color={turn.color} size={22} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)" }}>{turn.twinName}</span>
                </div>

                <Trace turn={turn} live={turn.task ? turn.task.status === "queued" || turn.task.status === "leased" : turn.answer === null} />
                {turn.task && <TaskStatus task={turn.task} />}

                {turn.answer !== null && (
                  <motion.div
                    dir="auto"
                    aria-live="polite"
                    aria-atomic="true"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "4px 14px 14px 14px",
                      background: "var(--surface)",
                      border: "1px solid var(--hairline)",
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      color: "var(--text)",
                    }}
                  >
                    {(() => {
                      const srcs = sourcesOf(turn.steps);
                      return (
                        <CitedAnswer
                          parts={parseCitedAnswer(turn.answer ?? "", new Set(srcs.map((x) => x.id)))}
                          sources={srcs}
                          sourcesLabel={(count) => t("org.sources", { count })}
                          showList={false}
                        />
                      );
                    })()}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                      <SpeakButton
                        size={24}
                        state={audioStateFor(turn.id)}
                        label={t("ask.listen")}
                        onClick={() => void speak(turn.id, turn.answer ?? "", turn.voiceId)}
                      />
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function TaskStatus({ task }: { task: NonNullable<Turn["task"]> }) {
  const { t } = useT();
  const [open, setOpen] = useState<number | null>(null);
  const running = task.status === "queued" || task.status === "leased";
  const tone = task.status === "done" ? "var(--success)" : task.status === "failed" || task.status === "skipped" ? "var(--danger)" : "var(--accent-deep)";
  const label =
    task.status === "queued" ? t("ask.task.queued") : task.status === "leased" ? t("ask.task.working") : task.status === "done" ? t("ask.task.done") : t("ask.task.failed");
  const docs = task.docs ?? [];
  const titleOf = (d: { name: string; content: string }) => /^#\s+(.+)$/m.exec(d.content)?.[1]?.trim() ?? d.name;
  return (
    <>
      <motion.div
        layout
        style={{ borderRadius: 12, border: `1px solid ${running ? "color-mix(in oklab, var(--accent) 40%, var(--hairline))" : "var(--hairline)"}`, background: "var(--surface)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icons.Zap size={12} />
          <span style={{ fontSize: 12, fontWeight: 650, color: "var(--text)" }}>{t("ask.task.title")}</span>
          <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 650, color: tone }}>
            {running && <motion.span animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />}
            {task.status === "done" && <Icons.Check size={11} />}
            {label}
          </span>
        </div>

        {/* documents the twin wrote */}
        {docs.map((d, i) => (
          <motion.button
            key={i}
            type="button"
            onClick={() => setOpen(i)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -1 }}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--bg-sunken)", cursor: "pointer", font: "inherit", textAlign: "start" }}
          >
            <span style={{ width: 34, height: 40, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--accent-deep)", flexShrink: 0 }}>
              <Icons.Doc size={16} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span dir="auto" style={{ fontSize: 13, fontWeight: 650, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleOf(d)}</span>
              <span style={{ fontSize: 11, color: "var(--text-subtle)", fontFamily: "var(--font-mono, ui-monospace, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.name} · {t("ask.task.words", { count: d.content.split(/\s+/).filter(Boolean).length })}
              </span>
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 650, color: "var(--accent-deep)", whiteSpace: "nowrap" }}>{t("ask.task.read")} →</span>
          </motion.button>
        ))}

        {task.result && (
          <motion.div dir="auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)", maxHeight: 240, overflowY: "auto" }}>
            <Markdown>{task.result}</Markdown>
          </motion.div>
        )}
      </motion.div>

      {/* the document, read right here */}
      <AnimatePresence>
        {open !== null && docs[open] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(null);
            }}
            style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 24, background: "color-mix(in oklab, var(--bg) 55%, transparent)", backdropFilter: "blur(6px)" }}
          >
            <motion.div
              role="dialog"
              aria-label={titleOf(docs[open])}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
              style={{ width: "min(820px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", borderRadius: "var(--radius-xl)", background: "var(--bg)", border: "1px solid var(--hairline)", boxShadow: "0 30px 80px -30px color-mix(in oklab, var(--text) 45%, transparent)", overflow: "hidden" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--hairline)" }}>
                <Icons.Doc size={14} />
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono, ui-monospace, monospace)", color: "var(--text-muted)" }}>{docs[open].name}</span>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setOpen(null)}
                  aria-label={t("ask.task.close")}
                  style={{ marginInlineStart: "auto", display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer" }}
                >
                  <Icons.X size={13} />
                </button>
              </div>
              <div dir="auto" style={{ overflowY: "auto", padding: "22px 28px 28px", fontSize: 14.5, lineHeight: 1.65, color: "var(--text)" }}>
                <Markdown>{docs[open].content}</Markdown>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
