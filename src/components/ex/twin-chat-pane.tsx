"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { ClarificationCard } from "@/components/ex/clarification-card";
import {
  EmployeeCanvasPanel,
  type EmployeeCanvas,
} from "@/components/ex/employee-canvas";
import type { TwinTraceEvent } from "@/lib/ex-graph-types";
import {
  ELEVENLABS_VOICE_STORAGE_KEY,
  type EmployeeWithTwin,
} from "@/lib/employees";
import { useRoster } from "@/components/ex/roster-context";

// Web Speech API type declarations (not in default TS lib)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionAlternative { transcript: string; confidence: number; }
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((e: Event) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  start(): void;
  stop(): void;
}
declare const SpeechRecognition: { new(): SpeechRecognition };
declare global {
  interface Window {
    SpeechRecognition: { new(): SpeechRecognition };
    webkitSpeechRecognition: { new(): SpeechRecognition };
  }
}

const SUGGESTED: string[] = [
  "What are you working on this quarter?",
  "Who do you defer to on this kind of question?",
  "Walk me through your decision framework.",
];

// ─── Types ────────────────────────────────────────────────────────────────────

type TraceItem =
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; ts: number }
  | { kind: "tool_result"; name: string; summary: string; files: string[]; ts: number }
  | { kind: "skill_recall"; id: string; label: string; description: string; ts: number }
  | { kind: "cite"; file: string; ts: number };

type PendingApproval = {
  approvalId: string;
  tool: string;
  label: string;
  input: Record<string, unknown>;
  reason: string;
  ts: number;
};

type PendingClarification = {
  approvalId: string;
  questions: Array<{
    question: string;
    header: string;
    multiSelect: boolean;
    options: Array<{ label: string; description: string; preview?: string }>;
  }>;
  ts: number;
};

type Message =
  | { role: "user"; id: string; text: string }
  | {
      role: "twin";
      id: string;
      text: string;
      streaming: boolean;
      trace: TraceItem[];
      confidence: number | null;
      cited: string[];
      pendingApprovals: PendingApproval[];
      pendingClarifications: PendingClarification[];
      blocked: { tool: string; reason: string }[];
      artifacts: EmployeeCanvas[];
      /** Suggested next prompts from the Haiku follow-up call. Empty until
       *  the trailing `followup_suggestions` SSE event arrives. */
      followups: string[];
    };

type Props = {
  onTrace: (event: TwinTraceEvent) => void;
  onOpenFile: (name: string) => void;
  employeeId?: string;
};

function confidenceBadgeClass(c: number): string {
  if (c >= 0.85) return "badge success";
  if (c >= 0.7) return "badge warn";
  return "badge danger";
}

