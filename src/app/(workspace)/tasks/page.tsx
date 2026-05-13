"use client";

import { useState, useRef, useEffect, useCallback, type CSSProperties } from "react";
import { Icons } from "@/components/ex/icons";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { Topbar } from "@/components/ex/shell";
import { Markdown } from "@/components/ex/markdown";
import { PageHead } from "@/components/ex/page-head";
import {
  EmployeeCanvasPanel,
  type EmployeeCanvas,
} from "@/components/ex/employee-canvas";
import {
  EMPLOYEES_WITH_TWIN,
  type EmployeeWithTwin,
} from "@/lib/employees";
import {
  filterTemplates,
  type TaskTemplate,
} from "@/lib/task-templates";
import { humanizeToolAction } from "@/lib/tool-humanize";

// ─── SSE event types ─────────────────────────────────────────────────────────

type TaskSSEEvent =
  | { type: "start"; employeeId: string; employeeName: string }
  | { type: "text_delta"; delta: string; ts: number }
  | {
      type: "artifact";
      artifactId: string;
      payload: { type: "html" | "svg"; title: string; content: string };
      ts: number;
    }
  | { type: "tool_use"; tool: string; input: unknown; ts: number }
  | { type: "tool_result"; tool: string; ts: number }
  | {
      type: "tool_approval_request";
      approvalId: string;
      tool: string;
      label: string;
      input: Record<string, unknown>;
      reason: string;
      ts: number;
    }
  | {
      type: "tool_approval_resolved";
      approvalId: string;
      decision: "allow" | "deny";
      ts: number;
    }
  | { type: "tool_blocked"; tool: string; reason: string; ts: number }
  | {
      type: "done";
      confidence: number;
      turns: number;
      costUsd?: number;
      stoppedReason?: "max_budget" | "max_turns" | "natural";
      ts: number;
    }
  | { type: "error"; message: string };

type TaskLogEntry =
  | { kind: "text"; content: string }
  | { kind: "canvas"; canvas: EmployeeCanvas }
  | {
      kind: "tool_use";
      tool: string;
      input: unknown;
      status: "pending" | "done";
    }
  | { kind: "tool_result"; tool: string }
  | {
      kind: "approval_request";
      approvalId: string;
      tool: string;
      label: string;
      input: Record<string, unknown>;
      reason: string;
    }
  | { kind: "approval_resolved"; approvalId: string; decision: "allow" | "deny" }
  | { kind: "tool_blocked"; tool: string; reason: string }
  | {
      kind: "done";
      confidence: number;
      turns: number;
      costUsd?: number;
      stoppedReason?: "max_budget" | "max_turns" | "natural";
    }
  | { kind: "error"; message: string };

// ─── Task history types (mirror src/lib/task-history.ts) ────────────────────

type TaskStatus = "running" | "complete" | "error" | "aborted";

type TaskRun = {
  id: string;
  employeeId: string;
  employeeName: string;
  task: string;
  startedAt: string;
  endedAt?: string;
  status: TaskStatus;
  finalText?: string;
  toolCalls: number;
  approvalsRequested: number;
  approvalsApproved: number;
  approvalsDenied: number;
  blockedTools: number;
  confidence?: number;
  turns?: number;
  errorMessage?: string;
  costUsd?: number;
  budgetUsd?: number;
  stoppedReason?: "max_budget" | "max_turns" | "natural";
};

