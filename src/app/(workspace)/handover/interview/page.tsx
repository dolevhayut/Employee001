"use client";

// Relay · the departing employee's handover interview. They answer the
// interviewer's questions (the transcript is saved as they go, so they can
// stop and come back), choose whether their twin stays after they leave, then
// build and review the handover notes. An admin approves them on /handover.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/ex/shell";
import { useT } from "@/components/ex/i18n-context";
import { PackageReview, type HandoverState, type Message } from "@/components/relay/package-review";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: "var(--sp-16)" };
const primary: React.CSSProperties = { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: "var(--fs-ui)", cursor: "pointer" };
const secondary: React.CSSProperties = { background: "transparent", color: "var(--text)", border: "1px solid var(--hairline)", borderRadius: 8, padding: "8px 16px", fontSize: "var(--fs-ui)", cursor: "pointer" };

async function readSse(res: Response, onDelta: (d: string) => void): Promise<Message[]> {
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "The interviewer didn't answer. Try again.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const ev = JSON.parse(line.slice(5).trim()) as { type: string; delta?: string; messages?: Message[]; message?: string };
      if (ev.type === "text_delta" && ev.delta) onDelta(ev.delta);
      else if (ev.type === "error") throw new Error(ev.message ?? "Interview turn failed");
      else if (ev.type === "done" && ev.messages) return ev.messages;
    }
  }
  throw new Error("The interview stream ended early. Try again.");
}

async function fetchState(employeeId: string): Promise<{ state?: HandoverState; error?: string }> {
  const res = await fetch(`/api/relay/${encodeURIComponent(employeeId)}`, { cache: "no-store" });
  if (res.ok) return { state: (await res.json()) as HandoverState };
  return { error: res.status === 404 ? "No twin found for this link." : "You don't have access to this handover." };
}

