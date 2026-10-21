"use client";

// The organization brain: ask the whole company one question. A router picks
// the twins who know (keywords, Haiku when unsure) and a team meeting runs
// with them. The company is drawn as one BrainCosmos (company hub, twins,
// shared tools): impulses run from the hub to each twin while it works, a tool
// node lights when it is used, and a twin that answered sends a shockwave.
// Answers stream into the thread on the side. Clicking a twin opens Ask.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Topbar } from "@/components/ex/shell";
import { useT } from "@/components/ex/i18n-context";
import { useRoster } from "@/components/ex/roster-context";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { BrainCosmos, canRenderCosmos } from "@/components/ex/brain-cosmos";
import { ObsidianGraph, type GraphHighlightState } from "@/components/ex/obsidian-graph";
import type { OrgGraph } from "@/lib/org-graph";
import { describeToolCall, type ToolNodeStep } from "@/components/ex/morph-orb/tool-nodes";

type Status = "waiting" | "thinking" | "working" | "done" | "error";
type Answer = { status: Status; text: string; thinking: string; tools: Omit<ToolNodeStep, "id">[]; calledInBy?: string };
type Round = {
  id: number;
  question: string;
  routing: boolean;
  picks: { id: string; why: string[] }[];
  order: string[];
  answers: Record<string, Answer>;
  error?: boolean;
  done: boolean;
};

type CouncilEvent = {
  type: string;
  employeeId?: string;
  delta?: string;
  tool?: string;
  input?: unknown;
  fromId?: string;
  toId?: string;
  fromName?: string;
  approvalId?: string;
  meetingId?: string;
};

const NEW_ANSWER: Answer = { status: "waiting", text: "", thinking: "", tools: [] };
const NO_HIGHLIGHT: GraphHighlightState = { reading: new Set(), recentlyTouched: new Set(), cited: new Set() };

const noopSubscribe = () => () => {};