type PersistedEvent = {
  ts: number;
  type:
    | "start"
    | "text_delta"
    | "artifact"
    | "tool_use"
    | "tool_result"
    | "tool_approval_request"
    | "tool_approval_resolved"
    | "tool_blocked"
    | "done"
    | "error";
  data: Record<string, unknown>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bareName(tool: string): string {
  return tool.replace(/^mcp__[a-z0-9_]+__/i, "");
}

function relTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/**
 * Format a USD amount for compact display. Tasks are typically pennies so we
 * show at least 4 decimal places below 1 cent, then 3, then 2.
 */
function formatCost(usd: number): string {
  if (!usd && usd !== 0) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function durationLabel(start: string, end?: string): string | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/**
 * Convert persisted events back into the same TaskLogEntry shape used by the
 * live stream so the replay UI can reuse TaskLogRow unchanged.
 *
 * Consecutive text_delta events are coalesced into a single "text" entry to
 * match how the live stream flushes them.
 */
function eventsToLog(events: PersistedEvent[]): TaskLogEntry[] {
  const out: TaskLogEntry[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      out.push({ kind: "text", content: buffer });
      buffer = "";
    }
  };
  for (const evt of events) {
    switch (evt.type) {
      case "text_delta":
        buffer += String(evt.data.delta ?? "");
        break;
      case "artifact": {
        flush();
        const payload = (evt.data.payload && typeof evt.data.payload === "object"
          ? evt.data.payload
          : {}) as Partial<EmployeeCanvas>;
        const type = payload.type === "html" || payload.type === "svg" ? payload.type : null;
        if (type && typeof payload.title === "string" && typeof payload.content === "string") {
          out.push({
            kind: "canvas",
            canvas: {
              artifactId: String(evt.data.artifactId ?? `canvas_${evt.ts}`),
              type,
              title: payload.title,
              content: payload.content,
            },
          });
        }
        break;
      }
      case "tool_use":
        flush();
        out.push({
          kind: "tool_use",
          tool: String(evt.data.tool ?? ""),
          input: evt.data.input,
          status: "pending",
        });
        break;
      case "tool_result": {
        flush();
        // Find the most recent pending tool_use and mark it done. If we can't
        // find one, fall back to a standalone tool_result entry (orphan).
        const toolName = String(evt.data.tool ?? "");
        let matched = false;
        for (let i = out.length - 1; i >= 0; i--) {
          const e = out[i];
          if (e.kind === "tool_use" && e.status === "pending") {
            out[i] = { ...e, status: "done" };
            matched = true;
            break;
          }
        }
        if (!matched) {
          out.push({ kind: "tool_result", tool: toolName });
        }
        break;
      }
      case "tool_approval_request":
        flush();
        out.push({
          kind: "approval_request",
          approvalId: String(evt.data.approvalId ?? ""),
          tool: String(evt.data.tool ?? ""),
          label: String(evt.data.label ?? ""),
          input: (evt.data.input as Record<string, unknown>) ?? {},
          reason: String(evt.data.reason ?? ""),
        });
        break;
      case "tool_approval_resolved":
        flush();
        out.push({
          kind: "approval_resolved",
          approvalId: String(evt.data.approvalId ?? ""),
          decision: (evt.data.decision as "allow" | "deny") ?? "deny",
        });
        break;
      case "tool_blocked":
        flush();
        out.push({
          kind: "tool_blocked",
          tool: String(evt.data.tool ?? ""),
          reason: String(evt.data.reason ?? ""),
        });
        break;
      case "done":
        flush();
        out.push({
          kind: "done",
          confidence: Number(evt.data.confidence ?? 0),
          turns: Number(evt.data.turns ?? 0),
          costUsd:
            typeof evt.data.costUsd === "number"
              ? evt.data.costUsd
              : undefined,
          stoppedReason: evt.data.stoppedReason as
            | "max_budget"
            | "max_turns"
            | "natural"
            | undefined,
        });
        break;
      case "error":
        flush();
        out.push({
          kind: "error",
          message: String(evt.data.message ?? "Unknown error"),
        });
        break;
      default:
        break;
    }
  }
  flush();
  return out;
}

const READY_EMPLOYEES = EMPLOYEES_WITH_TWIN.filter((e) => e.twinStatus === "ready");

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [selectedId, setSelectedId] = useState<string>(
    READY_EMPLOYEES[0]?.id ?? ""
  );
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<TaskLogEntry[]>([]);
  const [textBuffer, setTextBuffer] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Slash command menu state
  const [slashIndex, setSlashIndex] = useState(0);
  const [allTemplates, setAllTemplates] = useState<TaskTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  // Save-as-template inline modal
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalName, setSaveModalName] = useState("");
  const [saveModalError, setSaveModalError] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      const data = (await res.json()) as { templates: TaskTemplate[] };
      setAllTemplates(data.templates ?? []);
    } catch {
      // best-effort — fall back to empty list (slash menu will be empty)
    }
  }, []);

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  // Connection state for the selected employee
  const [connections, setConnections] = useState<
    Record<string, { status: string; toolkit: string }>
  >({});
  const [allowedToolkits, setAllowedToolkits] = useState<string[]>([]);
  const [loadingConn, setLoadingConn] = useState(false);

  // Task history (recent runs + currently expanded run with events)
  const [history, setHistory] = useState<TaskRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<PersistedEvent[] | null>(null);
  const [loadingExpanded, setLoadingExpanded] = useState(false);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?limit=20");
      const data = (await res.json()) as { runs: TaskRun[] };
      setHistory(data.runs ?? []);
    } catch {
      // ignore — history is best-effort
    }
  }, []);

  // Initial history load
  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // Load events for the expanded run
  useEffect(() => {
    if (!expandedRunId) {
      setExpandedEvents(null);
      return;
    }
    let cancelled = false;
    setLoadingExpanded(true);
    setExpandedEvents(null);
    fetch(`/api/tasks/${expandedRunId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setExpandedEvents((data.events ?? []) as PersistedEvent[]);
      })
      .catch(() => {
        if (!cancelled) setExpandedEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingExpanded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedRunId]);

  const selected = EMPLOYEES_WITH_TWIN.find((e) => e.id === selectedId);

  // Fetch connections whenever selected employee changes
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoadingConn(true);
    fetch(`/api/connections/${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setConnections(
          (data.connections ?? {}) as Record<
            string,
            { status: string; toolkit: string }
          >
        );
        setAllowedToolkits((data.allowedToolkits ?? []) as string[]);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingConn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const activeToolkits = Object.entries(connections)
    .filter(([, v]) => v.status === "ACTIVE")
    .map(([k]) => k);
  const disconnectedToolkits = allowedToolkits.filter(
    (t) => !activeToolkits.includes(t)
  );

  // Slash menu opens when the textarea starts with "/" and contains no newline
  // (so users can type `/pr` etc. but keep multi-line tasks free of triggers).
  const slashOpen = task.startsWith("/") && !task.includes("\n");
  const slashQuery = slashOpen ? task.slice(1) : "";
  const slashMatches: TaskTemplate[] = slashOpen && selectedId
    ? filterTemplates(slashQuery, selectedId, activeToolkits, allTemplates)
    : [];

  // Reset highlighted item whenever the matches list changes shape.
  useEffect(() => {
    setSlashIndex(0);
  }, [slashOpen, slashQuery, selectedId]);

  function applyTemplate(tpl: TaskTemplate) {
    setTask(tpl.task);
    // Defer focus so React commits the value first.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      // Place cursor at end of inserted text.
      textareaRef.current?.setSelectionRange(tpl.task.length, tpl.task.length);
    });
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, textBuffer]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleApproval = useCallback(
    async (approvalId: string, action: "allow" | "deny") => {
      await fetch("/api/council/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, action }),
      });
    },
    []
  );

  async function execute() {
    if (!task.trim() || running || !selectedId) return;
    setRunning(true);
    setLog([]);
    setTextBuffer("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/employees/${selectedId}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task.trim() }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({ error: "Request failed" }));
        setLog([{ kind: "error", message: (errBody as { error: string }).error }]);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: TaskSSEEvent;
          try {
            evt = JSON.parse(line.slice(6)) as TaskSSEEvent;
          } catch {
            continue;
          }

          switch (evt.type) {
            case "text_delta":
              accText += evt.delta;
              setTextBuffer(accText);
              break;
            case "tool_use":
              if (accText) {
                setLog((prev) => [...prev, { kind: "text", content: accText }]);
                accText = "";
                setTextBuffer("");
              }
              setLog((prev) => [
                ...prev,
                {
                  kind: "tool_use",
                  tool: evt.tool,
                  input: evt.input,
                  status: "pending",
                },
              ]);
              break;
            case "artifact":
              if (accText) {
                setLog((prev) => [...prev, { kind: "text", content: accText }]);
                accText = "";
                setTextBuffer("");
              }
              setLog((prev) => [
                ...prev,
                {
                  kind: "canvas",
                  canvas: {
                    artifactId: evt.artifactId,
                    type: evt.payload.type,
                    title: evt.payload.title,
                    content: evt.payload.content,
                  },
                },
              ]);
              break;
            case "tool_result":
              setLog((prev) => {
                // Mark the most recent pending tool_use as done. Fall back to
                // appending a standalone tool_result if none is pending
                // (orphan defensive case).
                for (let i = prev.length - 1; i >= 0; i--) {
                  const e = prev[i];
                  if (e.kind === "tool_use" && e.status === "pending") {
                    const next = prev.slice();
                    next[i] = { ...e, status: "done" };
                    return next;
                  }
                }
                return [...prev, { kind: "tool_result", tool: evt.tool }];
              });
              break;
            case "tool_approval_request":
              if (accText) {
                setLog((prev) => [...prev, { kind: "text", content: accText }]);
                accText = "";
                setTextBuffer("");
              }
              setLog((prev) => [
                ...prev,
                {
                  kind: "approval_request",
                  approvalId: evt.approvalId,
                  tool: evt.tool,
                  label: evt.label,
                  input: evt.input,
                  reason: evt.reason,
                },
              ]);
              break;
            case "tool_approval_resolved":
              setLog((prev) => [
                ...prev,
                {
                  kind: "approval_resolved",
                  approvalId: evt.approvalId,
                  decision: evt.decision,
                },
              ]);
              break;
            case "tool_blocked":
              setLog((prev) => [
                ...prev,
                { kind: "tool_blocked", tool: evt.tool, reason: evt.reason },
              ]);
              break;
            case "done":
              if (accText) {
                setLog((prev) => [...prev, { kind: "text", content: accText }]);
                accText = "";
                setTextBuffer("");
              }
              setLog((prev) => [
                ...prev,
                {
                  kind: "done",
                  confidence: evt.confidence,
                  turns: evt.turns,
                  costUsd: evt.costUsd,
                  stoppedReason: evt.stoppedReason,
                },
              ]);
              break;
            case "error":
              setLog((prev) => [
                ...prev,
                { kind: "error", message: evt.message },
              ]);
              break;
          }
        }
      }

      if (accText) {
        setLog((prev) => [...prev, { kind: "text", content: accText }]);
        setTextBuffer("");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setLog((prev) => [
          ...prev,
          { kind: "error", message: (err as Error).message },
        ]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      // Pull the freshly-persisted task into the history list.
      refreshHistory();
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setRunning(false);
    // Cancellation is recorded by the server's stream `cancel` callback.
    // Give it a beat, then refresh.
    setTimeout(() => { refreshHistory(); }, 250);
  }

  function handleRerun(run: TaskRun) {
    setTask(run.task);
    const isReady = READY_EMPLOYEES.some((e) => e.id === run.employeeId);
    if (isReady) setSelectedId(run.employeeId);
    requestAnimationFrame(() => {
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(run.task.length, run.task.length);
    });
  }

  function openSaveAsTemplate() {
    const text = task.trim();
    if (!text || text.startsWith("/")) return;
    // Derive a sensible default name from the first line of the task.
    const firstLine = text.split("\n")[0].trim();
    const defaultName =
      firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
    setSaveModalName(defaultName);
    setSaveModalError(null);
    setSaveModalOpen(true);
  }

  async function confirmSaveAsTemplate() {
    const name = saveModalName.trim();
    const text = task.trim();
    if (!name) {
      setSaveModalError("Name is required.");
      return;
    }
    if (!text) {
      setSaveModalError("Task text is empty.");
      return;
    }

    setSavingTemplate(true);
    setSaveModalError(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          task: text,
          category: "Custom",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveModalError((err as { error: string }).error);
        return;
      }
      await refreshTemplates();
      setSaveModalOpen(false);
      setSaveModalName("");
    } finally {
      setSavingTemplate(false);
    }
  }

  const hasOutput = log.length > 0 || textBuffer;

  return (
    <>
      <Topbar crumbs={["Workspace", "Tasks"]} />
      <div
        className="scrollbar"
        style={{ overflow: "auto", padding: "32px 40px 60px" }}
      >
        <div style={{ maxWidth: 880 }}>
          <PageHead
            icon="Arrow"
            title="Tasks"
            subtitle="Send a one-off task to a twin. The twin will execute using connected tools (Slack, GitHub, Gmail, etc.) with approval gates for sensitive actions."
            style={{ marginBottom: "var(--sp-20)" }}
          />

          {/* Employee picker + task input */}
          <div
            className="card"
            style={{
              padding: 0,
              // Allow the slash menu to overflow below the card while it's open;
              // otherwise keep `hidden` so inner section borders stay clipped.
              overflow: slashOpen ? "visible" : "hidden",
              marginBottom: "var(--sp-24)",
            }}
          >
            {/* Employee selector row */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--hairline)",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-12)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--fs-sm)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  flexShrink: 0,
                }}
              >
                Assign to
              </span>
              <div
                style={{
                  display: "flex",
                  gap: "var(--sp-8)",
                  flex: 1,
                  flexWrap: "wrap",
                }}
              >
                {READY_EMPLOYEES.map((emp) => (
                  <EmployeeChip
                    key={emp.id}
                    employee={emp}
                    active={emp.id === selectedId}
                    onClick={() => setSelectedId(emp.id)}
                    disabled={running}
                  />
                ))}
              </div>
            </div>

            {/* Available tools */}
            <div
              style={{
                padding: "12px 18px",
                borderBottom: "1px solid var(--hairline)",
                background: "var(--bg-elevated)",
              }}
            >
              <div
                style={{
                  fontSize: "var(--fs-meta)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: "var(--sp-10)",
                }}
              >
                Available tools
              </div>

              {loadingConn ? (
                <div className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
                  Loading connections…
                </div>
              ) : activeToolkits.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-10)",
                    padding: "8px 12px",
                    background: "rgba(180,140,60,0.06)",
                    border: "1px solid var(--warn)",
                    borderRadius: 8,
                    fontSize: "var(--fs-sm)",
                    lineHeight: 1.5,
                  }}
                >
                  <Icons.Plug size={14} style={{ color: "var(--warn)", flexShrink: 0 }} />
                  <div>
                    <span style={{ fontWeight: 600 }}>No tools connected.</span>{" "}
                    <span className="subtle">
                      {selected?.name.split(" ")[0]} needs to connect integrations
                      through their onboarding flow before tasks can be executed.
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
                  {/* Connected */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-8)" }}>
                    {activeToolkits.map((slug) => {
                      const label =
                        slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
                      return (
                        <span
                          key={slug}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "var(--sp-7)",
                            padding: "5px 12px 5px 7px",
                            background: "var(--surface)",
                            border: "1px solid var(--hairline)",
                            borderRadius: 999,
                            fontSize: "var(--fs-sm)",
                            fontWeight: 500,
                          }}
                        >
                          <ToolkitIcon slug={slug.toLowerCase()} size={16} />
                          {label}
                          <Icons.Check
                            size={10}
                            style={{ color: "var(--success)", marginLeft: -2 }}
                          />
                        </span>
                      );
                    })}
                  </div>
                  {/* Disconnected */}
                  {disconnectedToolkits.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "var(--sp-8)",
                        alignItems: "center",
                      }}
                    >
                      {disconnectedToolkits.map((slug) => {
                        const label =
                          slug.charAt(0).toUpperCase() +
                          slug.slice(1).toLowerCase();
                        return (
                          <span
                            key={slug}
                            title={`Not connected — ${selected?.name.split(" ")[0]} can connect via onboarding`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "var(--sp-7)",
                              padding: "5px 12px 5px 7px",
                              background: "transparent",
                              border: "1px dashed var(--hairline)",
                              borderRadius: 999,
                              fontSize: "var(--fs-sm)",
                              fontWeight: 500,
                              color: "var(--text-muted)",
                              opacity: 0.65,
                            }}
                          >
                            <ToolkitIcon slug={slug.toLowerCase()} size={16} />
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Task textarea + slash command menu */}
            <div style={{ position: "relative" }}>
              <textarea
                ref={textareaRef}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder={
                  selected
                    ? `What should ${selected.name.split(" ")[0]} do? Type / for templates, or describe a task in your own words.`
                    : "Select an employee above…"
                }
                disabled={running || !selectedId}
                onKeyDown={(e) => {
                  // Slash menu navigation takes priority over execute shortcut.
                  if (slashOpen && slashMatches.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashIndex((i) => (i + 1) % slashMatches.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashIndex(
                        (i) => (i - 1 + slashMatches.length) % slashMatches.length
                      );
                      return;
                    }
                    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      applyTemplate(slashMatches[slashIndex]);
                      return;
                    }
                    if (e.key === "Tab") {
                      e.preventDefault();
                      applyTemplate(slashMatches[slashIndex]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setTask("");
                      return;
                    }
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) execute();
                }}
                style={{
                  width: "100%",
                  minHeight: 110,
                  padding: "16px 18px",
                  background: "var(--bg-elevated)",
                  border: "none",
                  borderBottom: "1px solid var(--hairline)",
                  fontFamily: "inherit",
                  fontSize: "var(--fs-ui)",
                  lineHeight: 1.6,
                  color: "var(--text)",
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />

              {slashOpen && (
                <SlashMenu
                  matches={slashMatches}
                  highlightedIndex={slashIndex}
                  onHover={setSlashIndex}
                  onPick={applyTemplate}
                  query={slashQuery}
                />
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "10px 18px",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-10)",
              }}
            >
              <div
                className="subtle"
                style={{
                  fontSize: "var(--fs-meta)",
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-8)",
                }}
              >
                <span>{running ? "Running…" : "⌘↵ to execute"}</span>
                <span style={{ opacity: 0.6 }}>·</span>
                <span title="Hard budget cap per task — agent stops if exceeded">
                  Budget cap{" "}
                  <span className="mono" style={{ fontWeight: 600 }}>
                    $0.50
                  </span>
                </span>
              </div>
              {!running && (
                <button
                  className="btn sm ghost"
                  onClick={openSaveAsTemplate}
                  disabled={
                    !task.trim() ||
                    task.trim().startsWith("/") ||
                    savingTemplate
                  }
                  title="Save the current task as a reusable template"
                >
                  <Icons.Plus size={11} /> Save as template
                </button>
              )}
              {running ? (
                <button className="btn sm" onClick={handleCancel}>
                  <Icons.X size={11} /> Cancel
                </button>
              ) : (
                <button
                  className="btn primary sm"
                  onClick={execute}
                  disabled={!task.trim() || !selectedId}
                >
                  <Icons.Zap size={11} /> Execute
                </button>
              )}
            </div>
          </div>

          {/* Output stream */}
          {hasOutput && (
            <div>
              <h2
                style={{
                  fontSize: "var(--fs-ui)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  margin: "0 0 12px",
                }}
              >
                Output
              </h2>
              <div
                className="card scrollbar"
                style={{
                  padding: 0,
                  overflow: "hidden",
                  maxHeight: 600,
                  overflowY: "auto",
                }}
              >
                <div
                  style={{
                    padding: "16px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--sp-12)",
                  }}
                >
                  {log.map((entry, i) => (
                    <TaskLogRow
                      key={i}
                      entry={entry}
                      onApproval={handleApproval}
                    />
                  ))}
                  {textBuffer && (
                    <div style={{ fontSize: "var(--fs-base)", lineHeight: 1.65 }}>
                      <Markdown>{textBuffer}</Markdown>
                    </div>
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          )}

          {/* Recent tasks */}
          <div style={{ marginTop: hasOutput ? 32 : 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-10)",
                marginBottom: "var(--sp-12)",
              }}
            >
              <h2
                style={{
                  fontSize: "var(--fs-ui)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  margin: 0,
                }}
              >
                Recent tasks
              </h2>
              <button
                className="btn ghost sm"
                onClick={refreshHistory}
                title="Refresh history"
                style={{ height: 22 }}
              >
                <Icons.Refresh size={10} />
              </button>
              <div className="spacer" />
              {history.length > 0 && (
                <span className="subtle mono" style={{ fontSize: "var(--fs-meta)" }}>
                  {history.length} run{history.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {history.length === 0 ? (
              <div
                className="card"
                style={{
                  padding: "20px 18px",
                  fontSize: "var(--fs-ui)",
                  color: "var(--text-muted)",
                }}
              >
                No tasks yet. Assign one above to see it here.
              </div>
            ) : (
              <div
                className="card"
                style={{ padding: 0, overflow: "hidden" }}
              >
                {history.map((run, i) => (
                  <HistoryRow
                    key={run.id}
                    run={run}
                    expanded={expandedRunId === run.id}
                    onToggle={() =>
                      setExpandedRunId(
                        expandedRunId === run.id ? null : run.id
                      )
                    }
                    events={
                      expandedRunId === run.id ? expandedEvents : null
                    }
                    loadingEvents={
                      expandedRunId === run.id && loadingExpanded
                    }
                    onApproval={handleApproval}
                    onRerun={handleRerun}
                    isLast={i === history.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save as template modal — overlay rendered at the page root */}
      {saveModalOpen && (
        <div
          onClick={() => !savingTemplate && setSaveModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,16,10,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: 460,
              maxWidth: "90vw",
              padding: 0,
              overflow: "hidden",
              boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--hairline)",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-8)",
              }}
            >
              <Icons.Plus size={13} style={{ color: "var(--accent-deep)" }} />
              <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
                Save as template
              </span>
            </div>
            <div
              style={{
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-12)",
              }}
            >
              <label
                style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}
              >
                <span
                  style={{
                    fontSize: "var(--fs-meta)",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Template name
                </span>
                <input
                  type="text"
                  autoFocus
                  value={saveModalName}
                  onChange={(e) => setSaveModalName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmSaveAsTemplate();
                    if (e.key === "Escape" && !savingTemplate)
                      setSaveModalOpen(false);
                  }}
                  placeholder="e.g. Daily PR digest"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 6,
                    fontSize: "var(--fs-ui)",
                    color: "var(--text)",
                    outline: "none",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </label>
              <div
                className="subtle"
                style={{ fontSize: "var(--fs-meta)", lineHeight: 1.45 }}
              >
                Saved as a Custom template. Edit or delete later from the{" "}
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  Templates
                </span>{" "}
                page.
              </div>

              {saveModalError && (
                <div
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--danger)",
                    padding: "6px 10px",
                    background: "rgba(220,60,60,0.06)",
                    borderRadius: 6,
                    border: "1px solid var(--danger)",
                  }}
                >
                  {saveModalError}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "var(--sp-8)",
                  marginTop: "var(--sp-4)",
                }}
              >
                <button
                  className="btn sm"
                  onClick={() => setSaveModalOpen(false)}
                  disabled={savingTemplate}
                >
                  Cancel
                </button>
                <button
                  className="btn primary sm"
                  onClick={confirmSaveAsTemplate}
                  disabled={savingTemplate || !saveModalName.trim()}
                >
                  {savingTemplate ? "Saving…" : "Save template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Slash Command Menu ─────────────────────────────────────────────────────

function SlashMenu({
  matches,
  highlightedIndex,
  onHover,
  onPick,
  query,
}: {
  matches: TaskTemplate[];
  highlightedIndex: number;
  onHover: (index: number) => void;
  onPick: (tpl: TaskTemplate) => void;
  query: string;
}) {
  // Group by category for visual scanning
  const grouped: Record<string, { template: TaskTemplate; absoluteIndex: number }[]> = {};
  matches.forEach((tpl, i) => {
    const cat = tpl.category ?? "Other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ template: tpl, absoluteIndex: i });
  });

  return (
    <div
      // The menu floats below the textarea. Absolute-positioned within the
      // wrapper so it tracks textarea width without flexbox surprises.
      style={{
        position: "absolute",
        top: "calc(100% - 1px)", // sit on the textarea's bottom border
        left: 0,
        right: 0,
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        borderRadius: "0 0 8px 8px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
        zIndex: 20,
        maxHeight: 360,
        overflowY: "auto",
      }}
      className="scrollbar"
    >
      {matches.length === 0 ? (
        <div
          style={{
            padding: "16px 18px",
            fontSize: "var(--fs-sm)",
            color: "var(--text-muted)",
          }}
        >
          No template matches{query ? ` "${query}"` : ""}. Press{" "}
          <kbd
            style={{
              padding: "1px 6px",
              borderRadius: 4,
              border: "1px solid var(--hairline)",
              fontSize: "var(--fs-xs)",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            Esc
          </kbd>{" "}
          to clear and write your own.
        </div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div
              style={{
                padding: "8px 14px 6px",
                fontSize: "var(--fs-2xs)",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: ".08em",
                background: "var(--bg-elevated)",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              {cat}
            </div>
            {items.map(({ template, absoluteIndex }) => {
              const active = absoluteIndex === highlightedIndex;
              return (
                <button
                  key={template.id}
                  onClick={() => onPick(template)}
                  onMouseEnter={() => onHover(absoluteIndex)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--sp-10)",
                    padding: "9px 14px",
                    background: active
                      ? "var(--accent-soft)"
                      : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "background .08s",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "var(--sp-8)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--fs-ui)",
                          fontWeight: 600,
                          color: active
                            ? "var(--accent-deep)"
                            : "var(--text)",
                        }}
                      >
                        {template.name}
                      </span>
                      <span
                        className="mono subtle"
                        style={{ fontSize: "var(--fs-xs)" }}
                      >
                        /{template.id}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "var(--fs-meta)",
                        color: "var(--text-muted)",
                        marginTop: "var(--sp-2)",
                        lineHeight: 1.45,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {template.description}
                    </div>
                  </div>
                  {active && (
                    <span
                      className="mono subtle"
                      style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-3)", flexShrink: 0 }}
                    >
                      ↵
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))
      )}

      {/* Footer hint */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--hairline)",
          background: "var(--bg-elevated)",
          fontSize: "var(--fs-xs)",
          color: "var(--text-subtle)",
          display: "flex",
          gap: "var(--sp-14)",
        }}
      >
        <span>
          <kbd style={kbdStyle}>↑</kbd>
          <kbd style={kbdStyle}>↓</kbd> navigate
        </span>
        <span>
          <kbd style={kbdStyle}>↵</kbd> select
        </span>
        <span>
          <kbd style={kbdStyle}>Esc</kbd> clear
        </span>
      </div>
    </div>
  );
}

const kbdStyle: CSSProperties = {
  display: "inline-block",
  padding: "0px 5px",
  marginRight: "var(--sp-3)",
  borderRadius: 3,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono, monospace)",
};

// ─── Employee Chip ───────────────────────────────────────────────────────────

function EmployeeChip({
  employee,
  active,
  onClick,
  disabled,
}: {
  employee: EmployeeWithTwin;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-8)",
        padding: "6px 14px 6px 6px",
        borderRadius: 999,
        border: `1.5px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
        background: active ? "var(--accent-soft)" : "var(--surface)",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        transition: "all .12s",
        opacity: disabled && !active ? 0.5 : 1,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: employee.avatarColor,
          display: "grid",
          placeItems: "center",
          fontSize: "var(--fs-2xs)",
          fontWeight: 700,
          color: "var(--text)",
          flexShrink: 0,
        }}
      >
        {employee.initials}
      </div>
      <span
        style={{
          fontSize: "var(--fs-sm)",
          fontWeight: active ? 600 : 500,
          color: active ? "var(--accent-deep)" : "var(--text)",
        }}
      >
        {employee.name.split(" ")[0]}
      </span>
    </button>
  );
}

// ─── History Row ─────────────────────────────────────────────────────────────

function statusBadge(status: TaskStatus) {
  switch (status) {
    case "running":
      return { label: "Running", color: "var(--warn)", bg: "rgba(180,140,60,0.10)" };
    case "complete":
      return { label: "Complete", color: "var(--success)", bg: "rgba(60,140,80,0.10)" };
    case "error":
      return { label: "Error", color: "var(--danger)", bg: "rgba(220,60,60,0.08)" };
    case "aborted":
      return { label: "Aborted", color: "var(--text-muted)", bg: "var(--bg-elevated)" };
  }
}

function HistoryRow({
  run,
  expanded,
  onToggle,
  events,
  loadingEvents,
  onApproval,
  onRerun,
  isLast,
}: {
  run: TaskRun;
  expanded: boolean;
  onToggle: () => void;
  events: PersistedEvent[] | null;
  loadingEvents: boolean;
  onApproval: (approvalId: string, action: "allow" | "deny") => void;
  onRerun: (run: TaskRun) => void;
  isLast: boolean;
}) {
  const employee = EMPLOYEES_WITH_TWIN.find((e) => e.id === run.employeeId);
  const badge = statusBadge(run.status);
  const dur = durationLabel(run.startedAt, run.endedAt);
  const replayLog = events ? eventsToLog(events) : null;

  return (
    <div
      style={{
        borderBottom: !isLast || expanded ? "1px solid var(--hairline)" : "none",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-12)",
          padding: "12px 16px",
          background: expanded ? "var(--bg-elevated)" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
          transition: "background .12s",
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = "var(--bg-elevated)";
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: employee?.avatarColor ?? "var(--surface)",
            display: "grid",
            placeItems: "center",
            fontSize: "var(--fs-xs)",
            fontWeight: 700,
            color: "var(--text)",
            flexShrink: 0,
          }}
        >
          {employee?.initials ?? "?"}
        </div>

        {/* Task text + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 500,
              color: "var(--text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginBottom: "var(--sp-3)",
            }}
          >
            {run.task}
          </div>
          <div
            className="subtle"
            style={{ fontSize: "var(--fs-meta)", display: "flex", gap: "var(--sp-10)", flexWrap: "wrap" }}
          >
            <span>{run.employeeName}</span>
            <span>·</span>
            <span>{relTime(run.startedAt)}</span>
            {dur && (
              <>
                <span>·</span>
                <span className="mono">{dur}</span>
              </>
            )}
            {run.toolCalls > 0 && (
              <>
                <span>·</span>
                <span>
                  {run.toolCalls} tool{run.toolCalls !== 1 ? "s" : ""}
                </span>
              </>
            )}
            {run.approvalsRequested > 0 && (
              <>
                <span>·</span>
                <span>
                  {run.approvalsApproved}/{run.approvalsRequested} approved
                </span>
              </>
            )}
            {typeof run.costUsd === "number" && (
              <>
                <span>·</span>
                <span
                  className="mono"
                  style={{
                    fontWeight: 600,
                    color:
                      run.stoppedReason === "max_budget"
                        ? "var(--danger)"
                        : "var(--text-muted)",
                  }}
                  title={
                    run.budgetUsd
                      ? `Cost ${formatCost(run.costUsd)} of $${run.budgetUsd.toFixed(2)} budget`
                      : `Cost ${formatCost(run.costUsd)}`
                  }
                >
                  {formatCost(run.costUsd)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Status badge */}
        <span
          style={{
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: 999,
            color: badge.color,
            background: badge.bg,
            textTransform: "uppercase",
            letterSpacing: ".05em",
            flexShrink: 0,
          }}
        >
          {badge.label}
        </span>

        <Icons.Chevron
          size={11}
          style={{
            color: "var(--text-subtle)",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform .15s",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Expanded replay */}
      {expanded && (
        <div
          style={{
            padding: "12px 18px 18px",
            background: "var(--bg-elevated)",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          {loadingEvents ? (
            <div className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
              Loading replay…
            </div>
          ) : !replayLog || replayLog.length === 0 ? (
            <div className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
              No event log recorded.
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-12)" }}
            >
              {replayLog.map((entry, i) => (
                <TaskLogRow
                  key={i}
                  entry={entry}
                  onApproval={onApproval}
                />
              ))}
            </div>
          )}

          {/* Re-run button for failed/aborted/budget-capped tasks */}
          {(run.status === "error" || run.status === "aborted" || run.stoppedReason === "max_budget") && (
            <div style={{ marginTop: "var(--sp-14)", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={(e) => { e.stopPropagation(); onRerun(run); }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--sp-6)",
                  padding: "6px 14px",
                  fontSize: "var(--fs-sm)",
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--hairline-strong)",
                  background: "var(--surface)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "background .12s, color .12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-sunken)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--surface)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <Icons.Refresh size={11} />
                Re-run
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tool-use row (humanized, pending/done, click to expand) ────────────────

function ToolUseRow({
  entry,
}: {
  entry: { kind: "tool_use"; tool: string; input: unknown; status: "pending" | "done" };
}) {
  const [open, setOpen] = useState(false);
  const action = humanizeToolAction(entry.tool, entry.input);
  const hasArgs = Boolean(
    entry.input &&
      typeof entry.input === "object" &&
      Object.keys(entry.input as object).length > 0
  );
  const pending = entry.status === "pending";

  return (
    <div
      style={{
        padding: "10px 14px",
        background: "var(--bg-elevated)",
        borderRadius: 8,
        border: "1px solid var(--hairline)",
      }}
    >
      <style jsx>{`
        @keyframes tool-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.78); }
        }
      `}</style>
      <button
        type="button"
        onClick={() => hasArgs && setOpen((o) => !o)}
        disabled={!hasArgs}
        style={{
          all: "unset",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-10)",
          cursor: hasArgs ? "pointer" : "default",
        }}
      >
        {pending ? (
          <span
            aria-label="running"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--accent-deep)",
              animation: "tool-pulse 1.1s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        ) : (
          <Icons.Check
            size={12}
            style={{ color: "var(--accent-deep)", flexShrink: 0 }}
          />
        )}
        <span
          style={{
            fontSize: "var(--fs-ui)",
            color: "var(--text)",
            lineHeight: 1.4,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--accent-deep)" }}>
            {action.verb}
          </span>{" "}
          <span>{action.noun}</span>
          {action.detail ? (
            <span style={{ color: "var(--text-muted)" }}> {action.detail}</span>
          ) : null}
        </span>
        {hasArgs && (
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              transition: "transform 120ms ease",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          >
            <Icons.Chevron size={11} />
          </span>
        )}
      </button>
      {hasArgs && open && (
        <pre
          style={{
            margin: "8px 0 0",
            fontSize: "var(--fs-meta)",
            lineHeight: 1.5,
            color: "var(--text-muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {JSON.stringify(entry.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Log Row ─────────────────────────────────────────────────────────────────

function TaskLogRow({
  entry,
  onApproval,
}: {
  entry: TaskLogEntry;
  onApproval: (approvalId: string, action: "allow" | "deny") => void;
}) {
  const [decided, setDecided] = useState<"allow" | "deny" | null>(null);

  switch (entry.kind) {
    case "text":
      return (
        <div style={{ fontSize: "var(--fs-base)", lineHeight: 1.65 }}>
          <Markdown>{entry.content}</Markdown>
        </div>
      );

    case "tool_use":
      return <ToolUseRow entry={entry} />;

    case "canvas":
      return <EmployeeCanvasPanel canvas={entry.canvas} />;

    case "tool_result":
      return (
        <div className="row" style={{ gap: "var(--sp-6)", alignItems: "center" }}>
          <Icons.Check size={11} style={{ color: "var(--success)" }} />
          <span className="mono subtle" style={{ fontSize: "var(--fs-meta)" }}>
            {bareName(entry.tool)} completed
          </span>
        </div>
      );

    case "approval_request": {
      const resolved = decided !== null;
      return (
        <div
          style={{
            padding: "14px 16px",
            background: resolved
              ? "var(--bg-elevated)"
              : "rgba(180,140,60,0.06)",
            borderRadius: 8,
            border: `1px solid ${resolved ? "var(--hairline)" : "var(--warn)"}`,
          }}
        >
          <div
            className="row"
            style={{ gap: "var(--sp-8)", alignItems: "center", marginBottom: "var(--sp-8)" }}
          >
            <Icons.Bell
              size={13}
              style={{
                color: resolved ? "var(--text-muted)" : "var(--warn)",
              }}
            />
            <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
              Approval needed
            </span>
            <span
              className="mono"
              style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}
            >
              {bareName(entry.tool)}
            </span>
          </div>
          <div
            style={{
              fontSize: "var(--fs-sm)",
              color: "var(--text-muted)",
              marginBottom: "var(--sp-10)",
              lineHeight: 1.5,
            }}
          >
            {entry.reason}
          </div>
          {entry.input && Object.keys(entry.input).length > 0 && (
            <pre
              style={{
                margin: "0 0 12px",
                fontSize: "var(--fs-meta)",
                lineHeight: 1.5,
                color: "var(--text-muted)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: 100,
                overflow: "auto",
                padding: "8px 10px",
                background: "var(--bg-elevated)",
                borderRadius: 6,
              }}
            >
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          )}
          {!resolved ? (
            <div className="row" style={{ gap: "var(--sp-8)" }}>
              <button
                className="btn primary sm"
                onClick={() => {
                  setDecided("allow");
                  onApproval(entry.approvalId, "allow");
                }}
              >
                <Icons.Check size={11} /> Approve
              </button>
              <button
                className="btn sm"
                style={{ color: "var(--danger)" }}
                onClick={() => {
                  setDecided("deny");
                  onApproval(entry.approvalId, "deny");
                }}
              >
                <Icons.X size={11} /> Deny
              </button>
            </div>
          ) : (
            <div className="row" style={{ gap: "var(--sp-6)", alignItems: "center" }}>
              {decided === "allow" ? (
                <>
                  <Icons.Check
                    size={11}
                    style={{ color: "var(--success)" }}
                  />
                  <span
                    style={{
                      fontSize: "var(--fs-sm)",
                      color: "var(--success)",
                      fontWeight: 500,
                    }}
                  >
                    Approved
                  </span>
                </>
              ) : (
                <>
                  <Icons.X size={11} style={{ color: "var(--danger)" }} />
                  <span
                    style={{
                      fontSize: "var(--fs-sm)",
                      color: "var(--danger)",
                      fontWeight: 500,
                    }}
                  >
                    Denied
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      );
    }

    case "approval_resolved":
      return (
        <div className="row" style={{ gap: "var(--sp-6)", alignItems: "center" }}>
          {entry.decision === "allow" ? (
            <Icons.Check size={11} style={{ color: "var(--success)" }} />
          ) : (
            <Icons.X size={11} style={{ color: "var(--danger)" }} />
          )}
          <span className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
            Tool {entry.decision === "allow" ? "approved" : "denied"}
          </span>
        </div>
      );

    case "tool_blocked":
      return (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(220,60,60,0.06)",
            borderRadius: 8,
            border: "1px solid var(--danger)",
          }}
        >
          <div className="row" style={{ gap: "var(--sp-8)", alignItems: "center" }}>
            <Icons.Lock size={12} style={{ color: "var(--danger)" }} />
            <span
              className="mono"
              style={{
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                color: "var(--danger)",
              }}
            >
              {bareName(entry.tool)} blocked
            </span>
          </div>
          <div
            style={{
              fontSize: "var(--fs-sm)",
              color: "var(--text-muted)",
              marginTop: "var(--sp-4)",
            }}
          >
            {entry.reason}
          </div>
        </div>
      );

    case "done": {
      const hitBudget = entry.stoppedReason === "max_budget";
      const hitTurns = entry.stoppedReason === "max_turns";
      return (
        <div
          style={{
            padding: "12px 16px",
            background: hitBudget
              ? "rgba(220,60,60,0.06)"
              : "var(--bg-elevated)",
            borderRadius: 8,
            border: `1px solid ${hitBudget ? "var(--danger)" : "var(--hairline)"}`,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-12)",
            flexWrap: "wrap",
          }}
        >
          {hitBudget ? (
            <Icons.Lock size={14} style={{ color: "var(--danger)" }} />
          ) : (
            <Icons.CheckCircle size={14} style={{ color: "var(--success)" }} />
          )}
          <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
            {hitBudget
              ? "Stopped at budget cap"
              : hitTurns
              ? "Stopped at turn limit"
              : "Task complete"}
          </span>
          <span className="badge success" style={{ fontSize: "var(--fs-xs)" }}>
            Confidence {entry.confidence.toFixed(2)}
          </span>
          <span className="subtle mono" style={{ fontSize: "var(--fs-xs)" }}>
            {entry.turns} turn{entry.turns !== 1 ? "s" : ""}
          </span>
          {typeof entry.costUsd === "number" && (
            <span
              className="mono"
              style={{
                fontSize: "var(--fs-xs)",
                fontWeight: 600,
                color: hitBudget ? "var(--danger)" : "var(--text-muted)",
              }}
            >
              {formatCost(entry.costUsd)}
            </span>
          )}
        </div>
      );
    }

    case "error":
      return (
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(220,60,60,0.06)",
            borderRadius: 8,
            border: "1px solid var(--danger)",
            fontSize: "var(--fs-ui)",
            color: "var(--danger)",
          }}
        >
          Error: {entry.message}
        </div>
      );
  }
}