function RetentionChoice({ state, onChange }: { state: HandoverState; onChange: (s: HandoverState) => void }) {
  const { t, locale } = useT();
  const [busy, setBusy] = useState(false);
  const decided = state.retention ? "yes" : state.retentionDeclinedAt ? "no" : null;
  async function choose(agree: boolean) {
    setBusy(true);
    const res = await fetch(`/api/relay/${encodeURIComponent(state.employeeId)}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agree, locale }),
    });
    if (res.ok) onChange((await res.json()) as HandoverState);
    setBusy(false);
  }
  return (
    <div style={card}>
      <div style={{ fontSize: "var(--fs-lg)", fontWeight: 600, marginBottom: 6 }}>{t("relayConsent.title")}</div>
      <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", lineHeight: 1.55, margin: "0 0 var(--sp-12)" }}>{t("relayConsent.body")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {([true, false] as const).map((agree) => {
          const selected = decided === (agree ? "yes" : "no");
          return (
            <label key={String(agree)} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: "var(--fs-base)", cursor: busy ? "wait" : "pointer" }}>
              <input type="radio" name="retention" checked={selected} disabled={busy} onChange={() => choose(agree)} />
              {t(agree ? "relayConsent.agree" : "relayConsent.decline")}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function InterviewInner() {
  const { t } = useT();
  const employeeId = useSearchParams().get("employee") ?? "";
  const [state, setState] = useState<HandoverState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState<"turn" | "build" | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const apply = useCallback((r: { state?: HandoverState; error?: string }) => {
    if (r.state) setState(r.state);
    else setLoadError(r.error ?? null);
  }, []);
  const load = useCallback(async () => {
    if (employeeId) apply(await fetchState(employeeId));
  }, [employeeId, apply]);
  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    fetchState(employeeId).then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [employeeId, apply]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [state?.messages.length, streaming]);

  const turn = useCallback(
    async (answer?: string) => {
      if (!state) return;
      setBusy("turn");
      setError(null);
      setStreaming("");
      if (answer) setState({ ...state, messages: [...state.messages, { role: "user", content: answer }] });
      try {
        const res = await fetch(`/api/relay/${encodeURIComponent(state.employeeId)}/interview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(answer ? { answer } : {}),
        });
        const messages = await readSse(res, (d) => setStreaming((s) => s + d));
        setState((s) => (s ? { ...s, messages } : s));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Interview turn failed");
        // Resync with what the server saved; keep the answer for a retry.
        if (answer) setInput(answer);
        await load();
      } finally {
        setStreaming("");
        setBusy(null);
      }
    },
    [state, load],
  );

  async function build() {
    if (!state) return;
    setBusy("build");
    setError(null);
    const res = await fetch(`/api/relay/${encodeURIComponent(state.employeeId)}/synthesize`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) setError(data.error ?? "Couldn't build the notes.");
    await load();
    setBusy(null);
  }

  async function edit(body: Record<string, unknown>) {
    if (!state) return;
    const res = await fetch(`/api/relay/${encodeURIComponent(state.employeeId)}/package`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setState((await res.json()) as HandoverState);
    else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save.");
  }

  if (!employeeId) return <div style={{ padding: 24 }}>This link is missing the employee. Ask your admin for the interview link.</div>;
  if (loadError) return <div style={{ padding: 24 }}>{loadError}</div>;
  if (!state) return <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading…</div>;

  const open = state.lifecycle === "handover";
  const answers = state.messages.filter((m) => m.role === "user").length;
  const lastIsAnswer = state.messages.at(-1)?.role === "user";

  return (
    <div className="scrollbar" style={{ flex: 1, overflowY: "auto", padding: "var(--sp-24, 24px)" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-16)" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-h3)", margin: "0 0 6px" }}>Handover interview: {state.name}</h1>
          <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", lineHeight: 1.55, margin: 0 }}>{t("relayConsent.interview")}</p>
        </div>

        {!open && (
          <div style={card}>
            {state.lifecycle === "retired" ? "This handover is complete." : "There\u2019s no open handover for this twin. An admin starts it on the Relay page."}
          </div>
        )}
        {open && !state.model.ok && <div style={{ ...card, color: "var(--danger)" }}>The model isn&rsquo;t set up: {state.model.reason}</div>}
        {error && <div style={{ ...card, color: "var(--danger)", borderColor: "var(--danger)" }}>{error}</div>}

        {open && <RetentionChoice state={state} onChange={setState} />}

        {open && (
          <div style={card}>
            <div ref={feedRef} className="scrollbar" style={{ maxHeight: 460, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {state.messages.length === 0 && !streaming && (
                <div style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", lineHeight: 1.55 }}>
                  About 20 to 30 minutes of questions about how you do your work. You can stop any time and come back to this page.
                </div>
              )}
              {state.messages.map((m, i) => (
                <Bubble key={i} role={m.role} text={m.content} />
              ))}
              {streaming && <Bubble role="assistant" text={streaming} live />}
            </div>
            <div style={{ marginTop: "var(--sp-12)" }}>
              {state.messages.length === 0 || lastIsAnswer ? (
                <button style={primary} disabled={busy !== null || !state.model.ok} onClick={() => turn()}>
                  {busy === "turn" ? "…" : state.messages.length === 0 ? "Start the interview" : "Ask the next question"}
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && input.trim() && !busy) {
                        e.preventDefault();
                        const a = input.trim();
                        setInput("");
                        void turn(a);
                      }
                    }}
                    placeholder="Your answer (⌘/Ctrl + Enter to send)"
                    disabled={busy !== null}
                    rows={3}
                    style={{ flex: 1, background: "var(--surface-soft)", color: "var(--text)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 10, fontSize: "var(--fs-base)", resize: "vertical", fontFamily: "inherit" }}
                  />
                  <button
                    style={{ ...primary, alignSelf: "flex-end", opacity: busy || !input.trim() ? 0.5 : 1 }}
                    disabled={busy !== null || !input.trim()}
                    onClick={() => {
                      const a = input.trim();
                      setInput("");
                      void turn(a);
                    }}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "var(--sp-12)" }}>
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)", flex: 1 }}>{answers} answers saved</span>
              <button style={{ ...secondary, opacity: answers < 1 || busy ? 0.5 : 1 }} disabled={answers < 1 || busy !== null} onClick={build}>
                {busy === "build" ? "Building the notes…" : state.package ? "Rebuild the handover notes" : "Finish and build the handover notes"}
              </button>
            </div>
          </div>
        )}

        {state.package && (
          <div>
            <h2 style={{ fontSize: "var(--fs-h4)", margin: "var(--sp-8) 0" }}>Your handover notes</h2>
            <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", margin: "0 0 var(--sp-12)", lineHeight: 1.55 }}>
              Check every item: fix what&rsquo;s wrong, remove what shouldn&rsquo;t be kept. An admin approves the notes before your twin uses them.
            </p>
            <PackageReview pkg={state.package} editable={open} onEdit={edit} />
          </div>
        )}
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
          <Link href="/profile">Back to your twin</Link>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, text, live }: { role: "user" | "assistant"; text: string; live?: boolean }) {
  const mine = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: "82%", background: mine ? "var(--surface-soft)" : "color-mix(in oklch, var(--accent) 10%, transparent)", border: "1px solid var(--hairline)", borderRadius: 12, padding: "10px 14px", fontSize: "var(--fs-base)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
        <bdi>{text}</bdi>
        {live && <span style={{ opacity: 0.5 }}>▋</span>}
      </div>
    </div>
  );
}

export default function HandoverInterviewPage() {
  return (
    <>
      <Topbar crumbs={["Relay", "Handover interview"]} />
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <InterviewInner />
      </Suspense>
    </>
  );
}