/** Lower-case alphanumerics, same rule as toolKey() in lib/org-graph. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const mono = "var(--font-mono, ui-monospace, monospace)";

export default function OrgBrainPage() {
  const { t } = useT();
  const roster = useRoster();
  const twins = useMemo(() => roster.filter((e) => e.twinStatus === "ready"), [roster]);
  const colorOf = useMemo(() => new Map(twins.map((e) => [e.id, e.avatarColor])), [twins]);
  const byId = useMemo(() => new Map(twins.map((e) => [e.id, e])), [twins]);

  const router = useRouter();
  const [graph, setGraph] = useState<OrgGraph | null>(null);
  const cosmos = useSyncExternalStore(noopSubscribe, canRenderCosmos, () => false);
  const [hl, setHl] = useState<GraphHighlightState>(NO_HIGHLIGHT);
  const graphRef = useRef<OrgGraph | null>(null);
  const meetingId = useRef<string | undefined>(undefined);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [input, setInput] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/org/graph")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((g: OrgGraph) => {
        if (cancelled) return;
        graphRef.current = g;
        setGraph(g);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── graph highlights driven by the meeting ──
  const nodeOfTwin = (id: string) =>
    Object.entries(graphRef.current?.refs ?? {}).find(([, r]) => r.kind === "twin" && r.id === id)?.[0];
  const nodeOfTool = (tool: string, input: Record<string, unknown>) => {
    const refs = Object.entries(graphRef.current?.refs ?? {});
    const byKey = (k: string) => refs.find(([, r]) => r.kind === "tool" && r.key === k)?.[0];
    if (tool === "WebSearch" || tool === "WebFetch") return byKey("web");
    if (tool.startsWith("mcp__org_brain") || String(input.file_path ?? input.path ?? "").includes("org-brain")) return byKey("companybrain");
    const mcp = /^mcp__(.+?)__/.exec(tool);
    return mcp ? byKey(key(mcp[1])) : undefined;
  };
  const light = (names: (string | undefined)[]) =>
    setHl((s) => ({ ...s, reading: new Set([...s.reading, ...names.filter((n): n is string => Boolean(n))]) }));
  const flash = (name: string | undefined) => {
    if (!name) return;
    setHl((s) => {
      const reading = new Set(s.reading);
      reading.delete(name); // re-adding fires a fresh impulse
      return { ...s, reading };
    });
    setTimeout(() => light([name]), 30);
    setTimeout(() => {
      setHl((s) => {
        const reading = new Set(s.reading);
        reading.delete(name);
        return { ...s, reading, recentlyTouched: new Set([...s.recentlyTouched, name]) };
      });
    }, 1400);
  };
  const cite = (name: string | undefined) => {
    if (!name) return;
    setHl((s) => {
      const reading = new Set(s.reading);
      reading.delete(name);
      return { ...s, reading, cited: new Set([...s.cited, name]) };
    });
  };

  const busy = rounds.length > 0 && !rounds[rounds.length - 1].done;
  const live = rounds[rounds.length - 1];

  const patch = (id: number, fn: (r: Round) => Round) => setRounds((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
  const patchAnswer = (id: number, twinId: string, fn: (a: Answer) => Answer) =>
    patch(id, (r) => {
      const order = r.order.includes(twinId) ? r.order : [...r.order, twinId];
      return { ...r, order, answers: { ...r.answers, [twinId]: fn(r.answers[twinId] ?? NEW_ANSWER) } };
    });

  async function ask(raw: string) {
    const question = raw.trim();
    if (!question || busy || twins.length === 0) return;
    setInput("");
    const id = Date.now();
    setRounds((rs) => [...rs, { id, question, routing: true, picks: [], order: [], answers: {}, done: false }]);
    setHl(NO_HIGHLIGHT);

    try {
      const routed = await fetch("/api/org/router", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      }).then((r) => r.json() as Promise<{ picks?: { id: string; matched: string[] }[] }>);
      const picks = (routed.picks ?? []).map((p) => ({ id: p.id, why: p.matched }));
      if (picks.length === 0) throw new Error("no route");
      light(picks.map((p) => nodeOfTwin(p.id)));
      patch(id, (r) => ({
        ...r,
        routing: false,
        picks,
        order: picks.map((p) => p.id),
        answers: Object.fromEntries(picks.map((p) => [p.id, NEW_ANSWER])),
      }));

      const res = await fetch("/api/council/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, employeeIds: picks.map((p) => p.id), meetingId: meetingId.current }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
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
          let evt: CouncilEvent;
          try {
            evt = JSON.parse(data) as CouncilEvent;
          } catch {
            continue;
          }
          handle(id, evt);
        }
      }
      patch(id, (r) => ({ ...r, done: true }));
    } catch {
      patch(id, (r) => ({ ...r, routing: false, error: true, done: true }));
    }
  }

  function handle(id: number, evt: CouncilEvent) {
    const who = evt.employeeId;
    switch (evt.type) {
      case "meeting":
        meetingId.current = evt.meetingId;
        return;
      case "employee_start":
        if (!who) return;
        light([nodeOfTwin(who)]);
        patchAnswer(id, who, (a) => ({ ...a, status: "thinking" }));
        return;
      case "tool_use":
        if (!who || !evt.tool) return;
        flash(nodeOfTool(evt.tool, (evt.input ?? {}) as Record<string, unknown>));
        patchAnswer(id, who, (a) => ({
          ...a,
          status: "working",
          tools: [...a.tools, describeToolCall(evt.tool!, (evt.input ?? {}) as Record<string, unknown>)],
        }));
        return;
      case "thinking_delta":
        if (!who) return;
        patchAnswer(id, who, (a) => ({ ...a, thinking: a.thinking + (evt.delta ?? "") }));
        return;
      case "text_delta":
        if (!who) return;
        patchAnswer(id, who, (a) => ({ ...a, text: a.text + (evt.delta ?? "") }));
        return;
      case "delegation":
        if (!evt.fromId || !evt.toId) return;
        light([nodeOfTwin(evt.toId)]);
        patchAnswer(id, evt.toId, (a) => ({ ...a, calledInBy: evt.fromName }));
        return;
      case "employee_done":
        if (!who) return;
        cite(nodeOfTwin(who));
        patchAnswer(id, who, (a) => ({ ...a, status: "done" }));
        return;
      case "employee_error":
        if (!who) return;
        cite(nodeOfTwin(who));
        patchAnswer(id, who, (a) => ({ ...a, status: "error" }));
        return;
      case "tool_approval_request":
      case "clarification_request":
        // Asking the company is read-only: decline actions and questions back,
        // the twin answers with what it knows. Actions go through Ask or Team Meeting.
        if (evt.approvalId) {
          void fetch("/api/council/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              approvalId: evt.approvalId,
              action: "deny",
              message: "Read-only question to the company. Don't take actions or ask back; answer with what you know and state your assumptions.",
            }),
          });
        }
        return;
      case "error":
        patch(id, (r) => ({ ...r, error: true }));
        return;
    }
  }

  // Clicking a twin in the brain opens it in Ask; other nodes do nothing.
  const openNode = (name: string) => {
    const ref = graphRef.current?.refs[name];
    if (ref?.kind === "twin") router.push(`/ask?twin=${encodeURIComponent(ref.id)}`);
  };

  return (
    <>
      <Topbar
        crumbs={[t("nav.orgBrain")]}
        actions={
          rounds.length > 0 && !busy ? (
            <button
              onClick={() => {
                setRounds([]);
                meetingId.current = undefined;
                setHl(NO_HIGHLIGHT);
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text)", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 600, cursor: "pointer" }}
            >
              <Icons.Plus size={12} /> {t("org.new")}
            </button>
          ) : undefined
        }
      />
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(340px, 30%)", gap: 12, padding: 12, background: "var(--bg)" }}>
        {/* ── the stage: always a dark window into the company, like BrainCosmos ── */}
        <section
          style={{
            position: "relative",
            minHeight: 0,
            borderRadius: 18,
            overflow: "clip",
            background: "radial-gradient(120% 90% at 50% 45%, #140d08 0%, #070504 60%, #030202 100%)",
            border: "1px solid var(--hairline)",
          }}
        >
          {/* the company as one brain: BrainCosmos, unchanged, fed the org graph */}
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
            {cosmos ? (
              <BrainCosmos graph={graph} state={hl} onOpenFile={openNode} loading={!graph} />
            ) : (
              <ObsidianGraph graph={graph} state={hl} onOpenFile={openNode} loading={!graph} />
            )}
          </div>

          {/* title */}
          <div style={{ position: "absolute", top: 18, insetInlineStart: 20, maxWidth: 420, pointerEvents: "none" }}>
            <h1 style={{ margin: 0, fontSize: "var(--fs-h3)", fontWeight: 650, letterSpacing: "-0.02em", color: "#fff3e6" }}>{t("org.title")}</h1>
            <p style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)", color: "rgba(255,226,184,0.62)", lineHeight: 1.45 }}>{t("org.subtitle")}</p>
          </div>

          {/* routing status */}
          <AnimatePresence>
            {live && (live.routing || live.picks.length > 0) && !live.done && (
              <motion.div
                key={live.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                style={{
                  position: "absolute",
                  top: 18,
                  insetInlineEnd: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "rgba(20,13,8,0.7)",
                  border: "1px solid rgba(255,226,184,0.18)",
                  color: "#fff3e6",
                  fontSize: 12,
                }}
              >
                <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffb36b" }} />
                {live.routing ? (
                  t("org.routing")
                ) : (
                  <>
                    <span style={{ color: "rgba(255,226,184,0.6)" }}>{t("org.routedTo")}</span>
                    {live.order.map((tid) => (
                      <span key={tid} style={{ fontWeight: 650, color: colorOf.get(tid) }}>
                        <bdi>{byId.get(tid)?.firstName ?? tid}</bdi>
                      </span>
                    ))}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* the input, fixed at the bottom of the stage */}
          <div style={{ position: "absolute", insetInline: 0, bottom: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "0 20px", pointerEvents: "none" }}>
            {rounds.length === 0 && twins.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, maxWidth: 760, pointerEvents: "auto" }}>
                {[t("org.s1"), t("org.s2"), t("org.s3")].map((s, i) => (
                  <motion.button
                    key={s}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.6 + i * 0.12 }}
                    whileHover={{ y: -2 }}
                    onClick={() => void ask(s)}
                    style={{ padding: "7px 12px", borderRadius: 999, cursor: "pointer", font: "inherit", fontSize: 12.5, color: "rgba(255,243,230,0.85)", background: "rgba(255,226,184,0.07)", border: "1px solid rgba(255,226,184,0.16)" }}
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            )}
            {twins.length === 0 ? (
              <div style={{ pointerEvents: "auto", color: "rgba(255,226,184,0.75)", fontSize: "var(--fs-sm)" }}>
                {t("org.noTwin")}{" "}
                <Link href="/employees" style={{ color: "#ffb36b", fontWeight: 600 }}>
                  {t("nav.twins")}
                </Link>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(input);
                }}
                style={{
                  pointerEvents: "auto",
                  width: "min(640px, 100%)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 6,
                  paddingInlineStart: 18,
                  borderRadius: 999,
                  background: "rgba(255,243,230,0.08)",
                  border: "1px solid rgba(255,226,184,0.2)",
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                  boxShadow: busy ? "0 0 0 4px rgba(255,179,107,0.12), 0 20px 50px -20px rgba(255,157,77,0.5)" : "0 20px 50px -24px rgba(0,0,0,0.8)",
                  transition: "box-shadow .4s",
                }}
              >
                <input
                  dir="auto"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={busy}
                  placeholder={rounds.length ? t("org.followUp") : t("org.placeholder")}
                  aria-label={t("org.placeholder")}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", font: "inherit", fontSize: 15, color: "#fff3e6", padding: "8px 0" }}
                />
                <motion.button
                  type="submit"
                  disabled={busy || !input.trim()}
                  whileTap={{ scale: 0.95 }}
                  aria-label={t("org.send")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "9px 16px",
                    borderRadius: 999,
                    border: "none",
                    cursor: busy || !input.trim() ? "default" : "pointer",
                    font: "inherit",
                    fontSize: 13,
                    fontWeight: 650,
                    color: "#1a120c",
                    background: input.trim() && !busy ? "linear-gradient(135deg, #ffd27a, #ff9d4d)" : "rgba(255,226,184,0.25)",
                  }}
                >
                  {busy ? (
                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} style={{ display: "inline-flex" }}>
                      <Icons.Loader size={14} />
                    </motion.span>
                  ) : (
                    <Icons.Send size={14} />
                  )}
                  {t("org.send")}
                </motion.button>
              </form>
            )}
          </div>
        </section>

        <Thread rounds={rounds} byId={byId} colorOf={colorOf} />
      </div>
    </>
  );
}

