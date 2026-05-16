"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icons } from "@/components/ex/icons";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import type { EmployeeWithTwin } from "@/lib/employees";
import {
  TWIN_FILE_NAMES,
  type TwinFileName,
  type TwinBuilderEvent,
} from "@/lib/twin-builder-types";

type FileStatus = "pending" | "writing" | "done";
type FileState = {
  status: FileStatus;
  content: string;
  sizeBytes: number;
  finishedAt?: number;
};

type ToolFeedKind =
  | "read"        // local Read/Glob/Grep + Composio read-only verbs
  | "write"       // built-in Write to one of the 9 profile files
  | "blocked"     // denied by the tool gate
  | "result"      // success milestone (file_done, build_recorded)
  | "info";       // run-level context (start, etc.)

type ToolFeedItem = {
  id: string;
  kind: ToolFeedKind;
  /** Short headline of the action — e.g. "Read", "list_pull_requests". */
  action: string;
  /** Optional Composio toolkit slug (`github`, `gmail`...) for the icon chip. */
  toolkit?: string;
  /** Compact, truncated body — what the action targeted. */
  detail?: string;
  /** Run-relative timestamp (ms since build started). */
  ts: number;
};

const FILE_HINTS: Record<TwinFileName, string> = {
  "CONTEXT.md": "Company & domain the twin needs to reason like the employee.",
  "EXPERTISE.md": "Technical / functional expertise — what they're known for.",
  "PROJECTS.md": "Active projects and the employee's role on each.",
  "PEOPLE.md": "Real teammates: collaborators, deferrals, reports.",
  "DECISIONS.md": "Notable decisions with rationale, grounded in evidence.",
  "PREFERENCES.md": "Working style, communication cadence, recurring patterns.",
  "TONE.md": "Voice, characteristic phrases, formality, push-back style.",
  "BOUNDARIES.md": "Topics the twin escalates to the human.",
  "EMPLOYMENT.md": "HR-style record — title, manager, peers, tenure.",
};

function emptyFileMap(): Record<TwinFileName, FileState> {
  return TWIN_FILE_NAMES.reduce((acc, name) => {
    acc[name] = { status: "pending", content: "", sizeBytes: 0 };
    return acc;
  }, {} as Record<TwinFileName, FileState>);
}

function bareToolName(name: string): string {
  return (name || "").replace(/^mcp__[a-z0-9_]+__/i, "");
}

/** Truncate a long file path to its last 2 segments. */
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

/** Extract the toolkit slug from a Composio MCP tool name, if present. */
function toolkitOf(toolName: string): string | undefined {
  const m = (toolName || "").match(/^mcp__composio__([A-Z0-9]+)_/i);
  return m ? m[1].toLowerCase() : undefined;
}

const READ_ONLY_RE =
  /_(GET|LIST|SEARCH|FETCH|RETRIEVE|READ|FIND)_/i;

function classifyKind(toolName: string): "read" | "write" | "info" {
  if (toolName === "Write") return "write";
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") return "read";
  const bare = bareToolName(toolName);
  if (READ_ONLY_RE.test(bare)) return "read";
  // Default: treat unknown Composio actions as read-only since the gate
  // would have denied any write.
  return "read";
}

