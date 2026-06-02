"use client";

/**
 * Relay · LIVE interview (tuning surface).
 *
 * A real, interactive handover interview: the warm interviewer (sonnet) asks,
 * YOU type real answers, it follows the thread, and on "Finish" opus synthesizes
 * a real Role Context Package. Use this to test the system end-to-end and to
 * tune the interviewer prompt (src/lib/relay/interviewer.ts — hot-reloads).
 *
 * Writes data/handovers/<id>/rcp.live.json — the static investor fixture
 * (/handover, rcp.json) is never touched.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const DEMO_EMPLOYEE_ID = "itai-cohen";
const BRAND = "#9E6B47";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Phase = "consent" | "interviewing" | "synthesizing" | "done";

interface CapturedItem { id: string; title: string; body: string; confidence: number; gaps: string[] }
interface ToolingRef { id: string; system: string; location: string; accessVia: string; ownedBy?: string }
interface Rcp {
  source_twin_id: string;
  status: string;
  synth_mode: string;
  decision_rules: CapturedItem[];
  playbooks: CapturedItem[];
  contact_graph: CapturedItem[];
  edge_cases: CapturedItem[];
  tooling_map: ToolingRef[];
  glossary: CapturedItem[];
  open_loops: CapturedItem[];
}
interface Coverage { score: number; status: string; gaps: string[] }

async function streamTurn(
  employeeId: string,
  messages: ChatMessage[],
  onDelta: (d: string) => void,
): Promise<string> {
  const res = await fetch(`/api/relay/${encodeURIComponent(employeeId)}/interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.body) throw new Error("No response stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === "text_delta") { full += ev.delta; onDelta(ev.delta); }
        else if (ev.type === "error") throw new Error(ev.message);
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.includes("JSON")) throw e;
      }
    }
  }
  return full.trim();
}

function LivePageInner() {
  const params = useSearchParams();
  const employeeId = params.get("employee") ?? DEMO_EMPLOYEE_ID;

  const [phase, setPhase] = useState<Phase>("consent");
  const [consent, setConsent] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rcp, setRcp] = useState<Rcp | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);

  const feedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const runTurn = useCallback(
    async (msgs: ChatMessage[]) => {
      setBusy(true);
      setError(null);
      setStreaming("");
      try {
        const full = await streamTurn(employeeId, msgs, (d) => setStreaming((s) => s + d));
        setMessages([...msgs, { role: "assistant", content: full }]);
        setStreaming("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Interview turn failed");
      } finally {
        setBusy(false);
      }
    },
    [employeeId],
  );

  const start = useCallback(() => {
    if (!consent) return;
    setPhase("interviewing");
    void runTurn([]);
  }, [consent, runTurn]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    void runTurn(next);
  }, [input, busy, messages, runTurn]);

  const finish = useCallback(async () => {
    setPhase("synthesizing");
    setError(null);
    try {
      const res = await fetch(`/api/relay/${encodeURIComponent(employeeId)}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Synthesis failed");
      setRcp(data.rcp);
      setCoverage(data.coverage);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Synthesis failed");
      setPhase("interviewing");
    }
  }, [employeeId, messages]);

  const answerCount = messages.filter((m) => m.role === "user").length;

  return (
    <div className="scrollbar" style={{ flex: 1, overflowY: "auto", padding: 24 }}>
      <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-dim, #888)" }}>Workspace / Handover / Live interview</div>

        {/* DEMO banner */}
        <div style={{ background: "rgba(158,107,71,.12)", border: `1px solid ${BRAND}`, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          ⚠️ DEMO — live interview writes to <code>rcp.live.json</code>; the static investor demo is untouched. Not legally reviewed, not for production, not published.
        </div>

        <div>
          <h1 style={{ fontSize: 26, margin: "4px 0 6px" }}>Live handover interview</h1>
          <p style={{ color: "var(--text-dim, #999)", fontSize: 14, lineHeight: 1.5 }}>
            The interviewer asks, <strong>you answer for real</strong> (Hebrew or English — it mirrors you), and
            opus synthesizes a Role Context Package from your words. Subject: <strong>{employeeId}</strong>.
            Tune the agent in <code>src/lib/relay/interviewer.ts</code>.
          </p>
        </div>

        {error && (
          <div style={{ background: "rgba(220,80,80,.12)", border: "1px solid #c55", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#e88" }}>
            {error}
          </div>
        )}

        {phase === "synthesizing" && <SynthesizingOverlay />}

        {phase === "consent" && (
          <div style={{ background: "var(--surface, #141414)", border: "1px solid var(--hairline, #2a2a2a)", borderRadius: 10, padding: 18 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 14 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
              <span>The departing employee has consented to this handover interview (PRD 13.5).</span>
            </label>
            <button
              onClick={start}
              disabled={!consent}
              style={{ marginTop: 16, background: consent ? BRAND : "#333", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, cursor: consent ? "pointer" : "not-allowed" }}
            >
              Start the interview
            </button>
          </div>
        )}

        {(phase === "interviewing" || phase === "synthesizing") && (
          <>
            <div
              ref={feedRef}
              className="scrollbar"
              style={{ background: "var(--surface, #141414)", border: "1px solid var(--hairline, #2a2a2a)", borderRadius: 10, padding: 16, maxHeight: 460, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}
            >
              {messages.length === 0 && !streaming && <div style={{ color: "#777", fontSize: 14 }}>Connecting to the interviewer…</div>}
              {messages.map((m, i) => (
                <Bubble key={i} role={m.role} text={m.content} />
              ))}
              {streaming && <Bubble role="assistant" text={streaming} live />}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder={busy ? "Interviewer is typing…" : "Type your answer…  (⌘/Ctrl+Enter to send)"}
                disabled={busy || phase === "synthesizing"}
                rows={2}
                style={{ flex: 1, background: "var(--surface-2, #0e0e0e)", color: "#eee", border: "1px solid var(--hairline, #2a2a2a)", borderRadius: 8, padding: 10, fontSize: 14, resize: "vertical", fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={send} disabled={busy || !input.trim() || phase === "synthesizing"} style={{ background: BRAND, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer", opacity: busy || !input.trim() ? 0.5 : 1 }}>Send</button>
                <button onClick={finish} disabled={busy || answerCount < 1 || phase === "synthesizing"} title={answerCount < 1 ? "Answer at least one question" : "Synthesize the RCP from this conversation"} style={{ background: "transparent", color: BRAND, border: `1px solid ${BRAND}`, borderRadius: 8, padding: "10px 18px", fontSize: 13, cursor: "pointer", opacity: answerCount < 1 || busy ? 0.5 : 1, whiteSpace: "nowrap" }}>
                  {phase === "synthesizing" ? "Synthesizing…" : "Finish & synthesize"}
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#777" }}>{answerCount} answer{answerCount === 1 ? "" : "s"} captured · synthesis runs on opus from your real answers</div>
          </>
        )}

        {phase === "done" && rcp && (
          <RcpView rcp={rcp} coverage={coverage} />
        )}
      </div>
    </div>
  );
}

function LearningIcon({ size = 46 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="m496.8 178.4h-10.7c-.3-4.2 1.6-11.8-4-13.3-32.3-9.4-65.7-14.8-99.4-16-5.6-10-14-17.8-24.4-21.9 3-25.7-16.4-49.7-40.5-49.2-10.9-35.2-58.1-25.6-57.1 10.9-3.2-.1-6.3-.2-9.4 0 1-36.5-46.2-46.2-57.1-10.9-23.5-.4-42.8 22.3-40.6 47.6-26.3-7.9-96-24-94.7-9 0 0-.3 41.5-.3 41.5-9.6 2-19.2 4.4-28.7 7.2-2.4.7-4 2.9-4 5.4v7.9h-10.7c-6.5 0-11.7 5.3-11.7 11.7v309.1c0 6.5 5.3 11.7 11.7 11.7h481.7c6.5 0 11.7-5.3 11.7-11.7v-309.3c0-6.4-5.3-11.7-11.8-11.7zm-109.2-17.9c29.6 1.5 58.9 6.3 87.3 14.2v287.3c-70-19.1-145-19.1-215 0v-58h9.6c11.9 0 21.3-10.1 20.7-21.9 15.9.5 25.1-20.3 13.7-31.6 8.8-8.8 5.5-24.7-5.7-29.8.1-3-.2-17.8.2-20.5 10.4-3.7 17.9-12.5 20-23.8 25.1.2 43.6-26.4 39.6-50.9 24.1-8.4 37.6-39.5 29.6-65zm-141.7 184.4c-.6-.2-28.9.7-28.2-.8-6.3-3.7-3.5-14.1 4-13.9h68.6c8.5-.2 10.3 12.6 2 14.7h-10.2c-7.4 0-7.3 11.2 0 11.2h10.1c8.4 2.5 6.7 14.4-1.9 14.7h-5.7-57.2-5.6c-8.4-.1-10.4-12.5-1.9-14.7h26.1c7.2.1 7.2-11.1-.1-11.2zm-12.9 37.2h46c.5 5.6-3.7 10.7-9.4 10.6h-27.1c-5.2 0-9.5-4.2-9.5-9.5zm241 92.9c-131.7.8-263.3 1-395 .5-10.2 0-23 2.1-32.9-.1-3-.7-3.7-1.5-3-2.3 2-2.3 15.4-4.8 18.2-5.4 56.8-11.7 117.6-12.6 173.9 2.6 12 3.7 24.3 4.3 36.3.4 66.6-15.9 137.6-17.3 202.5 4.3zm-184.1-407.6c15.8.2 23.3 19.8 13 31.3-1.6 1.8-3.6 3.4-4.9 5.5s-1.9 4.9-.6 6.9c9.9 9.1 21-14 21.4-22.1 24.9 2.7 37.5 33.8 21.3 53-1.7 2-3.6 4-4.6 6.4-1 2.5-.6 5.7 1.7 7.1 7.9 3 16.1-11 18.6-17.2 30.4 15.9 30 61.2-.7 76.5-4.8-14.5-24.3-28.1-39.2-20.7-2.3 1.8-3.3 5.6-1.4 7.8 2.2 2.6 6.2 1.8 9.6 1.7 34.7 2.2 27.5 62.3-5.4 61.5-2.1-8.7-8.5-19.3-18.1-20.2-2.8.1-5.6 2.4-5.4 5.2.2 2.7 2.8 4.4 4.9 6.1 7.4 6.2 9.8 18.1 4.4 26.1-5.3 8.1-18 10.4-25.3 4.1-6.9-6-7.5-16.4-7.4-25.5 0-35.1.1-70.2.1-105.3 0-17.6 0-35.1.1-52.7-.6-13.6-1.2-35.9 17.9-35.5zm-38.4 187.4c-.1-51.6-.2-103.2-.4-154.7h9.6c0 53.4-.1 106.9-.1 160.3-1.5 18.5 5.9 38.4 26.3 41.3 0 5.8.1 11.6.1 17.3-20.7 0-41.4 0-62 0 0-4.2-.9-9.5-.1-13.5 1.2-5.5 1.5-3.6 6.8-5.4 18.3-6.6 20.4-28.4 19.8-45.3zm-95.3-116.4c2.5 6.2 10.7 20 18.5 17 2.3-1.3 2.7-4.6 1.7-7s-2.9-4.3-4.6-6.4c-16.2-19.2-3.7-50.5 21.3-53.1v.3c.3 8 11.5 29.9 21.1 22.3 3.1-4.5-1.8-9.1-4.8-12.3-14.6-17.6 6.1-42.4 24.6-27.2 5.7 5.8 6.1 14.9 6.1 23.1v167.3c0 7.8-.3 16.4-5.4 22.2-6.7 7.6-20.3 6.7-26.5-1.3s-4.2-20.8 3.6-27.2c2.1-1.7 4.7-3.3 5-6 .3-2.8-2.5-5.1-5.3-5.3-9.7.8-16.3 11.5-18.3 20.3-18.9-.3-31-20.5-28-38.1 1.2-11.5 9.7-23.8 22.2-23.5 3.6.1 7.8 1 10.1-1.7 1.9-2.3.9-6-1.5-7.8-15-7.3-34.2 6-39.1 20.6-.6 1.6-15.4-13-16.4-14.5-13.7-20.1-6.6-50.9 15.7-61.7zm-86.1-16.5c17.6-.4 41.9 3.7 71.9 12-30.9 23.9-24.2 78.5 11.9 91.7-4 24.5 14.5 51 39.6 50.9 2 10.3 9.8 20.3 20 23.9.4 2.6.2 17.6.2 20.4-11.2 5-14.4 21.2-5.8 29.8-11.2 11.3-2.1 32 13.8 31.6-.6 11.7 8.9 21.9 20.7 21.9h6.1c0 18.5-.1 37-.1 55.5-54-31.1-117.3-50.7-180.2-47.5.2-27.7 1.8-270.3 1.9-290.2zm-32.8 53c1.7-2.2 21.2-3.7 21.2-5.6-.6 82.1-1.1 164.3-1.7 246.4 0 1.9 0 4 1.3 5.5 1.7 2 4.7 2 7.3 1.9 50.9-2.3 102.3 8.5 148.1 30.9-58.4-10.3-119.2-7.6-176.5 7.9.7-95.3-1-192.1.3-287zm459.5 324.9h-481.7c-1.6.1.1-309.1-.5-309.6 0-.3.2-.5.5-.5h10.6v280.9c0 9 7.3 16.4 16.4 16.4h427.7c9 0 16.4-7.3 16.4-16.4v-281h10.6c.3 0 .5.2.5.5-.5.5 1 309.8-.5 309.7zm-265.1-288.9c-2.2 2.2-5.7 2.3-8 .1-2.6-2.6-6-3.4-8.8-2.1-4 1.7-6.3 7.1-5.4 12.5.5 3.1-1.6 5.9-4.7 6.4-3 .5-6-1.6-6.4-4.7-1.7-10.4 3.4-20.8 12-24.6 6.6-4.4 28.8 2.2 21.3 12.4zm-43.1-78.8c7.4-7.4 18.7-8.2 26.3-2 6.3 3.6 13.6 26 1.1 25.7-3.1-.5-5.2-3.3-4.7-6.4 1.8-9.1-7.4-16.7-14.7-9.5-5.2 5.3-13.1-2.6-8-7.8zm91.7 78.8c-7.5-10.2 14.6-16.8 21.3-12.3 8.6 3.8 13.7 14.1 12 24.6-.5 3.1-3.4 5.2-6.4 4.7-3.1-.5-5.2-3.4-4.7-6.4 1.7-9.1-6.8-17.6-14.3-10.4-2.1 2.1-5.7 2.1-7.9-.2zm16.8-80.8c7.6-6.3 19-5.4 26.3 2 2.2 2.2 2.2 5.8 0 8s-5.8 2.2-7.9 0c-7.3-7.3-16.5.3-14.7 9.5.5 3.4-2.2 6.5-5.6 6.4-11.5-1.3-4.2-22.3 1.9-25.9zm-168.8 171.3 13.7-13.7c2.2-2.2 5.8-2.2 8 0s2.2 5.8 0 8l-13.7 13.7c-1.1 1.1-2.5 1.6-4 1.6-4.8.1-7.6-6.3-4-9.6zm233.7-233.8 13.7-13.7c2.2-2.2 5.8-2.2 8 0s2.2 5.8 0 8l-13.7 13.7c-1.1 1.1-2.5 1.6-4 1.6-4.8.2-7.6-6.2-4-9.6zm-281 119.6c-7.4 0-7.3-11.2 0-11.2h19.4c7.4 0 7.3 11.2 0 11.2zm330.6-11.2h19.4c7.4 0 7.3 11.2 0 11.2h-19.4c-7.4 0-7.4-11.2 0-11.2zm-283.3-114.2c-5.2-5.2 2.7-13.1 7.9-8 0 0 13.7 13.7 13.7 13.7 5.2 5.2-2.7 13.1-7.9 8 0 .1-13.7-13.7-13.7-13.7zm241.7 225.8s13.7 13.7 13.7 13.7c5.2 5.2-2.7 13.1-7.9 8 0 0-13.7-13.7-13.7-13.7-5.3-5.2 2.7-13.1 7.9-8zm-119.6-261.6v-19.4c0-3.1 2.5-5.6 5.6-5.6s5.6 2.5 5.6 5.6v19.4c0 3.1-2.5 5.6-5.6 5.6-3.1.1-5.6-2.5-5.6-5.6z" />
    </svg>
  );
}

const SYNTH_STAGES = [
  "Reading your answers…",
  "Extracting decision rules & playbooks…",
  "Mapping the contact graph…",
  "Capturing edge cases & war stories…",
  "Cross-checking against the profile…",
  "Assembling the Role Context Package…",
];

function SynthesizingOverlay() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % SYNTH_STAGES.length), 1400);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60, display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "rgba(8,8,8,.74)", backdropFilter: "blur(5px)",
      }}
    >
      <style>{`
        @keyframes relay-spin { to { transform: rotate(360deg); } }
        @keyframes relay-spin-rev { to { transform: rotate(-360deg); } }
        @keyframes relay-pulse { 0%,100% { transform: scale(1); opacity: .8; } 50% { transform: scale(1.16); opacity: 1; } }
        @keyframes relay-fade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        @keyframes relay-orbit { from { transform: rotate(0) translateX(54px) rotate(0); } to { transform: rotate(360deg) translateX(54px) rotate(-360deg); } }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, padding: 40 }}>
        <div style={{ position: "relative", width: 108, height: 108, display: "grid", placeItems: "center" }}>
          {/* outer rotating ring */}
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: `conic-gradient(from 0deg, ${BRAND}, rgba(158,107,71,0) 72%)`,
            animation: "relay-spin 1.15s linear infinite",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 0)",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 0)",
          }} />
          {/* inner counter-rotating thin ring */}
          <div style={{
            position: "absolute", inset: 16, borderRadius: "50%",
            background: `conic-gradient(from 180deg, rgba(158,107,71,.55), rgba(158,107,71,0) 60%)`,
            animation: "relay-spin-rev 1.9s linear infinite",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)",
          }} />
          {/* orbiting spark */}
          <div style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: BRAND, boxShadow: `0 0 8px ${BRAND}`, animation: "relay-orbit 2.4s linear infinite" }} />
          {/* pulsing learning glyph */}
          <div style={{ color: BRAND, display: "grid", placeItems: "center", animation: "relay-pulse 1.6s ease-in-out infinite" }}>
            <LearningIcon size={46} />
          </div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: "#eee" }}>Synthesizing the Role Context Package</div>
        <div key={i} style={{ fontSize: 14, color: BRAND, minHeight: 20, animation: "relay-fade .45s ease" }}>{SYNTH_STAGES[i]}</div>
        <div style={{ fontSize: 12, color: "#777" }}>opus is turning your answers into a portable handover asset</div>
      </div>
    </div>
  );
}

function Bubble({ role, text, live }: { role: "user" | "assistant"; text: string; live?: boolean }) {
  const isInterviewer = role === "assistant";
  return (
    <div style={{ display: "flex", justifyContent: isInterviewer ? "flex-start" : "flex-end" }}>
      <div style={{ maxWidth: "82%", background: isInterviewer ? "rgba(158,107,71,.10)" : "var(--surface-2, #1c1c1c)", border: `1px solid ${isInterviewer ? "rgba(158,107,71,.4)" : "var(--hairline, #2a2a2a)"}`, borderRadius: 12, padding: "10px 14px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: isInterviewer ? BRAND : "#888", marginBottom: 4 }}>{isInterviewer ? "Interviewer" : "You"}</div>
        {text}{live && <span style={{ opacity: 0.5 }}>▋</span>}
      </div>
    </div>
  );
}

function RcpView({ rcp, coverage }: { rcp: Rcp; coverage: Coverage | null }) {
  const pct = Math.round((coverage?.score ?? 0) * 100);
  const ready = rcp.status === "handover-ready";
  const sections: { key: keyof Rcp; label: string }[] = [
    { key: "decision_rules", label: "Decision rules" },
    { key: "playbooks", label: "Playbooks" },
    { key: "contact_graph", label: "Contact graph" },
    { key: "edge_cases", label: "Edge cases" },
    { key: "tooling_map", label: "Tooling map" },
    { key: "glossary", label: "Glossary" },
    { key: "open_loops", label: "Open loops" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "var(--surface, #141414)", border: `1px solid ${ready ? BRAND : "var(--hairline,#2a2a2a)"}`, borderRadius: 10, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Role Context Package</h2>
          <span style={{ fontSize: 13, color: ready ? BRAND : "#aaa", fontWeight: 600 }}>{rcp.status} · {pct}% coverage · {rcp.synth_mode}</span>
        </div>
        <div style={{ height: 8, background: "#222", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: BRAND }} />
        </div>
        {coverage?.gaps && coverage.gaps.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#999" }}>Thin: {coverage.gaps.join(" · ")}</div>
        )}
      </div>

      {sections.map(({ key, label }) => {
        const items = rcp[key] as unknown as Array<CapturedItem | ToolingRef>;
        if (!items || items.length === 0) return null;
        return (
          <div key={key} style={{ background: "var(--surface, #141414)", border: "1px solid var(--hairline, #2a2a2a)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: BRAND, marginBottom: 10 }}>{label} · {items.length}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it, i) => (
                <div key={i} style={{ borderLeft: `2px solid rgba(158,107,71,.4)`, paddingLeft: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{"system" in it ? it.system : it.title}</div>
                  <div style={{ fontSize: 13, color: "#bbb", lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 2 }}>
                    {"system" in it ? `${it.location}${it.accessVia ? ` · ${it.accessVia}` : ""}${it.ownedBy ? ` · ${it.ownedBy}` : ""}` : it.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 12, color: "#777" }}>Saved to <code>data/handovers/{rcp.source_twin_id}/rcp.live.json</code>. Refine the prompt and run again to compare.</div>
    </div>
  );
}

export default function LiveHandoverPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <LivePageInner />
    </Suspense>
  );
}