// ─── The thread: every question and every twin's answer ─────────────────────

function Thread({
  rounds,
  byId,
  colorOf,
}: {
  rounds: Round[];
  byId: Map<string, { firstName: string; role: string; initials: string }>;
  colorOf: Map<string, string>;
}) {
  const { t } = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rounds]);

  return (
    <aside style={{ minHeight: 0, display: "flex", flexDirection: "column", borderRadius: 18, background: "var(--surface)", border: "1px solid var(--hairline)", overflow: "clip" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--hairline)", fontSize: "var(--fs-sm)", fontWeight: 650, color: "var(--text)" }}>{t("org.thread")}</div>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 18 }}>
        {rounds.length === 0 && <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.55 }}>{t("org.threadEmpty")}</p>}
        {rounds.map((r) => (
          <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div dir="auto" style={{ alignSelf: "flex-end", maxWidth: "88%", padding: "8px 12px", borderRadius: "14px 14px 4px 14px", background: "var(--bg-sunken)", border: "1px solid var(--hairline)", fontSize: "var(--fs-sm)", color: "var(--text)", lineHeight: 1.45 }}>
              {r.question}
            </div>
            {r.picks.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, color: "var(--text-subtle)" }}>
                {r.picks.map((p) => (
                  <span key={p.id} style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid var(--hairline)" }}>
                    <span style={{ fontWeight: 650, color: "var(--text-muted)" }}>
                      <bdi>{byId.get(p.id)?.firstName ?? p.id}</bdi>
                    </span>
                    {p.why.length > 0 && <> · {p.why.join(", ")}</>}
                  </span>
                ))}
              </div>
            )}
            {r.order.map((tid) => (
              <AnswerCard key={tid} twin={byId.get(tid)} color={colorOf.get(tid) ?? "var(--accent)"} answer={r.answers[tid] ?? NEW_ANSWER} />
            ))}
            {r.error && <div style={{ fontSize: "var(--fs-xs)", color: "var(--danger)" }}>{t("org.error")}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function AnswerCard({ twin, color, answer }: { twin?: { firstName: string; role: string; initials: string }; color: string; answer: Answer }) {
  const { t } = useT();
  const working = answer.status === "thinking" || answer.status === "working";
  const tools = answer.tools.slice(-4);
  const thought = answer.thinking.length > 220 ? `…${answer.thinking.slice(-220)}` : answer.thinking;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        borderRadius: 14,
        border: "1px solid var(--hairline)",
        borderInlineStart: `3px solid ${color}`,
        background: "var(--bg-elevated)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#1a120c", background: color, flexShrink: 0 }}>{twin?.initials}</span>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontSize: "var(--fs-sm)", fontWeight: 650, color: "var(--text)" }}>
            <bdi>{twin?.firstName}</bdi>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {answer.calledInBy ? t("org.calledIn", { from: answer.calledInBy, to: twin?.firstName ?? "" }) : <bdi>{twin?.role}</bdi>}
          </div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: answer.status === "done" ? "var(--success)" : answer.status === "error" ? "var(--danger)" : "var(--text-muted)" }}>
          {working && <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.1, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />}
          {answer.status === "done"
            ? t("org.status.done")
            : answer.status === "error"
              ? t("org.status.error")
              : answer.status === "waiting"
                ? t("org.status.waiting")
                : answer.tools.length
                  ? t("org.status.working", { count: answer.tools.length })
                  : t("org.status.thinking")}
        </span>
      </div>

      {tools.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {tools.map((s, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px 2px 4px", borderRadius: 999, background: "var(--bg-sunken)", border: "1px solid var(--hairline)", fontSize: 11, color: "var(--text-muted)", maxWidth: "100%" }}>
              {s.logo ? <ToolkitIcon slug={s.logo} size={13} /> : <Icons.Zap size={11} />}
              <span style={{ fontWeight: 600, color: "var(--text)" }}>{s.label}</span>
              {s.detail && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: mono, fontSize: 10 }}>{s.detail}</span>}
            </span>
          ))}
        </div>
      )}

      {working && !answer.text && thought && (
        <div dir="auto" style={{ fontSize: 12, fontStyle: "italic", color: "var(--text-subtle)", lineHeight: 1.5 }}>
          {thought}
        </div>
      )}

      {answer.text && (
        <div dir="auto" style={{ fontSize: "var(--fs-sm)", color: "var(--text)", lineHeight: 1.55 }}>
          <Markdown>{answer.text}</Markdown>
        </div>
      )}
    </motion.div>
  );
}
