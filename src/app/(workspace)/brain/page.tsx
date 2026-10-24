"use client";

// Ask the company: the organization answers with ONE voice. This is not a
// team meeting (twins talking in turn, each in their own voice) and not Ask
// (a conversation with one twin). The router picks the twins who know, they
// write short read-only briefs in parallel, and one answer comes back with
// every claim cited to the twin it came from. The twins appear only as
// sources. (A 3D BrainCosmos version was shelved as overkill: commit 6ed1d6f.)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Topbar } from "@/components/ex/shell";
import { useT } from "@/components/ex/i18n-context";
import { useRoster } from "@/components/ex/roster-context";
import { Icons } from "@/components/ex/icons";
import { CitedAnswer, type CitedSource } from "@/components/ex/cited-answer";
import { SourceCard, type SourceCardData, type SourceLookup } from "@/components/ex/source-card";
import { describeToolCall } from "@/components/ex/morph-orb/tool-nodes";
import { parseCitedAnswer } from "@/lib/org-answer";
import { displayRole } from "@/lib/employees";

type SourceState = {
  kind: SourceCardData["kind"];
  name?: string;
  title?: string;
  status: "working" | "done" | "empty" | "error";
  lookups: SourceLookup[];
  brief: string;
};
type Round = {
  id: number;
  question: string;
  picks: string[];
  sources: Record<string, SourceState>;
  /** Source ids in the order they appeared. */
  order: string[];
  answer: string;
  done: boolean;
  error?: boolean;
};

type OrgEvent = {
  type: string;
  id?: string;
  name?: string;
  title?: string;
  tool?: string;
  input?: unknown;
  picks?: { id: string }[];
  brief?: string;
  empty?: boolean;
  delta?: string;
};

const COLUMN = 740;
const WIDE = 1320;

