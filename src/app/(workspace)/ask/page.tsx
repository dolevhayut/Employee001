"use client";

// Ask — one question at a time to a twin. The stage (70%) turns the input into
// a thinking orb that unfolds into the answer; the side panel (30%) keeps the
// whole conversation and shows, live, how the twin got there: what it recalled
// from the company brain, which tools it ran, what was blocked, and its
// reasoning when the model streams it. Read-only by design: a tool call that
// would need approval is declined, so the orb never waits on a hidden card.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { useRoster } from "@/components/ex/roster-context";
import { useT } from "@/components/ex/i18n-context";
import MorphOrb from "@/components/ex/morph-orb/morph-orb";
import { describeToolCall, words } from "@/components/ex/morph-orb/tool-nodes";
import { FlowCanvas } from "@/components/ex/morph-orb/flow-canvas";
import { CitedAnswer, type CitedSource } from "@/components/ex/cited-answer";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { parseCitedAnswer } from "@/lib/org-answer";

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
    if (st.kind === "read" && st.label.startsWith("Recalled from profile")) add("profile", { name: "Profile", title: "Own profile", initials: "P", color: "var(--accent-soft)", kind: "read" }, st.detail);
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
  steps: Step[];
  thinking: string;
  answer: string | null;
  /** Set when the CEO handed this as a task instead of asking. */
  task?: { itemId?: string; status: "queued" | "leased" | "done" | "failed" | "skipped"; result?: string };
};

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
};

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
  on: { step: (s: Omit<Step, "id" | "done">) => void; stepDone: () => void; thinking: (d: string) => void },
): Promise<string> {
  const res = await fetch("/api/twin/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Name the language outright: a twin whose memory is in Hebrew otherwise
    // drifts into Hebrew for an English question.
    body: JSON.stringify({
      employeeId,
      history,
      question: `${question}\n\n(${ANSWER_STYLE} Reply in ${/[\u0590-\u05FF]/.test(question) ? "Hebrew" : "English"}.)`,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
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
  const [open, setOpen] = useState(true);
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
const linkedTwin = () => new URLSearchParams(window.location.search).get("twin");

export default function AskPage() {
  const { t } = useT();
  const roster = useRoster();
  const twins = roster.filter((e) => e.twinStatus === "ready");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"ask" | "task">("ask");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceReady, setVoiceReady] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnSeq = useRef(0);
  const stepSeq = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [audio, setAudio] = useState<AudioState>(null);
  const [voiceHint, setVoiceHint] = useState(false);

  // ?twin=<id> preselects a twin (the Company brain links here when a twin is clicked).
  const linked = useSyncExternalStore(noopSubscribe, linkedTwin, () => null);
  const twinId = selected ?? (linked && twins.some((e) => e.id === linked) ? linked : null) ?? twins[0]?.id ?? null;
  // The flow stays on the stage until the CEO starts a new question.
  const flowTurn = busy ? turns[turns.length - 1] : undefined;
  const twin = twins.find((e) => e.id === twinId);

  useEffect(() => {
    fetch("/api/system/config")
      .then((r) => r.json())
      .then((c: { elevenLabs?: boolean }) => setVoiceReady(Boolean(c.elevenLabs)))
      .catch(() => setVoiceReady(false));
  }, []);

  // Keep the newest step in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // Stop any playing answer when leaving the page.
  useEffect(() => () => audioRef.current?.pause(), []);

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setAudio(null);
  };

  /** Play (or stop) one answer in the twin's voice, through ElevenLabs. */
  const speak = async (turnId: number, answer: string, voiceId?: string) => {
    if (audio?.id === turnId) {
      stopAudio();
      return;
    }
    if (!voiceReady) {
      setVoiceHint(true);
      window.setTimeout(() => setVoiceHint(false), 4500);
      return;
    }
    if (!answer) return;
    answer = stripCites(answer);
    stopAudio();
    setAudio({ id: turnId, status: "loading" });
    try {
      const res = await fetch("/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer, voiceId }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const player = new Audio(url);
      audioRef.current = player;
      player.onended = () => {
        URL.revokeObjectURL(url);
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
  const assign = async (task: string) => {
    if (!twinId || !twin) return t("ask.noTwin");
    const id = ++turnSeq.current;
    setTurns((prev) => [
      ...prev,
      { id, twinId, twinName: twin.name, initials: twin.initials, color: twin.avatarColor, voiceId: twin.ttsVoiceId, question: task, steps: [], thinking: "", answer: null, task: { status: "queued" } },
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

  // Follow handed tasks until they finish.
  const openTasks = turns.filter((turn) => turn.task?.itemId && (turn.task.status === "queued" || turn.task.status === "leased")).length;
  useEffect(() => {
    if (!openTasks) return;
    const poll = async () => {
      try {
        const items = (await fetch("/api/work-items", { cache: "no-store" }).then((r) => r.json())) as { id: string; status: NonNullable<Turn["task"]>["status"]; resultSummary?: string }[];
        const byId = new Map(items.map((i) => [i.id, i]));
        setTurns((prev) =>
          prev.map((turn) => {
            const item = turn.task?.itemId ? byId.get(turn.task.itemId) : undefined;
            if (!item || (item.status === turn.task?.status && item.resultSummary === turn.task?.result)) return turn;
            return { ...turn, task: { ...turn.task!, status: item.status, result: item.resultSummary } };
          }),
        );
      } catch {
        // try again next tick
      }
    };
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [openTasks]);

  const onSubmit = async (question: string) => {
    if (mode === "task") return assign(question);
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
      { id, twinId, twinName: twin.name, initials: twin.initials, color: twin.avatarColor, voiceId: twin.ttsVoiceId, question, steps: [], thinking: "", answer: null },
    ]);
    let answer: string;
    try {
      answer =
        (await askTwin(twinId, question, history, {
          step: (s) =>
            patchTurn(id, (turn) => {
              // The route reports the twin's pre-loaded profile as a burst of Reads: fold them.
              const last = turn.steps[turn.steps.length - 1];
              if (s.label === "Read profile" && last?.label === "Read profile") {
                return { ...turn, steps: [...turn.steps.slice(0, -1), { ...last, detail: t("ask.trace.profileFiles"), done: true }] };
              }
              return { ...turn, steps: [...turn.steps, { ...s, id: ++stepSeq.current, done: false }] };
            }),
          stepDone: () =>
            patchTurn(id, (turn) => ({
              ...turn,
              steps: turn.steps.map((s, i) => (i === turn.steps.length - 1 ? { ...s, done: true } : s)),
            })),
          thinking: (d) => patchTurn(id, (turn) => ({ ...turn, thinking: turn.thinking + d })),
        })) || t("ask.empty");
      answer = tidyCites(answer);
    } catch {
      answer = t("ask.error");
    }
    patchTurn(id, (turn) => ({ ...turn, answer }));
    return answer;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Topbar
        crumbs={[t("nav.ask")]}
        actions={
          voiceReady ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setVoiceOn((v) => !v);
                stopAudio();
              }}
              title={t("ask.voiceTitle")}
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
          <MorphOrb
            onSubmit={onSubmit}
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
                visible={Boolean(flowTurn) && !flowTurn?.task}
                answered={flowTurn?.answer != null}
                questionLabel={t("ask.flow.question")}
                answerLabel={t("ask.flow.answer")}
              />
            }
            onAnswered={(answer) => {
              const last = turns[turns.length - 1];
              if (voiceOn && voiceReady && last) void speak(last.id, answer, last.voiceId);
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
              setBusy(false);
              stopAudio();
            }}
            minThinkMs={2600}
            copy={{
              placeholder: twin ? (mode === "task" ? t("ask.task.placeholder", { name: twin.firstName }) : t("ask.placeholder", { name: twin.firstName })) : t("ask.placeholderAny"),
              labels: [t("ask.l.thinking"), t("ask.l.searching"), t("ask.l.reading"), t("ask.l.composing")],
              done: t("ask.done"),
              answerTitle: twin ? `${twin.name} · ${twin.role}` : t("ask.answer"),
              reset: t("ask.reset"),
              send: t("ask.send"),
              followUp: twin ? t("ask.followUp", { name: twin.firstName }) : t("ask.placeholderAny"),
            }}
          />



          <AnimatePresence>
            {voiceHint && (
              <motion.a
                href="/settings"
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
                <Icons.Volume size={13} /> {t("ask.voiceSetup")}
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
            <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>{t("ask.title")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", padding: "0 16px" }}>
              {twins.map((e) => {
                const active = e.id === twinId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelected(e.id)}
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
            <div role="tablist" style={{ display: "flex", padding: 3, gap: 2, borderRadius: 10, background: "var(--bg-sunken)", border: "1px solid var(--hairline)" }}>
              {(["ask", "task"] as const).map((m) => {
                const on = mode === m;
                return (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={on}
                    type="button"
                    onClick={() => setMode(m)}
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
          </motion.div>
        </div>

        {/* conversation + how the twin got there: 30% */}
        {/* detached like the sidebar: same radius, border, shadow and gutter */}
        <aside
          style={{
            flex: 3,
            minWidth: 300,
            maxWidth: 460,
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

                {turn.task ? <TaskStatus task={turn.task} /> : <Trace turn={turn} live={turn.answer === null} />}

                {turn.answer !== null && (
                  <motion.div
                    dir="auto"
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
  const running = task.status === "queued" || task.status === "leased";
  const tone = task.status === "done" ? "var(--success)" : task.status === "failed" || task.status === "skipped" ? "var(--danger)" : "var(--accent-deep)";
  const label =
    task.status === "queued" ? t("ask.task.queued") : task.status === "leased" ? t("ask.task.working") : task.status === "done" ? t("ask.task.done") : t("ask.task.failed");
  return (
    <motion.div
      layout
      style={{ borderRadius: 12, border: `1px solid ${running ? "color-mix(in oklab, var(--accent) 40%, var(--hairline))" : "var(--hairline)"}`, background: "var(--surface)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}
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
      {task.result && (
        <motion.div dir="auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)", maxHeight: 280, overflowY: "auto" }}>
          <Markdown>{task.result}</Markdown>
        </motion.div>
      )}
      <a href="/tasks" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent-deep)", textDecoration: "none" }}>
        {t("ask.task.open")} →
      </a>
    </motion.div>
  );
}