/** Build the structured feed item from a tool_use event. */
function describeToolForFeed(
  toolName: string,
  input: unknown
): { kind: "read" | "write" | "info"; action: string; toolkit?: string; detail?: string } {
  const bare = bareToolName(toolName);
  const inp = (input as Record<string, unknown>) ?? {};
  const kind = classifyKind(toolName);
  const toolkit = toolkitOf(toolName);

  // Local file tools — show the target path (last 2 segments).
  if (toolName === "Read" || toolName === "Write") {
    const fp = typeof inp.file_path === "string" ? (inp.file_path as string) : "";
    return {
      kind,
      action: toolName,
      detail: fp ? shortPath(fp) : undefined,
    };
  }
  if (toolName === "Glob" || toolName === "Grep") {
    const pat =
      typeof inp.pattern === "string"
        ? (inp.pattern as string)
        : typeof inp.query === "string"
        ? (inp.query as string)
        : "";
    return { kind, action: toolName, detail: pat || undefined };
  }

  // Composio / org MCP — pull the most informative arg.
  const pickStr = (...keys: string[]) => {
    for (const k of keys) {
      const v = inp[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return "";
  };
  const repo =
    pickStr("repo") ||
    (pickStr("owner") && pickStr("name")
      ? `${pickStr("owner")}/${pickStr("name")}`
      : "");
  const detail =
    pickStr("query", "q", "search") ||
    repo ||
    pickStr("channel", "channel_name") ||
    pickStr("path", "file_path", "url") ||
    pickStr("user", "user_id", "id") ||
    "";

  // Friendly action label: drop the leading `TOOLKIT_` segment so the
  // toolkit chip carries that context, leaving just the verb_object.
  const action = toolkit
    ? bare.replace(new RegExp(`^${toolkit}_`, "i"), "").toLowerCase()
    : bare;

  return {
    kind,
    action: action || bare,
    toolkit,
    detail: detail ? detail.slice(0, 120) : undefined,
  };
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

function TwinBuildContent() {
  const sp = useSearchParams();
  const employeeId = sp.get("employee") ?? "";
  const ceoContext = sp.get("ctx") ?? undefined;

  const [employee, setEmployee] = useState<EmployeeWithTwin | null>(null);
  const [activeToolkits, setActiveToolkits] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<TwinFileName, FileState>>(
    emptyFileMap()
  );
  const [activeFile, setActiveFile] = useState<TwinFileName | null>(null);
  const [feed, setFeed] = useState<ToolFeedItem[]>([]);
  const [narration, setNarration] = useState<string>("");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [costUsd, setCostUsd] = useState(0);
  const [turns, setTurns] = useState(0);
  const [stoppedReason, setStoppedReason] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [recorded, setRecorded] = useState<{
    buildId: string;
    version: number;
  } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [reattached, setReattached] = useState(false);
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const startedAtRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const feedScrollRef = useRef<HTMLDivElement | null>(null);

  // Resolve employee from /api/employees
  useEffect(() => {
    if (!employeeId) return;
    fetch("/api/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((all: EmployeeWithTwin[]) => {
        const e = all.find((x) => x.id === employeeId) ?? null;
        setEmployee(e);
      })
      .catch(() => setEmployee(null));
  }, [employeeId]);

  // Wall-clock timer while running
  useEffect(() => {
    if (phase !== "running" || startedAtRef.current === null) return;
    const id = setInterval(
      () => setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now())),
      250
    );
    return () => clearInterval(id);
  }, [phase]);

  // Auto-scroll feed
  useEffect(() => {
    const el = feedScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  // Tear down any open SSE source.
  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  /**
   * Open an SSE EventSource against the build's events.jsonl tail. The build
   * itself runs detached on the server — closing this stream just stops the
   * UI from listening; the runner keeps going.
   */
  const attachToBuild = useCallback(
    (buildId: string, options: { reset?: boolean; resuming?: boolean } = {}) => {
      if (!employee) return;
      closeStream();

      if (options.reset !== false) {
        setFiles(emptyFileMap());
        setFeed([]);
        setNarration("");
        setCostUsd(0);
        setTurns(0);
        setStoppedReason("");
        setErrorMsg("");
        setRecorded(null);
        setActiveFile(null);
        setActiveToolkits([]);
      }

      setActiveBuildId(buildId);
      setReattached(Boolean(options.resuming));
      startedAtRef.current = Date.now();
      setPhase("running");

      const es = new EventSource(
        `/api/twin-builder/${employee.id}/stream?buildId=${encodeURIComponent(
          buildId
        )}`
      );
      eventSourceRef.current = es;

      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as TwinBuilderEvent;
          handleEvent(evt);
        } catch {
          /* skip malformed line */
        }
      };
      es.onerror = () => {
        // Browser will retry automatically. If we already saw `done`, the
        // server closed cleanly and this fires harmlessly. If the server is
        // still up but the runner is gone (sentinel cleared), the route will
        // close after sending a synthetic `done` — also fine.
      };
    },
    [employee, closeStream]
  );

  /** Click "Start build" — POSTs to spawn the runner, then attaches. */
  const start = useCallback(async () => {
    if (!employee || phase === "running") return;
    let res: Response;
    try {
      res = await fetch(`/api/twin-builder/${employee.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ceoContext, lookbackDays }),
      });
    } catch (err) {
      setPhase("error");
      setErrorMsg((err as Error).message ?? "Request failed");
      return;
    }
    if (!res.ok) {
      setPhase("error");
      setErrorMsg(`Request failed: ${res.status}`);
      return;
    }
    const data = (await res.json()) as {
      buildId: string;
      alreadyRunning: boolean;
    };
    attachToBuild(data.buildId, {
      reset: true,
      resuming: data.alreadyRunning,
    });
  }, [employee, ceoContext, phase, attachToBuild]);

  /**
   * On mount: probe `/active`. If a build is already running for this
   * employee, reattach automatically — the CEO sees the live feed picking up
   * mid-stride instead of the empty preflight state.
   */
  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    fetch(`/api/twin-builder/${employee.id}/active`, { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (data: {
          active: { buildId: string; startedAt: string } | null;
        }) => {
          if (cancelled || !data.active) return;
          attachToBuild(data.active.buildId, { reset: true, resuming: true });
        }
      )
      .catch(() => {
        /* probe failed — show preflight as usual */
      });
    return () => {
      cancelled = true;
    };
  }, [employee, attachToBuild]);

  // Tear down the EventSource on unmount.
  useEffect(() => closeStream, [closeStream]);

  const handleEvent = useCallback((evt: TwinBuilderEvent) => {
    switch (evt.type) {
      case "start":
        setActiveToolkits(evt.activeToolkits);
        setFeed((f) => [
          ...f,
          {
            id: `info-${evt.ts}`,
            kind: "info" as const,
            action:
              evt.activeToolkits.length > 0 ? "Connected" : "No connections",
            detail:
              evt.activeToolkits.length > 0
                ? evt.activeToolkits.join(" · ")
                : "Using org-level MCP only",
            ts: evt.ts,
          },
        ]);
        break;
      case "plan":
        setNarration((n) => n + evt.text);
        break;
      case "text_delta":
        setNarration((n) => n + evt.delta);
        break;
      case "tool_use": {
        const desc = describeToolForFeed(evt.tool, evt.input);
        setFeed((f) =>
          [
            ...f,
            {
              id: `t-${evt.ts}-${Math.random().toString(36).slice(2, 7)}`,
              kind: desc.kind,
              action: desc.action,
              toolkit: desc.toolkit,
              detail: desc.detail,
              ts: evt.ts,
            },
          ].slice(-200)
        );
        break;
      }
      case "tool_result":
        // Don't pollute the feed — tool_result is implicit from the next tool.
        break;
      case "tool_blocked":
      case "file_blocked":
        setFeed((f) =>
          [
            ...f,
            {
              id: `b-${evt.ts}-${Math.random().toString(36).slice(2, 7)}`,
              kind: "blocked" as const,
              action: "Blocked",
              detail:
                evt.type === "file_blocked"
                  ? `${evt.filename} — ${evt.reason}`
                  : `${bareToolName(evt.tool)} — ${evt.reason}`,
              ts: evt.ts,
            },
          ].slice(-200)
        );
        break;
      case "file_writing":
        setFiles((map) => ({
          ...map,
          [evt.filename]: {
            status: "writing",
            content: evt.content,
            sizeBytes: new Blob([evt.content]).size,
          },
        }));
        setActiveFile(evt.filename);
        setFeed((f) =>
          [
            ...f,
            {
              id: `w-${evt.ts}-${evt.filename}`,
              kind: "write" as const,
              action: "Writing",
              detail: `${evt.filename} · ${evt.content.length.toLocaleString()} chars`,
              ts: evt.ts,
            },
          ].slice(-200)
        );
        break;
      case "file_done":
        setFiles((map) => ({
          ...map,
          [evt.filename]: {
            ...map[evt.filename],
            status: "done",
            sizeBytes: evt.sizeBytes,
            finishedAt: evt.ts,
          },
        }));
        setFeed((f) =>
          [
            ...f,
            {
              id: `d-${evt.ts}-${evt.filename}`,
              kind: "result" as const,
              action: "Saved",
              detail: `${evt.filename} · ${(evt.sizeBytes / 1024).toFixed(1)} KB`,
              ts: evt.ts,
            },
          ].slice(-200)
        );
        break;
      case "error":
        setErrorMsg(evt.message);
        setFeed((f) =>
          [
            ...f,
            {
              id: `e-${evt.ts}`,
              kind: "blocked" as const,
              action: "Error",
              detail: evt.message,
              ts: evt.ts,
            },
          ].slice(-200)
        );
        break;
      case "build_recorded":
        setRecorded({ buildId: evt.buildId, version: evt.version });
        setFeed((f) =>
          [
            ...f,
            {
              id: `br-${evt.ts}`,
              kind: "result" as const,
              action: `Saved as v${evt.version}`,
              detail: `${evt.filesInManifest.length} files in manifest`,
              ts: evt.ts,
            },
          ].slice(-200)
        );
        break;
      case "done":
        setTurns(evt.turns);
        setCostUsd(evt.costUsd);
        setStoppedReason(evt.stoppedReason);
        setPhase(evt.stoppedReason === "no_connections" ? "error" : "done");
        break;
    }
  }, []);

  /**
   * "Stop watching" — closes the EventSource so the UI returns to idle.
   * The build itself keeps running on the server. The CEO can come back
   * any time and the on-mount probe will reattach.
   */
  const stopWatching = useCallback(() => {
    closeStream();
    setPhase("idle");
    setActiveBuildId(null);
    setReattached(false);
  }, [closeStream]);

  const filesArr = useMemo(
    () => TWIN_FILE_NAMES.map((name) => ({ name, ...files[name] })),
    [files]
  );
  const completed = filesArr.filter((f) => f.status === "done").length;

  if (!employeeId) {
    return (
      <Centered>
        <h1>Missing employee</h1>
        <p className="muted" style={{ fontSize: "var(--fs-ui)" }}>
          Append <code>?employee=&lt;id&gt;</code> to the URL.
        </p>
        <Link href="/employees" className="btn">
          Back to employees
        </Link>
      </Centered>
    );
  }
  if (!employee) {
    return (
      <Centered>
        <Icons.Loader size={16} /> Loading employee…
      </Centered>
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background: "var(--bg)",
      }}
    >
      {/* ─── Header ───────────────────────────────────────────────────── */}
      <header
        style={{
          padding: "14px 22px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg-elevated)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-14)",
        }}
      >
        <Link
          href={`/profile?employee=${employee.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-6)",
            color: "var(--text-subtle)",
            fontSize: "var(--fs-sm)",
            textDecoration: "none",
          }}
        >
          ← {employee.firstName}'s profile
        </Link>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: "var(--sp-10)", alignItems: "center" }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                background: employee.avatarColor,
                color: "var(--text)",
                display: "grid",
                placeItems: "center",
                fontSize: "var(--fs-meta)",
                fontWeight: 700,
              }}
            >
              {employee.initials}
            </div>
            <div style={{ fontSize: "var(--fs-base)", fontWeight: 600 }}>
              Building twin · {employee.name}
            </div>
            <span
              className="mono"
              style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)" }}
            >
              {employee.role}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: "var(--sp-14)", alignItems: "center" }}>
          <Stat label="Files" value={`${completed}/9`} />
          <Stat label="Turns" value={String(turns)} />
          <Stat label="Cost" value={`$${costUsd.toFixed(3)}`} />
          {phase === "running" && (
            <Stat label="Elapsed" value={fmtTime(elapsedMs)} />
          )}
          {phase === "running" ? (
            <button
              className="btn"
              onClick={stopWatching}
              title="Closes the live view — the build keeps running in the background. Come back any time."
            >
              <Icons.X size={11} /> Stop watching
            </button>
          ) : phase === "idle" ? (
            <>
              <label
                className="row"
                style={{
                  gap: "var(--sp-6)",
                  alignItems: "center",
                  fontSize: "var(--fs-meta)",
                  color: "var(--text-subtle)",
                }}
                title="How far back to search the connected systems for evidence. 30–360 days."
              >
                <span>Window</span>
                <input
                  type="range"
                  min={30}
                  max={360}
                  step={30}
                  value={lookbackDays}
                  onChange={(e) => setLookbackDays(Number(e.target.value))}
                  style={{ width: 100, accentColor: "var(--text)", cursor: "pointer" }}
                />
                <span className="mono" style={{ fontSize: "var(--fs-meta)", minWidth: 56 }}>
                  {lookbackDays}d
                </span>
              </label>
              <button className="btn primary" onClick={start}>
                <Icons.Spark size={12} /> Start build
              </button>
            </>
          ) : (
            <button className="btn" onClick={start}>
              <Icons.Refresh size={12} /> Run again
            </button>
          )}
        </div>
      </header>

      {/* ─── Main 3-column ────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px minmax(0, 1fr) 360px",
          minHeight: 0,
        }}
      >
        {/* Left: file tree */}
        <aside
          style={{
            borderRight: "1px solid var(--hairline)",
            overflow: "auto",
            background: "var(--bg-sunken)",
          }}
          className="scrollbar"
        >
          <div
            style={{
              padding: "14px 18px 8px",
              fontSize: "var(--fs-xs)",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-subtle)",
            }}
          >
            data/employees/{employee.id}/
          </div>
          <div style={{ padding: "0 8px 14px" }}>
            {filesArr.map((f) => (
              <FileRow
                key={f.name}
                name={f.name}
                status={f.status}
                sizeBytes={f.sizeBytes}
                hint={FILE_HINTS[f.name]}
                isActive={activeFile === f.name}
                onClick={() => setActiveFile(f.name)}
              />
            ))}
          </div>

          {activeToolkits.length > 0 && (
            <div
              style={{
                padding: "14px 18px",
                borderTop: "1px solid var(--hairline)",
              }}
            >
              <div
                style={{
                  fontSize: "var(--fs-xs)",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-subtle)",
                  marginBottom: "var(--sp-8)",
                }}
              >
                Connected systems
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: "var(--sp-6)" }}>
                {activeToolkits.map((tk) => (
                  <span
                    key={tk}
                    className="mono"
                    style={{
                      fontSize: "var(--fs-xs)",
                      padding: "3px 7px",
                      borderRadius: 4,
                      background: "var(--surface)",
                      border: "1px solid var(--hairline)",
                    }}
                  >
                    {tk}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Center: active file content */}
        <main
          className="scrollbar"
          style={{
            overflow: "auto",
            padding: "20px 32px 40px",
            minWidth: 0,
          }}
        >
          {activeFile ? (
            <FilePreview
              filename={activeFile}
              state={files[activeFile]}
              employeeId={employee.id}
            />
          ) : phase === "running" ? (
            <NarrationView text={narration} />
          ) : phase === "done" || phase === "error" ? (
            <FinalSummary
              completed={completed}
              stoppedReason={stoppedReason}
              errorMsg={errorMsg}
              employeeId={employee.id}
              employeeFirstName={employee.firstName}
              recorded={recorded}
            />
          ) : (
            <PreFlight employee={employee} ceoContext={ceoContext} />
          )}
        </main>

        {/* Right: tool feed */}
        <aside
          style={{
            borderLeft: "1px solid var(--hairline)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-elevated)",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "14px 18px 10px",
              fontSize: "var(--fs-xs)",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-subtle)",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            Agent activity
          </div>
          <div
            ref={feedScrollRef}
            className="scrollbar"
            style={{
              flex: 1,
              overflow: "auto",
              padding: "8px 10px",
              minHeight: 0,
            }}
          >
            <AnimatePresence initial={false}>
              {feed.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </AnimatePresence>
            {feed.length === 0 && (
              <div
                className="subtle"
                style={{ padding: "14px 8px", fontSize: "var(--fs-meta)" }}
              >
                Nothing yet. Press <strong>Start build</strong>.
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ─── Bottom status ────────────────────────────────────────────── */}
      <footer
        style={{
          padding: "8px 22px",
          borderTop: "1px solid var(--hairline)",
          fontSize: "var(--fs-meta)",
          color: "var(--text-subtle)",
          display: "flex",
          gap: "var(--sp-18)",
          alignItems: "center",
          background: "var(--bg-elevated)",
        }}
      >
        {phase === "idle" && <span>Ready.</span>}
        {phase === "running" && (
          <>
            <span className="row" style={{ gap: "var(--sp-6)" }}>
              <span className="dot success pulse" />
              {reattached
                ? "Reattached to in-flight build"
                : "Sonnet 4.6 working"}{" "}
              — {completed}/9 files written
            </span>
            {activeBuildId && (
              <span
                className="mono subtle"
                style={{ fontSize: "var(--fs-xs)" }}
                title={`buildId ${activeBuildId} — leave the page and the build keeps running. Come back any time, this view will reattach automatically.`}
              >
                runs in background · safe to leave
              </span>
            )}
          </>
        )}
        {phase === "done" && (
          <span className="row" style={{ gap: "var(--sp-6)" }}>
            <Icons.CheckCircle size={12} />
            Build complete · {completed}/9 files · {turns} turns · $
            {costUsd.toFixed(3)} · stopped: {stoppedReason}
          </span>
        )}
        {phase === "error" && (
          <span style={{ color: "var(--danger)" }}>
            {errorMsg || stoppedReason || "Build failed"}
          </span>
        )}
      </footer>
    </div>
  );
}

export default function TwinBuildPage() {
  return (
    <Suspense fallback={null}>
      <TwinBuildContent />
    </Suspense>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 50 }}>
      <div
        className="section-title"
        style={{ fontSize: "var(--fs-2xs)", marginBottom: 0, color: "var(--text-subtle)" }}
      >
        {label}
      </div>
      <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function FileRow({
  name,
  status,
  sizeBytes,
  hint,
  isActive,
  onClick,
}: {
  name: TwinFileName;
  status: FileStatus;
  sizeBytes: number;
  hint: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const dotColor =
    status === "done"
      ? "var(--success, #2c8b54)"
      : status === "writing"
      ? "var(--accent-deep, #2563eb)"
      : "var(--text-subtle)";
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        margin: "2px 0",
        borderRadius: 5,
        border: "1px solid " + (isActive ? "var(--hairline-strong)" : "transparent"),
        background: isActive ? "var(--surface)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div className="row" style={{ gap: "var(--sp-9)", alignItems: "center" }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
            boxShadow:
              status === "writing"
                ? `0 0 0 0 ${dotColor}`
                : "none",
            animation: status === "writing" ? "pulse 1.4s infinite" : "none",
          }}
        />
        <span
          className="mono"
          style={{ fontSize: "var(--fs-sm)", fontWeight: 600, flex: 1 }}
        >
          {name}
        </span>
        {sizeBytes > 0 && (
          <span
            className="subtle mono"
            style={{ fontSize: "var(--fs-xs)" }}
          >
            {sizeBytes < 1024
              ? `${sizeBytes}B`
              : `${(sizeBytes / 1024).toFixed(1)}K`}
          </span>
        )}
      </div>
      <div
        className="subtle"
        style={{
          fontSize: "var(--fs-xs)",
          marginTop: "var(--sp-3)",
          marginLeft: 17,
          lineHeight: 1.4,
        }}
      >
        {hint}
      </div>
      <style jsx>{`
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 ${dotColor}; }
          70%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </button>
  );
}

function FilePreview({
  filename,
  state,
  employeeId,
}: {
  filename: TwinFileName;
  state: FileState;
  employeeId: string;
}) {
  const [diskBody, setDiskBody] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // If we don't have content from a streamed file_writing event, fetch from disk.
  useEffect(() => {
    if (state.content) {
      setDiskBody("");
      return;
    }
    if (state.status === "pending") {
      setDiskBody("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/employees/${employeeId}/file/${filename}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const body =
          (data && (data.body || data.markdown || data.content)) ?? "";
        setDiskBody(typeof body === "string" ? body : "");
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filename, state.status, state.content, employeeId]);

  const body = state.content || diskBody;

  return (
    <div style={{ maxWidth: 800 }}>
      <div
        className="row"
        style={{ gap: "var(--sp-10)", alignItems: "baseline", marginBottom: "var(--sp-14)" }}
      >
        <h2
          className="mono"
          style={{
            fontSize: "var(--fs-h4)",
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {filename}
        </h2>
        <span
          className="subtle mono"
          style={{ fontSize: "var(--fs-meta)" }}
        >
          {state.status === "done"
            ? "saved"
            : state.status === "writing"
            ? "writing…"
            : "pending"}
        </span>
        <div className="spacer" />
        {body && (
          <span className="subtle mono" style={{ fontSize: "var(--fs-meta)" }}>
            {body.length.toLocaleString()} chars
          </span>
        )}
      </div>
      {!body && state.status === "pending" && (
        <div className="muted" style={{ fontSize: "var(--fs-ui)" }}>
          Not written yet. Waiting for the agent to gather evidence.
        </div>
      )}
      {!body && state.status !== "pending" && loading && (
        <div className="muted" style={{ fontSize: "var(--fs-ui)" }}>
          <Icons.Loader size={12} /> Loading…
        </div>
      )}
      {body && (
        <article
          className="markdown-body"
          style={{
            fontSize: 13.5,
            lineHeight: 1.65,
            color: "var(--text)",
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}

function NarrationView({ text }: { text: string }) {
  if (!text) {
    return (
      <div
        className="muted"
        style={{
          fontSize: "var(--fs-ui)",
          padding: "60px 0",
          textAlign: "center",
        }}
      >
        <Icons.Loader size={16} />
        <div style={{ marginTop: "var(--sp-10)" }}>Agent is planning…</div>
      </div>
    );
  }
  return (
    <article
      className="markdown-body"
      style={{
        maxWidth: 800,
        fontSize: 13.5,
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        color: "var(--text-muted)",
      }}
    >
      {text}
    </article>
  );
}

function PreFlight({
  employee,
  ceoContext,
}: {
  employee: EmployeeWithTwin;
  ceoContext?: string;
}) {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1
        style={{
          fontSize: "var(--fs-h3)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "8px 0 4px",
        }}
      >
        Build {employee.firstName}'s twin from connected systems
      </h1>
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        Sonnet 4.6 will plan a research path across the systems {employee.firstName}{" "}
        connected, run read-only tool calls to gather evidence, and write 9
        markdown files into <code>data/employees/{employee.id}/</code>.
        Every file the agent writes appears in the tree on the left in real time;
        every tool call shows up in the agent activity feed on the right.
      </p>
      <div
        className="card"
        style={{ padding: "var(--sp-16)", marginTop: "var(--sp-18)", fontSize: 12.5 }}
      >
        <strong>Ground rules</strong>
        <ul style={{ margin: "8px 0 0", paddingLeft: "var(--sp-18)", lineHeight: 1.6 }}>
          <li>The agent is sandboxed to read-only tools — no messages sent, no issues created.</li>
          <li>Writes are restricted to the 9 known filenames in the employee folder.</li>
          <li>Default budget cap: $5. Stop the run any time.</li>
        </ul>
      </div>
      {ceoContext && (
        <div
          className="card"
          style={{
            padding: "var(--sp-14)",
            marginTop: "var(--sp-14)",
            fontSize: 12.5,
            background: "var(--bg-sunken)",
          }}
        >
          <div
            className="section-title"
            style={{ marginBottom: "var(--sp-6)" }}
          >
            CEO context
          </div>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
            {ceoContext}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Feed card ───────────────────────────────────────────────────────────────

const KIND_THEME: Record<
  ToolFeedKind,
  {
    label: string;
    Icon: React.ComponentType<{ size?: number }>;
    fg: string;
    bgSoft: string;
    border: string;
    accent: string;
  }
> = {
  read: {
    label: "read",
    Icon: ({ size }) => <Icons.Eye size={size ?? 10} />,
    fg: "#2563eb",
    bgSoft: "rgba(37, 99, 235, 0.10)",
    border: "rgba(37, 99, 235, 0.22)",
    accent: "#2563eb",
  },
  write: {
    label: "write",
    Icon: ({ size }) => <Icons.Pencil size={size ?? 10} />,
    fg: "#7c3aed",
    bgSoft: "rgba(124, 58, 237, 0.10)",
    border: "rgba(124, 58, 237, 0.22)",
    accent: "#7c3aed",
  },
  blocked: {
    label: "block",
    Icon: ({ size }) => <Icons.Lock size={size ?? 10} />,
    fg: "var(--danger, #c2410c)",
    bgSoft: "rgba(220, 80, 60, 0.10)",
    border: "rgba(220, 80, 60, 0.28)",
    accent: "#c2410c",
  },
  result: {
    label: "ok",
    Icon: ({ size }) => <Icons.CheckCircle size={size ?? 10} />,
    fg: "#15803d",
    bgSoft: "rgba(40, 160, 90, 0.10)",
    border: "rgba(40, 160, 90, 0.28)",
    accent: "#15803d",
  },
  info: {
    label: "info",
    Icon: ({ size }) => <Icons.Spark size={size ?? 10} />,
    fg: "var(--text-subtle)",
    bgSoft: "var(--bg-sunken)",
    border: "var(--hairline)",
    accent: "var(--text-muted)",
  },
};

function fmtRelTs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function FeedCard({ item }: { item: ToolFeedItem }) {
  const theme = KIND_THEME[item.kind];
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{
        padding: "8px 10px 8px 11px",
        marginBottom: "var(--sp-6)",
        borderRadius: 6,
        background: "var(--surface)",
        border: `1px solid ${theme.border}`,
        borderLeft: `3px solid ${theme.accent}`,
        fontSize: "var(--fs-meta)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Header row: kind badge + toolkit chip + spacer + elapsed */}
      <div
        className="row"
        style={{ gap: "var(--sp-6)", alignItems: "center", marginBottom: item.detail ? 4 : 0 }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-4)",
            padding: "1px 6px 1px 5px",
            borderRadius: 999,
            fontSize: "var(--fs-2xs)",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: theme.fg,
            background: theme.bgSoft,
            border: `1px solid ${theme.border}`,
            flexShrink: 0,
          }}
        >
          <theme.Icon size={9} />
          {theme.label}
        </span>

        {item.toolkit && (
          <span
            className="row"
            style={{
              gap: "var(--sp-4)",
              alignItems: "center",
              padding: "1px 6px 1px 4px",
              borderRadius: 999,
              background: "var(--bg-sunken)",
              border: "1px solid var(--hairline)",
              fontSize: "var(--fs-xs)",
              fontWeight: 500,
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          >
            <ToolkitIcon slug={item.toolkit} size={11} />
            {item.toolkit}
          </span>
        )}

        <span
          className="mono"
          style={{
            fontSize: "var(--fs-meta)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={item.action}
        >
          {item.action}
        </span>

        <span
          className="mono"
          style={{
            fontSize: "var(--fs-2xs)",
            color: "var(--text-subtle)",
            flexShrink: 0,
          }}
        >
          +{fmtRelTs(item.ts)}
        </span>
      </div>

      {item.detail && (
        <div
          className="subtle"
          style={{
            fontSize: "var(--fs-xs)",
            lineHeight: 1.45,
            color: "var(--text-muted)",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          {item.detail}
        </div>
      )}
    </motion.div>
  );
}

function FinalSummary({
  completed,
  stoppedReason,
  errorMsg,
  employeeId,
  employeeFirstName,
  recorded,
}: {
  completed: number;
  stoppedReason: string;
  errorMsg: string;
  employeeId: string;
  employeeFirstName: string;
  recorded: { buildId: string; version: number } | null;
}) {
  const allDone = completed === 9;
  return (
    <div style={{ maxWidth: 700 }}>
      <h1
        style={{
          fontSize: "var(--fs-h3)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "8px 0 6px",
        }}
      >
        {allDone
          ? `${employeeFirstName}'s twin profile is ready`
          : `${completed}/9 files written`}
      </h1>
      {recorded && (
        <Link
          href={`/profile?employee=${employeeId}#versions`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-8)",
            padding: "5px 12px",
            background: "var(--accent-soft)",
            color: "var(--accent-deep)",
            borderRadius: 999,
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
            textDecoration: "none",
            margin: "4px 0 12px",
          }}
        >
          <Icons.Spark size={11} /> Saved as v{recorded.version} · view in
          Versions →
        </Link>
      )}
      {stoppedReason === "no_connections" && (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {employeeFirstName} has no active toolkit connections.{" "}
          <Link href={`/connections/${employeeId}`}>Connect tools →</Link>
        </p>
      )}
      {stoppedReason === "max_budget" && (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Stopped — hit the budget cap. Click <strong>Run again</strong> to
          continue with a higher cap, or open the files that were written.
        </p>
      )}
      {stoppedReason === "max_turns" && (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Stopped — hit the turn cap. Click <strong>Run again</strong> to
          continue.
        </p>
      )}
      {errorMsg && (
        <p style={{ color: "var(--danger)", fontSize: "var(--fs-ui)" }}>{errorMsg}</p>
      )}
      <div className="row" style={{ gap: "var(--sp-10)", marginTop: "var(--sp-18)" }}>
        <Link
          href={`/profile?employee=${employeeId}`}
          className="btn primary"
          style={{ textDecoration: "none" }}
        >
          <Icons.Eye size={12} /> Open profile
        </Link>
        <Link
          href={`/flow?employee=${employeeId}`}
          className="btn"
          style={{ textDecoration: "none" }}
        >
          <Icons.Bot size={12} /> Chat with twin
        </Link>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        gap: "var(--sp-12)",
      }}
    >
      <div
        style={{
          textAlign: "center",
          fontSize: "var(--fs-ui)",
          color: "var(--text-subtle)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