export default function AskCompanyPage() {
  const { t } = useT();
  const router = useRouter();
  const roster = useRoster();
  const twins = useMemo(() => roster.filter((e) => e.twinStatus === "ready"), [roster]);
  const byId = useMemo(() => new Map(twins.map((e) => [e.id, e])), [twins]);
  const known = useMemo(() => new Set([...twins.map((e) => e.id), "org-brain", "systems"]), [twins]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [input, setInput] = useState("");
  const busy = rounds.length > 0 && !rounds[rounds.length - 1].done;
  // Sources the answer cites under the cursor: lit in the sources column.
  const [lit, setLit] = useState<string[]>([]);
  const onActiveSources = useCallback((ids: string[]) => setLit(ids), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rounds]);

  const patch = (id: number, fn: (r: Round) => Round) => setRounds((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
  const patchSource = (id: number, sid: string, fn: (s: SourceState) => SourceState) =>
    patch(id, (r) => ({
      ...r,
      order: r.order.includes(sid) ? r.order : [...r.order, sid],
      sources: { ...r.sources, [sid]: fn(r.sources[sid] ?? { kind: sid === "org-brain" ? "brain" : sid === "systems" ? "systems" : "twin", status: "working", lookups: [], brief: "" }) },
    }));

  async function ask(raw: string) {
    const question = raw.trim();
    if (!question || busy || twins.length === 0) return;
    setInput("");
    const id = Date.now();
    setRounds((rs) => [...rs, { id, question, picks: [], sources: {}, order: [], answer: "", done: false }]);
    try {
      const res = await fetch("/api/org/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
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
          let evt: OrgEvent;
          try {
            evt = JSON.parse(data) as OrgEvent;
          } catch {
            continue;
          }
          handle(id, evt);
        }
      }
      patch(id, (r) => ({ ...r, done: true }));
    } catch {
      patch(id, (r) => ({ ...r, error: true, done: true }));
    }
  }

  function handle(id: number, evt: OrgEvent) {
    switch (evt.type) {
      case "route":
        patch(id, (r) => ({ ...r, picks: (evt.picks ?? []).map((p) => p.id) }));
        for (const p of evt.picks ?? []) patchSource(id, p.id, (s) => s);
        return;
      case "source_start":
        if (evt.id) patchSource(id, evt.id, (s) => ({ ...s, status: "working", name: evt.name ?? s.name, title: evt.title ?? s.title }));
        return;
      case "source_tool":
        if (evt.id && evt.tool) {
          const d = describeToolCall(evt.tool, (evt.input ?? {}) as Record<string, unknown>);
          patchSource(id, evt.id, (s) => ({ ...s, lookups: [...s.lookups, { label: d.label, detail: d.detail, logo: d.logo }] }));
        }
        return;
      case "source_done":
        if (evt.id) patchSource(id, evt.id, (s) => ({ ...s, status: evt.empty ? "empty" : "done", brief: evt.brief ?? "" }));
        return;
      case "source_error":
        if (evt.id) patchSource(id, evt.id, (s) => ({ ...s, status: "error" }));
        return;
      case "answer_delta":
        patch(id, (r) => ({ ...r, answer: r.answer + (evt.delta ?? "") }));
        return;
      case "error":
        patch(id, (r) => ({ ...r, error: true }));
        return;
    }
  }

  const openTwin = (twinId: string) => router.push(`/ask?twin=${encodeURIComponent(twinId)}`);

  return (
    <>
      <Topbar
        crumbs={[t("nav.orgBrain")]}
        actions={
          rounds.length > 0 && !busy ? (
            <button
              onClick={() => setRounds([])}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--text)", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 600, cursor: "pointer" }}
            >
              <Icons.Plus size={12} /> {t("org.new")}
            </button>
          ) : undefined
        }
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ maxWidth: rounds.length ? WIDE : COLUMN, margin: "0 auto", padding: "32px 28px 28px", display: "flex", flexDirection: "column", gap: 48 }}>
            {rounds.length === 0 && (
              <header style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: "var(--fs-h2)", fontWeight: 650, letterSpacing: "-0.02em", color: "var(--text)" }}>{t("org.title")}</h1>
                  <p style={{ margin: "6px 0 0", fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>{t("org.subtitle")}</p>
                </div>
                {twins.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                    {t("org.noTwin")}{" "}
                    <Link href="/employees" style={{ color: "var(--accent-deep)", fontWeight: 600 }}>
                      {t("nav.twins")}
                    </Link>
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[t("org.s1"), t("org.s2"), t("org.s3")].map((s, i) => (
                      <motion.button
                        key={s}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.08 + i * 0.06 }}
                        onClick={() => void ask(s)}
                        style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "start", padding: "11px 14px", borderRadius: 12, cursor: "pointer", font: "inherit", fontSize: "var(--fs-sm)", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--hairline)" }}
                      >
                        <Icons.Search size={14} />
                        {s}
                      </motion.button>
                    ))}
                  </div>
                )}
              </header>
            )}

            {rounds.map((r) => {
              const cards: SourceCardData[] = r.order.map((sid) => {
                const st = r.sources[sid];
                const e = byId.get(sid);
                return {
                  id: sid,
                  kind: st.kind,
                  name: e?.firstName ?? st.name ?? sid,
                  title: e ? displayRole(e) : st.title ?? "",
                  initials: e?.initials,
                  color: e?.avatarColor,
                  status: st.status,
                  lookups: st.lookups,
                  brief: st.brief,
                };
              });
              const sources: CitedSource[] = cards.map((c) => ({
                id: c.id,
                name: c.name,
                title: c.title,
                initials: c.initials ?? c.name.charAt(0),
                color: c.color ?? "var(--accent-soft)",
                snippet: c.brief.replace(/\*\*/g, ""),
              }));
              const writing = !r.done && r.answer.length > 0;
              const doneCount = cards.filter((c) => c.status !== "working").length;
              const phase = r.done ? t("org.orb.done") : writing ? t("org.orb.writing") : r.order.length ? t("org.orb.gathering", { count: cards.length }) : t("org.routing");
              const isLatest = r.id === rounds[rounds.length - 1].id;
              return (
                <article key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 32, alignItems: "start" }}>
                  {/* ── the answer ── */}
                  <section style={{ position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
                    <h2 dir="auto" style={{ margin: 0, fontSize: "var(--fs-h2)", fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25, color: "var(--text)" }}>
                      {r.question}
                    </h2>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <MiniOrb state={r.done ? "done" : writing ? "writing" : "gathering"} />
                      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 650, color: "var(--text)" }}>{phase}</span>
                        {cards.length > 0 && (
                          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>{t("org.progress", { done: doneCount, total: cards.length })}</span>
                        )}
                      </div>
                    </div>
                    {r.answer ? (
                      <CitedAnswer
                        parts={parseCitedAnswer(r.answer, known)}
                        sources={sources}
                        streaming={writing}
                        onOpenSource={openTwin}
                        onActiveSources={isLatest ? onActiveSources : undefined}
                        sourcesLabel={(count) => t("org.sources", { count })}
                        showList={false}
                      />
                    ) : (
                      !r.done && <AnswerSkeleton />
                    )}
                    {r.error && <div style={{ fontSize: "var(--fs-xs)", color: "var(--danger)" }}>{t("org.error")}</div>}
                  </section>

                  {/* ── the sources, live ── */}
                  <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "var(--fs-sm)", fontWeight: 650, color: "var(--text)" }}>{t("org.sourcesTitle")}</span>
                      {cards.length > 0 && <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>{t("org.sources", { count: cards.length })}</span>}
                    </div>
                    {cards.length === 0 && !r.done && <Pulse label={t("org.routing")} />}
                    {cards.map((c, i) => (
                      <SourceCard key={c.id} index={i} s={c} lit={isLatest && lit.includes(c.id)} onOpen={c.kind === "twin" ? () => openTwin(c.id) : undefined} />
                    ))}
                  </section>
                </article>
              );
            })}
          </div>
        </div>

        {twins.length > 0 && (
          <div style={{ flexShrink: 0, borderTop: "1px solid var(--hairline)", background: "var(--bg)", padding: "12px 24px 16px" }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
              style={{ maxWidth: COLUMN, margin: "0 auto", display: "flex", alignItems: "center", gap: 8, padding: 6, paddingInlineStart: 16, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--hairline)" }}
            >
              <Icons.Search size={15} />
              <input
                dir="auto"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy}
                placeholder={rounds.length ? t("org.followUp") : t("org.placeholder")}
                aria-label={t("org.placeholder")}
                style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", font: "inherit", fontSize: "var(--fs-base)", color: "var(--text)", padding: "8px 0" }}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label={t("org.send")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "none", cursor: busy || !input.trim() ? "default" : "pointer", font: "inherit", fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--bg)", background: input.trim() && !busy ? "var(--text)" : "var(--hairline-strong)" }}
              >
                {busy ? (
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} style={{ display: "inline-flex" }}>
                    <Icons.Loader size={14} />
                  </motion.span>
                ) : (
                  <Icons.Send size={14} />
                )}
                {t("org.send")}
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}

function MiniOrb({ state }: { state: "gathering" | "writing" | "done" }) {
  return (
    <span style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: state === "writing" ? 1.2 : state === "done" ? 12 : 3.5, repeat: Infinity, ease: "linear" }}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: state === "done" ? "var(--success)" : "conic-gradient(from 0deg, var(--accent), var(--twin), var(--warn), var(--accent))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
        }}
      />
      <span style={{ position: "absolute", inset: 7, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--bg-sunken)", color: state === "done" ? "var(--success)" : "var(--accent-deep)" }}>
        {state === "done" ? <Icons.Check size={12} /> : <Icons.Spark size={12} />}
      </span>
    </span>
  );
}

function AnswerSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[92, 100, 78, 96, 64].map((w, i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.35, 0.8, 0.35] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.12 }}
          style={{ height: 12, width: `${w}%`, borderRadius: 6, background: "var(--bg-sunken)" }}
        />
      ))}
    </div>
  );
}

function Pulse({ label }: { label: string }) {
  return (
    <AnimatePresence>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}
      >
        <motion.span animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.1, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
        {label}…
      </motion.span>
    </AnimatePresence>
  );
}
