"use client";

// Ask the company: the organization answers with ONE voice. This is not a
// team meeting (twins talking in turn, each in their own voice) and not Ask
// (a conversation with one twin). The router picks the twins who know, they
// write short read-only briefs in parallel, and one answer comes back with
// every claim cited to the twin it came from. The twins appear only as
// sources. (A 3D BrainCosmos version was shelved as overkill: commit 6ed1d6f.)

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Topbar } from "@/components/ex/shell";
import { useT } from "@/components/ex/i18n-context";
import { useRoster } from "@/components/ex/roster-context";
import { Icons } from "@/components/ex/icons";
import { CitedAnswer, type CitedSource } from "@/components/ex/cited-answer";
import { parseCitedAnswer } from "@/lib/org-answer";

type SourceState = { status: "working" | "done" | "empty" | "error"; tools: number; brief: string };
type Round = {
  id: number;
  question: string;
  picks: string[];
  sources: Record<string, SourceState>;
  answer: string;
  done: boolean;
  error?: boolean;
};

type OrgEvent = {
  type: string;
  id?: string;
  picks?: { id: string }[];
  brief?: string;
  empty?: boolean;
  delta?: string;
};

const COLUMN = 740;

export default function AskCompanyPage() {
  const { t } = useT();
  const router = useRouter();
  const roster = useRoster();
  const twins = useMemo(() => roster.filter((e) => e.twinStatus === "ready"), [roster]);
  const byId = useMemo(() => new Map(twins.map((e) => [e.id, e])), [twins]);
  const known = useMemo(() => new Set(twins.map((e) => e.id)), [twins]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [input, setInput] = useState("");
  const busy = rounds.length > 0 && !rounds[rounds.length - 1].done;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rounds]);

  const patch = (id: number, fn: (r: Round) => Round) => setRounds((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
  const patchSource = (id: number, twinId: string, fn: (s: SourceState) => SourceState) =>
    patch(id, (r) => ({ ...r, sources: { ...r.sources, [twinId]: fn(r.sources[twinId] ?? { status: "working", tools: 0, brief: "" }) } }));

  async function ask(raw: string) {
    const question = raw.trim();
    if (!question || busy || twins.length === 0) return;
    setInput("");
    const id = Date.now();
    setRounds((rs) => [...rs, { id, question, picks: [], sources: {}, answer: "", done: false }]);
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
        return;
      case "source_start":
        if (evt.id) patchSource(id, evt.id, (s) => ({ ...s, status: "working" }));
        return;
      case "source_tool":
        if (evt.id) patchSource(id, evt.id, (s) => ({ ...s, tools: s.tools + 1 }));
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
          <div style={{ maxWidth: COLUMN, margin: "0 auto", padding: "36px 24px 28px", display: "flex", flexDirection: "column", gap: 36 }}>
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
              const sources: CitedSource[] = r.picks
                .map((pid) => byId.get(pid))
                .filter((e): e is NonNullable<typeof e> => Boolean(e))
                .map((e) => ({ id: e.id, name: e.firstName, title: e.role, initials: e.initials, color: e.avatarColor, snippet: r.sources[e.id]?.brief.replace(/\*\*/g, "") }));
              const writing = !r.done && r.answer.length > 0;
              const gathering = !r.done && r.answer.length === 0;
              return (
                <article key={r.id} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <h2 dir="auto" style={{ margin: 0, fontSize: "var(--fs-h3)", fontWeight: 650, letterSpacing: "-0.015em", lineHeight: 1.3, color: "var(--text)" }}>
                    {r.question}
                  </h2>

                  {/* the sources: who the company asked, and where each one is */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {r.picks.length === 0 && !r.done && <Pulse label={t("org.routing")} />}
                    {sources.map((src) => {
                      const st = r.sources[src.id];
                      const status = st?.status ?? "working";
                      return (
                        <motion.button
                          key={src.id}
                          layout
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: status === "empty" || status === "error" ? 0.5 : 1, scale: 1 }}
                          onClick={() => openTwin(src.id)}
                          title={`${src.name} · ${src.title}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 5px", borderRadius: 999, cursor: "pointer", font: "inherit", background: "var(--surface)", border: "1px solid var(--hairline)" }}
                        >
                          <span style={{ position: "relative", width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "var(--text)", background: src.color }}>
                            {src.initials}
                            {status === "working" && (
                              <motion.span
                                animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
                                transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
                                style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--accent)" }}
                              />
                            )}
                          </span>
                          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--text)" }}>
                            <bdi>{src.name}</bdi>
                          </span>
                          <span style={{ fontSize: 11, color: status === "done" ? "var(--success)" : "var(--text-subtle)" }}>
                            {status === "working"
                              ? st?.tools
                                ? t("org.source.tools", { count: st.tools })
                                : t("org.source.working")
                              : status === "done"
                                ? "✓"
                                : t("org.source.empty")}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* the answer: one voice, every claim cited */}
                  {gathering && r.picks.length > 0 && <Pulse label={t("org.gathering")} />}
                  {(writing || r.done) && r.answer && (
                    <CitedAnswer
                      parts={parseCitedAnswer(r.answer, known)}
                      sources={sources}
                      streaming={writing}
                      onOpenSource={openTwin}
                      sourcesLabel={(count) => t("org.sources", { count })}
                    />
                  )}
                  {r.error && <div style={{ fontSize: "var(--fs-xs)", color: "var(--danger)" }}>{t("org.error")}</div>}
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