// ─── ApprovalCard ─────────────────────────────────────────────────────────────

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: PendingApproval;
  onResolve: (id: string, action: "allow" | "deny", edited?: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editedJson, setEditedJson] = useState(JSON.stringify(approval.input, null, 2));
  const [jsonError, setJsonError] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolve(action: "allow" | "deny") {
    setBusy(true);
    let updatedInput: Record<string, unknown> | undefined;
    if (action === "allow" && editing) {
      try {
        updatedInput = JSON.parse(editedJson);
      } catch {
        setJsonError("Invalid JSON");
        setBusy(false);
        return;
      }
    }
    onResolve(approval.approvalId, action, updatedInput);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      style={{
        border: "1.5px solid var(--warn)",
        borderRadius: 10,
        background: "color-mix(in oklch, var(--warn) 8%, var(--surface))",
        padding: "10px 12px",
        marginTop: "var(--sp-8)",
        boxShadow: "0 0 0 3px color-mix(in oklch, var(--warn) 10%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-7)", marginBottom: "var(--sp-6)" }}>
        <Icons.Lock size={12} style={{ color: "var(--warn)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--text)" }}>
          {approval.label}
        </span>
      </div>

      <p style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", margin: "0 0 8px", lineHeight: 1.45 }}>
        {approval.reason}
      </p>

      {Object.keys(approval.input).length > 0 && (
        <div style={{ marginBottom: "var(--sp-8)" }}>
          {editing ? (
            <>
              <textarea
                value={editedJson}
                onChange={(e) => { setEditedJson(e.target.value); setJsonError(""); }}
                rows={5}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10.5,
                  padding: "var(--sp-7)",
                  border: `1px solid ${jsonError ? "var(--danger)" : "var(--hairline)"}`,
                  borderRadius: 5,
                  background: "var(--bg-sunken)",
                  color: "var(--text)",
                  resize: "vertical",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
              {jsonError && (
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--danger)", marginTop: "var(--sp-3)" }}>{jsonError}</div>
              )}
            </>
          ) : (
            <pre
              style={{
                margin: 0,
                padding: "6px 8px",
                background: "var(--bg-sunken)",
                borderRadius: 5,
                fontSize: 10.5,
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--text-muted)",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: 120,
                overflow: "auto",
              }}
            >
              {JSON.stringify(approval.input, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--sp-6)", alignItems: "center" }}>
        <button
          onClick={() => resolve("allow")}
          disabled={busy}
          style={{
            flex: 1, padding: "5px 10px",
            background: "var(--text)", color: "var(--bg)",
            border: "none", borderRadius: 5, fontSize: "var(--fs-meta)", fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          <Icons.Check size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: "var(--sp-4)" }} />
          Approve
        </button>
        <button
          onClick={() => setEditing((v) => !v)}
          disabled={busy}
          style={{
            padding: "5px 10px", background: "var(--surface)",
            color: "var(--text-muted)", border: "1px solid var(--hairline)",
            borderRadius: 5, fontSize: "var(--fs-meta)", fontWeight: 500, cursor: "pointer",
          }}
        >
          {editing ? "Cancel" : "Edit args"}
        </button>
        <button
          onClick={() => resolve("deny")}
          disabled={busy}
          style={{
            padding: "5px 10px", background: "var(--surface)",
            color: "var(--text-muted)", border: "1px solid var(--hairline)",
            borderRadius: 5, fontSize: "var(--fs-meta)", fontWeight: 500,
            cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          Skip
        </button>
      </div>
    </motion.div>
  );
}

// ─── BlockedNotice ────────────────────────────────────────────────────────────

function BlockedNotice({ tool, reason }: { tool: string; reason: string }) {
  const bare = tool.replace(/^mcp__[a-z0-9_]+__/i, "");
  return (
    <div
      style={{
        marginTop: "var(--sp-8)", padding: "7px 10px",
        background: "color-mix(in oklch, var(--danger) 10%, var(--surface))",
        border: "1px solid color-mix(in oklch, var(--danger) 30%, transparent)",
        borderRadius: 6, fontSize: "var(--fs-meta)", color: "var(--danger)",
        display: "flex", gap: "var(--sp-7)", alignItems: "flex-start",
      }}
    >
      <Icons.Lock size={11} style={{ flexShrink: 0, marginTop: "var(--sp-1)" }} />
      <span><strong>{bare}</strong> — {reason}</span>
    </div>
  );
}

// ─── Collapsible trace row ────────────────────────────────────────────────────

function TraceRow({ trace, onOpenFile }: { trace: TraceItem[]; onOpenFile: (name: string) => void }) {
  const [open, setOpen] = useState(false);

  if (trace.length === 0) return null;

  const fileCount = trace.filter((t) => t.kind === "tool_call" || t.kind === "cite").length;

  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      {/* Summary toggle pill */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: "var(--sp-5)",
          padding: "3px 8px", fontSize: "var(--fs-xs)", borderRadius: 20,
          border: "1px solid var(--hairline)",
          background: open ? "var(--bg-sunken)" : "var(--surface)",
          color: "var(--text-subtle)",
          cursor: "pointer", fontFamily: "var(--font)",
          transition: "background 0.15s",
        }}
      >
        <Icons.Eye size={9} />
        <span>{fileCount} {fileCount === 1 ? "file" : "files"} read</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
          style={{ display: "inline-block", lineHeight: 1 }}
        >
          ▾
        </motion.span>
      </button>

      {/* Expanded pills */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)", marginTop: "var(--sp-6)" }}>
              {trace.map((t, i) => {
                if (t.kind === "tool_call") {
                  const fileName =
                    (t.args.name as string | undefined) ??
                    (t.args.file_path as string | undefined)?.split("/").pop();
                  const isRead = t.name === "Read" || t.name === "read_profile_file";
                  return (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => fileName && onOpenFile(fileName)}
                      disabled={!fileName}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "var(--sp-4)",
                        padding: "2px 7px", fontSize: "var(--fs-xs)", borderRadius: 4,
                        border: "1px solid var(--hairline)",
                        background: "var(--surface)",
                        color: "var(--text-muted)",
                        cursor: fileName ? "pointer" : "default",
                        fontFamily: "var(--font)",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-sunken)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; }}
                    >
                      {isRead ? <Icons.Eye size={9} /> : <Icons.Search size={9} />}
                      <span>{isRead ? "read" : t.name.replace(/_/g, " ")}</span>
                      {fileName && (
                        <span style={{ color: "var(--text)", fontFamily: "var(--font-mono, monospace)" }}>
                          {fileName}
                        </span>
                      )}
                      {!fileName && t.args.query != null && (
                        <span style={{ color: "var(--text)", fontFamily: "var(--font-mono, monospace)" }}>
                          &quot;{String(t.args.query)}&quot;
                        </span>
                      )}
                    </motion.button>
                  );
                }
                if (t.kind === "skill_recall") {
                  return (
                    <motion.span
                      key={i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      title={t.description}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "var(--sp-4)",
                        padding: "2px 7px", fontSize: "var(--fs-xs)", borderRadius: 4,
                        border: "1px solid var(--twin)",
                        background: "var(--twin-soft)",
                        color: "var(--twin)",
                        fontFamily: "var(--font)",
                      }}
                    >
                      <Icons.Sparkle2 size={9} />
                      <span>skill</span>
                      <span style={{ color: "var(--text)" }}>{t.label}</span>
                    </motion.span>
                  );
                }
                if (t.kind === "cite") {
                  return (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => onOpenFile(t.file)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "var(--sp-4)",
                        padding: "2px 7px", fontSize: "var(--fs-xs)", borderRadius: 4,
                        border: "1px solid color-mix(in oklch, var(--success) 40%, transparent)",
                        background: "color-mix(in oklch, var(--success) 10%, var(--surface))",
                        color: "var(--success)",
                        cursor: "pointer", fontFamily: "var(--font)",
                      }}
                    >
                      <Icons.Check size={9} />
                      <span>cite</span>
                      <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text)" }}>
                        {t.file}
                      </span>
                    </motion.button>
                  );
                }
                return null;
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── TypingDots ───────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginLeft: "var(--sp-2)" }}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          style={{
            width: 4, height: 4, borderRadius: "50%",
            background: "var(--text-subtle)",
          }}
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85], y: [0, -3, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

// ─── TTS playback hook ────────────────────────────────────────────────────────

function resolveVoiceId(employeeId: string, roster: EmployeeWithTwin[]): string {
  try {
    const stored = localStorage.getItem(ELEVENLABS_VOICE_STORAGE_KEY);
    const overrides: Record<string, string> = stored ? JSON.parse(stored) : {};
    if (overrides[employeeId]) return overrides[employeeId];
  } catch { /* ignore */ }
  return roster.find((e) => e.id === employeeId)?.ttsVoiceId ?? "EXAVITQu4vr4xnSDxMaL";
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

type InlineSink = { appendChunk: (b64: string) => void; finish: () => void; abort: () => void };

function useTTS() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setPlayingId(null);
    setLoadingId(null);
  }, []);

  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  const openSink = useCallback((msgId: string): InlineSink => {
    stopRef.current();
    setLoadingId(msgId);

    const audio = new Audio();
    const ms = new MediaSource();
    const blobUrl = URL.createObjectURL(ms);
    audio.src = blobUrl;

    let aborted = false;
    const queue: ArrayBuffer[] = [];
    let inputDone = false;
    let sb: SourceBuffer | null = null;

    cleanupRef.current = () => {
      aborted = true;
      audio.pause();
      URL.revokeObjectURL(blobUrl);
      try { if (ms.readyState === "open") ms.endOfStream(); } catch { /* ignore */ }
    };

    const flush = () => {
      if (!sb || sb.updating || queue.length === 0) return;
      try { sb.appendBuffer(queue.shift()!); } catch { /* quota */ }
    };

    ms.addEventListener("sourceopen", () => {
      try { sb = ms.addSourceBuffer("audio/mpeg"); } catch { return; }
      sb.addEventListener("updateend", () => {
        if (inputDone && queue.length === 0) {
          try { ms.endOfStream(); } catch { /* ignore */ }
        } else { flush(); }
      });
      flush();
    });

    audio.addEventListener("canplay", () => {
      if (aborted) return;
      setLoadingId(null);
      setPlayingId(msgId);
      audio.play().catch(() => { /* autoplay blocked */ });
    }, { once: true });

    audio.addEventListener("ended", () => {
      setPlayingId(null);
      URL.revokeObjectURL(blobUrl);
      cleanupRef.current = null;
    }, { once: true });

    audio.addEventListener("error", () => {
      if (!aborted) { setLoadingId(null); setPlayingId(null); }
    }, { once: true });

    return {
      appendChunk(b64) {
        if (aborted) return;
        queue.push(base64ToArrayBuffer(b64));
        flush();
      },
      finish() {
        inputDone = true;
        if (sb && !sb.updating && queue.length === 0) {
          try { ms.endOfStream(); } catch { /* ignore */ }
        }
      },
      abort() {
        aborted = true;
        cleanupRef.current?.();
        cleanupRef.current = null;
      },
    };
  }, []);

  const play = useCallback(async (msgId: string, text: string, voiceId?: string) => {
    const sink = openSink(msgId);
    try {
      const res = await fetch("/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!res.ok || !res.body) throw new Error(`TTS stream failed: ${res.status}`);

      const reader = res.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          let bin = "";
          for (let i = 0; i < value.byteLength; i++) bin += String.fromCharCode(value[i]);
          sink.appendChunk(btoa(bin));
        }
      }
      sink.finish();
    } catch {
      sink.abort();
      setLoadingId(null);
      setPlayingId(null);
    }
  }, [openSink]);

  useEffect(() => () => { stopRef.current(); }, []);

  return { playingId, loadingId, play, stopRef };
}

// ─── Voice hook ───────────────────────────────────────────────────────────────

type VoiceModeState = "idle" | "listening" | "processing";

function useVoiceMode(onTranscript: (text: string) => void) {
  const [voiceState, setVoiceState] = useState<VoiceModeState>("idle");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  }, []);

  const start = useCallback(() => {
    if (!supported || typeof window === "undefined") return;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    recognitionRef.current = rec;
    rec.onstart = () => setVoiceState("listening");
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i])
        .map((r) => r[0].transcript).join(" ").trim();
      if (transcript) { setVoiceState("processing"); onTranscript(transcript); }
      else { setVoiceState("idle"); }
    };
    rec.onerror = () => setVoiceState("idle");
    rec.onend = () => {
      recognitionRef.current = null;
      setVoiceState((s) => s === "listening" ? "idle" : s);
    };
    rec.start();
  }, [supported, onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setVoiceState("idle");
  }, []);

  const toggle = useCallback(() => {
    if (voiceState === "listening") stop(); else start();
  }, [voiceState, start, stop]);

  const doneProcessing = useCallback(() => setVoiceState("idle"), []);
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  return { voiceState, toggle, doneProcessing, supported };
}

// ─── TwinChatPane ─────────────────────────────────────────────────────────────

export function TwinChatPane({ onTrace, onOpenFile, employeeId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  /** Most recently copied message id — drives the "copied" pill state for ~1.4s
   *  before reverting. Stored as id only so re-renders don't accumulate timers. */
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyMessage = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1400);
    } catch {
      // Older browsers / non-HTTPS contexts — fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* nothing else to do */ }
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1400);
    }
  }, []);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { playingId, loadingId, play, stopRef } = useTTS();
  const submitRef = useRef<(q: string) => void>(() => {});

  const roster = useRoster();
  const employee = roster.find((e) => e.id === employeeId);
  const avatarColor = employee?.avatarColor ?? "var(--twin)";
  const initials = employee?.initials ?? "AI";

  const { voiceState, toggle: toggleMic, doneProcessing, supported: micSupported } = useVoiceMode(
    useCallback((transcript: string) => { submitRef.current(transcript); }, [])
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setMessages([]);
    setInput("");
    sessionIdRef.current = null;
    abortRef.current?.abort();
    stopRef.current();
    if (!employeeId) return;

    setHistoryLoading(true);
    fetch(`/api/employees/${employeeId}/chat-history`)
      .then((r) => r.json())
      .then((stored: Array<{
        role: "user" | "twin"; id: string; text: string; ts: number;
        confidence?: number | null; cited?: string[];
        artifacts?: Array<{ artifactId: string; type: "html" | "svg"; title: string; content: string }>;
      }>) => {
        setMessages(stored.map((m) =>
          m.role === "user"
            ? { role: "user" as const, id: m.id, text: m.text }
            : {
                role: "twin" as const, id: m.id, text: m.text,
                streaming: false, trace: [], confidence: m.confidence ?? null,
                cited: m.cited ?? [], pendingApprovals: [], pendingClarifications: [], blocked: [],
                artifacts: m.artifacts ?? [], followups: [],
              }
        ));
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const resolveApproval = useCallback(
    async (approvalId: string, action: "allow" | "deny", updatedInput?: Record<string, unknown>) => {
      try {
        await fetch("/api/council/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalId, action, ...(updatedInput !== undefined ? { updatedInput } : {}) }),
        });
      } catch { /* best-effort */ }
    }, []
  );

  // AskUserQuestion answers ride the same approval bus: action=deny + a JSON
  // string in `message`. The server-side canUseTool decodes it back into the
  // SDK's expected `answers` map. Same convention as council/page.tsx.
  const resolveClarification = useCallback(
    async (approvalId: string, answers: Record<string, string>) => {
      try {
        await fetch("/api/council/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalId, action: "deny", message: JSON.stringify(answers) }),
        });
      } catch { /* best-effort */ }
    }, []
  );

  const submit = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || isStreaming) return;

      const userId = `u-${Date.now()}`;
      const twinId = `t-${Date.now()}`;
      const now = Date.now();

      setMessages((m) => [
        ...m,
        { role: "user", id: userId, text: q },
        { role: "twin", id: twinId, text: "", streaming: true, trace: [], confidence: null, cited: [], pendingApprovals: [], pendingClarifications: [], blocked: [], artifacts: [], followups: [] },
      ]);
      setInput("");
      setIsStreaming(true);

      if (employeeId) {
        void fetch(`/api/employees/${employeeId}/chat-history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", id: userId, text: q, ts: now }),
        });
      }

      let twinText = "";
      let twinArtifacts: EmployeeCanvas[] = [];
      const ac = new AbortController();
      abortRef.current = ac;

      const history = messages
        .filter((m) => m.role === "twin" ? !m.streaming : true)
        .map((m) => m.role === "user" ? { role: "user" as const, text: m.text } : { role: "assistant" as const, text: m.text })
        .filter((m) => m.text.trim().length > 0);

      try {
        const res = await fetch("/api/twin/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, employeeId, history, sessionId: sessionIdRef.current ?? undefined }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) throw new Error(`Chat request failed: ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = chunk.split("\n").filter((l) => l.startsWith("data:"));
            if (!lines.length) continue;
            const dataStr = lines.map((l) => l.slice(5).trimStart()).join("\n");
            if (!dataStr) continue;

            let evt: TwinTraceEvent;
            try { evt = JSON.parse(dataStr) as TwinTraceEvent; }
            catch { continue; }

            onTrace(evt);

            if (evt.type === "session") { sessionIdRef.current = evt.sessionId; continue; }

            let newArtifact: { artifactId: string; type: "html" | "svg"; title: string; content: string } | null = null;

            if (evt.type === "text_delta") {
              twinText += evt.delta;
            } else if (evt.type === "artifact") {
              newArtifact = { artifactId: evt.artifactId, type: evt.payload.type, title: evt.payload.title, content: evt.payload.content };
              twinArtifacts = [...twinArtifacts, newArtifact];
            } else if (evt.type === "done") {
              doneProcessing();
              if (employeeId && twinText.trim()) {
                void fetch(`/api/employees/${employeeId}/chat-history`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ role: "twin", id: twinId, text: twinText, ts: Date.now(), confidence: evt.confidence, cited: evt.cited_files, artifacts: twinArtifacts }),
                });
              }
            }

            setMessages((curr) =>
              curr.map((m) => {
                if (m.id !== twinId || m.role !== "twin") return m;
                switch (evt.type) {
                  case "tool_call": return { ...m, trace: [...m.trace, { kind: "tool_call", name: evt.name, args: evt.args, ts: evt.ts }] };
                  case "tool_result": return { ...m, trace: [...m.trace, { kind: "tool_result", name: evt.name, summary: evt.summary, files: evt.files, ts: evt.ts }] };
                  case "skill_recall": return { ...m, trace: [...m.trace, ...evt.skills.map((skill) => ({ kind: "skill_recall" as const, id: skill.id, label: skill.label, description: skill.description, ts: evt.ts }))] };
                  case "text_delta": return { ...m, text: m.text + evt.delta };
                  case "cite": return { ...m, trace: [...m.trace, { kind: "cite", file: evt.file, ts: evt.ts }], cited: m.cited.includes(evt.file) ? m.cited : [...m.cited, evt.file] };
                  case "done": return { ...m, streaming: false, confidence: evt.confidence, cited: evt.cited_files };
                  case "tool_approval_request": return { ...m, pendingApprovals: [...m.pendingApprovals, { approvalId: evt.approvalId, tool: evt.tool, label: evt.label, input: evt.input, reason: evt.reason, ts: evt.ts }] };
                  case "tool_approval_resolved": return { ...m, pendingApprovals: m.pendingApprovals.filter((a) => a.approvalId !== evt.approvalId) };
                  case "clarification_request": return { ...m, pendingClarifications: [...m.pendingClarifications, { approvalId: evt.approvalId, questions: evt.questions, ts: evt.ts }] };
                  case "clarification_resolved": return { ...m, pendingClarifications: m.pendingClarifications.filter((c) => c.approvalId !== evt.approvalId) };
                  case "followup_suggestions": return { ...m, followups: evt.suggestions };
                  case "tool_blocked": return { ...m, blocked: [...m.blocked, { tool: evt.tool, reason: evt.reason }] };
                  case "scratch_write_denied": return { ...m, blocked: [...m.blocked, { tool: "Write (scratch denied)", reason: evt.reason }] };
                  case "artifact": return newArtifact ? { ...m, artifacts: [...m.artifacts, newArtifact] } : m;
                  default: return m;
                }
              })
            );
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setMessages((curr) =>
            curr.map((m) => m.id === twinId && m.role === "twin"
              ? { ...m, streaming: false, text: m.text || "Couldn't reach the twin." }
              : m
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, employeeId, onTrace, doneProcessing, messages]
  );

  useEffect(() => { submitRef.current = submit; }, [submit]);

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", height: "100%",
        background: "var(--bg-elevated)",
        borderLeft: "1px solid var(--hairline)",
        overflow: "hidden", position: "relative",
      }}
    >
      {/* ── Ambient glow — only decorative, uses the employee's color ── */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div
          style={{
            position: "absolute", top: "-80px", right: "-40px",
            width: 240, height: 240, borderRadius: "50%",
            background: `radial-gradient(circle, ${avatarColor}18 0%, transparent 70%)`,
            filter: "blur(40px)",
          }}
        />
      </div>

      {/* ── Header ── */}
      <div
        style={{
          padding: "11px 16px",
          borderBottom: "1px solid var(--hairline)",
          display: "flex", alignItems: "center", gap: "var(--sp-8)", flexShrink: 0,
          position: "relative", zIndex: 1,
          background: "var(--bg-elevated)",
        }}
      >
        <Icons.Bot size={13} style={{ color: "var(--twin)" }} />
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-muted)" }}>
          Twin chat
        </span>
        <div className="spacer" />

        {/* Clear button */}
        {messages.length > 0 && !isStreaming && employeeId && (
          <button
            onClick={() => {
              if (!confirm("Clear all chat history? This deletes the JSONL file on disk and cannot be undone.")) return;
              void fetch(`/api/employees/${employeeId}/chat-history`, { method: "DELETE" })
                .then(() => setMessages([]));
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: "var(--sp-4)",
              background: "transparent", border: "1px solid var(--hairline)",
              borderRadius: 4, cursor: "pointer", fontSize: "var(--fs-xs)",
              color: "var(--text-subtle)", padding: "2px 7px",
              fontFamily: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--danger)";
              e.currentTarget.style.borderColor = "var(--danger)";
              e.currentTarget.style.background = "color-mix(in oklch, var(--danger) 8%, transparent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-subtle)";
              e.currentTarget.style.borderColor = "var(--hairline)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Icons.Trash size={10} />
            Clear
          </button>
        )}

        {/* Status */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
          {historyLoading || isStreaming ? (
            <TypingDots />
          ) : (
            <motion.div
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)" }}
            />
          )}
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
            {historyLoading ? "loading" : isStreaming ? "thinking" : "live"}
          </span>
        </div>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className="scrollbar"
        style={{
          flex: 1, overflowY: "auto", padding: "16px 14px",
          display: "flex", flexDirection: "column", gap: "var(--sp-12)",
          position: "relative", zIndex: 1,
        }}
      >
        {/* Empty state */}
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: "var(--sp-14)", padding: "32px 12px 20px",
            }}
          >
            {/* Glowing avatar */}
            <div style={{ position: "relative" }}>
              <div
                style={{
                  position: "absolute", inset: -10, borderRadius: "50%",
                  background: `radial-gradient(circle, ${avatarColor}33 0%, transparent 70%)`,
                  filter: "blur(12px)",
                }}
              />
              <motion.div
                animate={{ boxShadow: [`0 0 0 0px ${avatarColor}30`, `0 0 0 8px ${avatarColor}10`, `0 0 0 0px ${avatarColor}00`] }}
                transition={{ duration: 2.5, repeat: Infinity }}
                style={{
                  width: 52, height: 52, borderRadius: "50%",
                  background: avatarColor,
                  display: "grid", placeItems: "center",
                  fontSize: "var(--fs-base)", fontWeight: 700,
                  color: "var(--text)",
                  position: "relative",
                  border: "1.5px solid var(--hairline)",
                }}
              >
                {initials}
              </motion.div>
            </div>

            {/* Name + tagline */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "var(--sp-4)" }}>
                {employee ? `Chat with ${employee.firstName}'s twin` : "Ask the twin"}
              </div>
              <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", lineHeight: 1.5 }}>
                Watch the graph light up as the agent reads files
              </div>
            </div>

            {/* Suggested questions */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", width: "100%", maxWidth: 280 }}>
              {SUGGESTED.map((q, i) => (
                <motion.button
                  key={q}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.08 }}
                  onClick={() => submit(q)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  style={{
                    padding: "8px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 8,
                    cursor: "pointer", textAlign: "left",
                    fontSize: "var(--fs-sm)", color: "var(--text-muted)",
                    fontFamily: "inherit", lineHeight: 1.4,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-sunken)";
                    e.currentTarget.style.borderColor = avatarColor;
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--surface)";
                    e.currentTarget.style.borderColor = "var(--hairline)";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <span style={{ marginRight: "var(--sp-6)", color: "var(--text-subtle)" }}>↗</span>
                  {q}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Message list */}
        {messages.map((m) =>
          m.role === "user" ? (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              style={{ display: "flex", justifyContent: "flex-end" }}
            >
              <div
                style={{
                  background: "var(--text)",
                  color: "var(--bg)",
                  padding: "8px 12px",
                  borderRadius: "12px 12px 3px 12px",
                  maxWidth: "80%",
                  fontSize: "var(--fs-ui)", lineHeight: 1.5, letterSpacing: "-0.005em", fontWeight: 500,
                  boxShadow: "var(--shadow)",
                }}
              >
                {m.text}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              style={{ display: "flex", gap: "var(--sp-9)", alignItems: "flex-start" }}
            >
              {/* Avatar with animated ring while streaming */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                {m.streaming && (
                  <motion.div
                    animate={{ opacity: [0.4, 0.9, 0.4], scale: [1, 1.15, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    style={{
                      position: "absolute", inset: -3, borderRadius: "50%",
                      border: `1.5px solid ${avatarColor}`,
                    }}
                  />
                )}
                <div
                  style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: avatarColor,
                    display: "grid", placeItems: "center",
                    fontSize: "var(--fs-2xs)", fontWeight: 700, color: "var(--text)",
                    marginTop: "var(--sp-2)", border: "1px solid var(--hairline)",
                  }}
                >
                  {initials}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Collapsible trace row */}
                <TraceRow trace={m.trace} onOpenFile={onOpenFile} />

                {/* Artifact panels */}
                {m.artifacts.map((a) => (
                  <EmployeeCanvasPanel key={a.artifactId} canvas={a} />
                ))}

                {/* Twin message bubble — glass style with left accent */}
                <div
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--hairline)",
                    borderLeft: `2.5px solid ${avatarColor}`,
                    color: "var(--text)",
                    padding: "9px 12px",
                    borderRadius: "4px 10px 10px 4px",
                    fontSize: "var(--fs-ui)", lineHeight: 1.6, letterSpacing: "-0.005em",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  {m.text ? (
                    <Markdown>{m.text}</Markdown>
                  ) : m.streaming ? null : (
                    <span style={{ color: "var(--text-subtle)" }}>(no response)</span>
                  )}
                  {m.streaming && (
                    <motion.span
                      animate={{ opacity: [1, 0.2, 1] }}
                      transition={{ duration: 0.9, repeat: Infinity }}
                      style={{ display: "inline-block", marginLeft: "var(--sp-2)", color: avatarColor, fontWeight: 700 }}
                    >
                      ▍
                    </motion.span>
                  )}
                </div>

                {/* Pending approvals */}
                <AnimatePresence>
                  {m.pendingApprovals.map((a) => (
                    <ApprovalCard key={a.approvalId} approval={a} onResolve={(id, action, edited) => resolveApproval(id, action, edited)} />
                  ))}
                </AnimatePresence>

                {/* AskUserQuestion — pause the run until the CEO picks. */}
                <AnimatePresence>
                  {m.pendingClarifications.map((c) => (
                    <ClarificationCard
                      key={c.approvalId}
                      approvalId={c.approvalId}
                      questions={c.questions}
                      onSubmit={(answers) => resolveClarification(c.approvalId, answers)}
                    />
                  ))}
                </AnimatePresence>

                {/* Blocked notices */}
                {m.blocked.map((b, i) => (
                  <BlockedNotice key={i} tool={b.tool} reason={b.reason} />
                ))}

                {/* Confidence + TTS row */}
                {!m.streaming && m.text && m.pendingApprovals.length === 0 && m.pendingClarifications.length === 0 && (
                  <div style={{ marginTop: "var(--sp-6)", display: "flex", alignItems: "center", gap: "var(--sp-6)" }}>
                    {m.confidence != null && (
                      <span className={confidenceBadgeClass(m.confidence)} style={{ fontSize: "var(--fs-2xs)" }}>
                        {(m.confidence * 100).toFixed(0)}% confident
                      </span>
                    )}
                    <button
                      onClick={() => {
                        if (playingId === m.id) { stopRef.current(); }
                        else { play(m.id, m.text, resolveVoiceId(employeeId ?? "", roster)); }
                      }}
                      disabled={loadingId === m.id}
                      title={playingId === m.id ? "Stop" : "Listen"}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "var(--sp-4)",
                        padding: "2px 7px", fontSize: "var(--fs-xs)", borderRadius: 4,
                        border: playingId === m.id ? `1px solid ${avatarColor}` : "1px solid var(--hairline)",
                        background: playingId === m.id
                          ? `color-mix(in oklch, ${avatarColor} 15%, var(--surface))`
                          : "var(--surface)",
                        color: playingId === m.id ? avatarColor : "var(--text-subtle)",
                        cursor: loadingId === m.id ? "wait" : "pointer",
                        fontFamily: "var(--font)",
                        opacity: loadingId === m.id ? 0.6 : 1,
                        transition: "all .15s",
                      }}
                    >
                      {loadingId === m.id ? (
                        <Icons.Loader size={9} style={{ animation: "spin 1s linear infinite" }} />
                      ) : playingId === m.id ? (
                        <Icons.VolumeOff size={9} />
                      ) : (
                        <Icons.Volume size={9} />
                      )}
                      <span>{loadingId === m.id ? "loading…" : playingId === m.id ? "stop" : "listen"}</span>
                    </button>

                    <button
                      onClick={() => copyMessage(m.id, m.text)}
                      title={copiedId === m.id ? "Copied" : "Copy message"}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "var(--sp-4)",
                        padding: "2px 7px", fontSize: "var(--fs-xs)", borderRadius: 4,
                        border: copiedId === m.id ? "1px solid var(--success, #4ade80)" : "1px solid var(--hairline)",
                        background: copiedId === m.id
                          ? "color-mix(in oklch, var(--success, #4ade80) 12%, var(--surface))"
                          : "var(--surface)",
                        color: copiedId === m.id ? "var(--success, #4ade80)" : "var(--text-subtle)",
                        cursor: "pointer",
                        fontFamily: "var(--font)",
                        transition: "all .15s",
                      }}
                    >
                      {copiedId === m.id ? (
                        <Icons.Check size={9} />
                      ) : (
                        // Inline copy glyph — two stacked rounded rectangles
                        <svg
                          width={9}
                          height={9}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect x="8" y="8" width="12" height="12" rx="2" />
                          <path d="M4 16V6a2 2 0 0 1 2-2h10" />
                        </svg>
                      )}
                      <span>{copiedId === m.id ? "copied" : "copy"}</span>
                    </button>
                  </div>
                )}

                {/* Follow-up suggestions — Haiku-generated chips. Clicking
                    one fires the same submit() path as typing it manually. */}
                {!m.streaming && m.followups.length > 0 && m.pendingApprovals.length === 0 && m.pendingClarifications.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.05 }}
                    style={{
                      marginTop: "var(--sp-10)",
                      display: "flex", flexWrap: "wrap", gap: "var(--sp-6)",
                    }}
                  >
                    {m.followups.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => submit(s)}
                        disabled={isStreaming}
                        style={{
                          padding: "7px 14px",
                          fontSize: "var(--fs-ui)",
                          borderRadius: 16,
                          border: "1px solid var(--hairline)",
                          background: "var(--surface)",
                          color: "var(--text-muted)",
                          cursor: isStreaming ? "not-allowed" : "pointer",
                          fontFamily: "var(--font)",
                          textAlign: "start",
                          maxWidth: "100%",
                          opacity: isStreaming ? 0.55 : 1,
                          transition: "background .15s, color .15s, border-color .15s",
                        }}
                        onMouseEnter={(e) => {
                          if (isStreaming) return;
                          e.currentTarget.style.background = "var(--text)";
                          e.currentTarget.style.color = "var(--bg)";
                          e.currentTarget.style.borderColor = "var(--text)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "var(--surface)";
                          e.currentTarget.style.color = "var(--text-muted)";
                          e.currentTarget.style.borderColor = "var(--hairline)";
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )
        )}

        {/* Thinking float — shown when streaming but no text yet */}
        <AnimatePresence>
          {isStreaming && messages.at(-1)?.role === "twin" && !(messages.at(-1) as Extract<Message, { role: "twin" }>).text && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              style={{
                display: "flex", alignItems: "center", gap: "var(--sp-8)",
                padding: "6px 12px",
                background: "var(--surface)",
                border: "1px solid var(--hairline)",
                borderRadius: 20, alignSelf: "flex-start",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div
                style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: avatarColor,
                  display: "grid", placeItems: "center",
                  fontSize: 7, fontWeight: 700, color: "var(--text)",
                }}
              >
                {initials}
              </div>
              <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>Thinking</span>
              <TypingDots />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Input area ── */}
      <div
        style={{
          padding: "10px 12px 12px",
          borderTop: "1px solid var(--hairline)",
          background: "var(--bg-elevated)",
          position: "relative", zIndex: 1,
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "flex-end", gap: "var(--sp-6)",
            background: "var(--surface)",
            border: `1px solid ${inputFocused ? avatarColor : "var(--hairline-strong)"}`,
            borderRadius: 12,
            padding: "6px 6px 6px 12px",
            transition: "border-color 0.2s",
            boxShadow: inputFocused ? `0 0 0 3px color-mix(in oklch, ${avatarColor} 15%, transparent)` : "none",
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); }
            }}
            placeholder={
              voiceState === "listening" ? "Listening…"
              : voiceState === "processing" ? "Processing…"
              : isStreaming ? "Twin is responding…"
              : "Ask the twin…"
            }
            disabled={isStreaming || voiceState === "listening" || voiceState === "processing"}
            rows={1}
            style={{
              flex: 1, border: "none", background: "transparent",
              padding: "4px 0", fontSize: "var(--fs-ui)", outline: "none",
              color: "var(--text)", resize: "none", fontFamily: "inherit",
              lineHeight: 1.5, maxHeight: 100, overflowY: "auto",
            }}
          />

          {/* Mic button */}
          {micSupported && (
            <motion.button
              onClick={toggleMic}
              disabled={isStreaming && voiceState !== "listening"}
              whileTap={{ scale: 0.9 }}
              title={voiceState === "listening" ? "Stop recording" : "Speak"}
              style={{
                flexShrink: 0, width: 30, height: 30, borderRadius: 8,
                border: voiceState === "listening"
                  ? "1px solid color-mix(in oklch, var(--danger) 50%, transparent)"
                  : "1px solid var(--hairline)",
                background: voiceState === "listening"
                  ? "color-mix(in oklch, var(--danger) 12%, var(--surface))"
                  : "var(--surface)",
                color: voiceState === "listening" ? "var(--danger)" : "var(--text-subtle)",
                display: "grid", placeItems: "center",
                cursor: "pointer", transition: "all .15s",
              }}
            >
              {voiceState === "listening" ? <Icons.VolumeOff size={12} /> : <Icons.Mic size={12} />}
            </motion.button>
          )}

          {/* Send button */}
          <motion.button
            onClick={() => submit(input)}
            disabled={isStreaming || input.trim().length === 0}
            whileHover={input.trim().length > 0 ? { scale: 1.03 } : {}}
            whileTap={input.trim().length > 0 ? { scale: 0.97 } : {}}
            style={{
              flexShrink: 0, height: 30, padding: "0 12px", borderRadius: 8,
              border: "none",
              background: input.trim().length > 0 ? "var(--text)" : "var(--bg-sunken)",
              color: input.trim().length > 0 ? "var(--bg)" : "var(--text-subtle)",
              fontSize: "var(--fs-sm)", fontWeight: 600,
              cursor: isStreaming || input.trim().length === 0 ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: "var(--sp-5)",
              fontFamily: "inherit", transition: "all .15s",
              boxShadow: input.trim().length > 0 ? "var(--shadow)" : "none",
            }}
          >
            <Icons.Arrow size={11} />
            Ask
          </motion.button>
        </div>

        <div style={{ marginTop: "var(--sp-5)", textAlign: "center" }}>
          <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)", opacity: 0.6 }}>
            Shift + Enter for new line
          </span>
        </div>
      </div>
    </div>
  );
}
