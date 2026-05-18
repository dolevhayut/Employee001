"use client";

import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database as DatabaseIcon,
  Page as FileTextIcon,
  Terminal,
  Search as SearchIcon,
  Globe,
  Wrench,
  Sparks as SparksIcon,
} from "iconoir-react";
import type { SVGProps } from "react";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { Markdown } from "@/components/ex/markdown";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import {
  EmployeeCanvasPanel,
  type EmployeeCanvas,
} from "@/components/ex/employee-canvas";
import { ClarificationCard } from "@/components/ex/clarification-card";
import { type EmployeeWithTwin } from "@/lib/employees";
import { useRoster } from "@/components/ex/roster-context";
import type { CouncilEvent, ClarificationQuestion } from "@/lib/council-runner";
import { humanizeToolAction } from "@/lib/tool-humanize";

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolTrace = {
  tool: string;
  input: unknown;
  ts: number;
};

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
  questions: ClarificationQuestion[];
  ts: number;
};

type TwinResponse = {
  employeeId: string;
  text: string;
  confidence?: number;
  streaming: boolean;
  traces: ToolTrace[];
  pendingApprovals: PendingApproval[];
  pendingClarifications: PendingClarification[];
  blocked: { tool: string; reason: string }[];
  artifacts: EmployeeCanvas[];
  delegatedFrom?: { id: string; name: string }; // set when this response was triggered by a @mention
};

type DelegationBadge = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
};

type BlockedDelegation = {
  id: string;
  fromId: string;
  fromName: string;
  toName: string;
  // Index into responses[] of the bubble this blocked attempt belongs to.
  afterResponseIdx: number;
};

type SharedFileChip = {
  id: string;
  filename: string;
  summary: string;
  sizeBytes: number;
  contentType: string;
  kind: "text" | "image";
  sharedById: string;
  sharedByName: string;
  ts: number;
  // Index into responses[] of the bubble this share belongs to.
  afterResponseIdx: number;
};

type MessageThread = {
  id: string;
  userText: string;
  responses: TwinResponse[];
  delegations: DelegationBadge[];
  blockedDelegations: BlockedDelegation[];
  fileShares: SharedFileChip[];
  pending: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Avatar({ emp, size = 32 }: { emp: EmployeeWithTwin; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: emp.avatarColor,
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.33,
        fontWeight: 700,
        color: "var(--text)",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {emp.initials}
    </div>
  );
}

const CHIPS = [
  "We're missing Q2 targets. What should we do?",
  "We're considering hiring a new VP Sales. Thoughts?",
  "A big enterprise deal needs a feature that's not on the roadmap. How do we handle it?",
  "Platform is slow — customers are complaining. What's the priority?",
];

// ─── Participants bar ─────────────────────────────────────────────────────────

function ParticipantsBar({
  active,
  onToggle,
}: {
  active: Set<string>;
  onToggle: (id: string) => void;
}) {
  const readyEmployees = useRoster().filter(
    (e) => e.twinStatus === "ready"
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-8)",
        padding: "10px 24px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--bg-elevated)",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-meta)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-subtle)",
          marginRight: "var(--sp-4)",
        }}
      >
        In the room
      </span>
      {readyEmployees.map((emp) => {
        const isActive = active.has(emp.id);
        return (
          <button
            key={emp.id}
            onClick={() => onToggle(emp.id)}
            title={`${isActive ? "Exclude" : "Include"} ${emp.firstName}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-7)",
              padding: "4px 10px 4px 6px",
              background: isActive ? "var(--surface)" : "transparent",
              border: `1px solid ${isActive ? "var(--accent-soft)" : "transparent"}`,
              borderRadius: 20,
              cursor: "pointer",
              opacity: isActive ? 1 : 0.4,
              transition: "opacity .15s, background .15s, border-color .15s",
              fontFamily: "inherit",
            }}
          >
            <div style={{ position: "relative" }}>
              <Avatar emp={emp} size={22} />
              {isActive && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--success)",
                    border: "1.5px solid var(--bg-elevated)",
                  }}
                />
              )}
            </div>
            <span
              style={{
                fontSize: "var(--fs-sm)",
                fontWeight: 500,
                color: isActive ? "var(--text)" : "var(--text-muted)",
              }}
            >
              {emp.firstName}
            </span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
              {emp.role}
            </span>
          </button>
        );
      })}

    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onChip }: { onChip: (text: string) => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-24)",
        padding: "var(--sp-40)",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div
          style={{
            fontSize: "var(--fs-body)",
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: "var(--sp-8)",
          }}
        >
          Raise a problem. The team will respond.
        </div>
        <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Each twin is powered by Claude SDK and responds in real time
          based on the employee&apos;s actual profile files.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-8)",
          width: "100%",
          maxWidth: 480,
        }}
      >
        {CHIPS.map((chip) => (
          <button
            key={chip}
            onClick={() => onChip(chip)}
            style={{
              padding: "10px 16px",
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 8,
              fontSize: "var(--fs-ui)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              transition: "background .12s, border-color .12s, color .12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-sunken)";
              e.currentTarget.style.borderColor = "var(--hairline-strong)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface)";
              e.currentTarget.style.borderColor = "var(--hairline)";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Message bubbles ──────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      style={{
        display: "flex",
        justifyContent: "flex-end",
        marginBottom: "var(--sp-24)",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          padding: "10px 14px",
          background: "var(--text)",
          color: "var(--bg)",
          borderRadius: "12px 12px 3px 12px",
          fontSize: "var(--fs-base)",
          lineHeight: 1.6,
          fontWeight: 450,
        }}
      >
        {text}
      </div>
    </motion.div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const color =
    value >= 0.85
      ? "var(--success)"
      : value >= 0.70
      ? "var(--warn)"
      : "var(--danger)";
  return (
    <span
      style={{
        fontSize: "var(--fs-xs)",
        fontWeight: 600,
        color,
        background: `${color}18`,
        padding: "1px 5px",
        borderRadius: 4,
        marginLeft: "var(--sp-6)",
      }}
    >
      {Math.round(value * 100)}%
    </span>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  approval: PendingApproval;
  onApprove: (updatedInput?: Record<string, unknown>) => void;
  onDeny: (message?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(
    JSON.stringify(approval.input, null, 2)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setSubmitting(true);
    setError(null);
    try {
      let updatedInput: Record<string, unknown> | undefined = undefined;
      if (editing) {
        try {
          updatedInput = JSON.parse(edited) as Record<string, unknown>;
        } catch {
          setError("Edit is not valid JSON");
          setSubmitting(false);
          return;
        }
      }
      onApprove(updatedInput);
    } finally {
      setSubmitting(false);
    }
  }

  async function deny() {
    setSubmitting(true);
    onDeny();
    setSubmitting(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{
        marginBottom: "var(--sp-8)",
        padding: "10px 12px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--warn)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-8)",
        boxShadow: "0 1px 3px rgba(180,140,60,0.12)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
        }}
      >
        <motion.div
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--warn)",
            flexShrink: 0,
          }}
        />
        <div
          style={{
            fontSize: "var(--fs-meta)",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--warn)",
          }}
        >
          Approval needed
        </div>
        <div
          style={{
            fontSize: "var(--fs-meta)",
            fontWeight: 500,
            color: "var(--text)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            marginLeft: "auto",
          }}
        >
          {approval.label}
        </div>
      </div>

      <div style={{ fontSize: "var(--fs-sm)", color: "var(--text)", lineHeight: 1.5 }}>
        {approval.reason}
      </div>

      <div>
        {!editing ? (
          <pre
            style={{
              margin: 0,
              padding: "8px 10px",
              background: "var(--bg-sunken)",
              border: "1px solid var(--hairline)",
              borderRadius: 6,
              fontSize: "var(--fs-meta)",
              lineHeight: 1.5,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              maxHeight: 160,
              overflow: "auto",
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(approval.input, null, 2)}
          </pre>
        ) : (
          <textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 100,
              padding: "8px 10px",
              background: "var(--bg-sunken)",
              border: "1px solid var(--hairline-strong)",
              borderRadius: 6,
              fontSize: "var(--fs-meta)",
              lineHeight: 1.5,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              color: "var(--text)",
              resize: "vertical",
              outline: "none",
            }}
          />
        )}
      </div>

      {error && (
        <div style={{ fontSize: "var(--fs-meta)", color: "var(--danger)" }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: "var(--sp-6)", alignItems: "center" }}>
        <button
          onClick={approve}
          disabled={submitting}
          style={{
            padding: "6px 14px",
            background: "var(--success)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ✓ Approve
        </button>
        <button
          onClick={() => setEditing((v) => !v)}
          disabled={submitting}
          style={{
            padding: "6px 12px",
            background: "transparent",
            color: "var(--text-muted)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            fontSize: "var(--fs-sm)",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {editing ? "Cancel edit" : "Edit args"}
        </button>
        <button
          onClick={deny}
          disabled={submitting}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            background: "transparent",
            color: "var(--danger)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            fontSize: "var(--fs-sm)",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Skip
        </button>
      </div>
    </motion.div>
  );
}

function BlockedNotice({ tool, reason }: { tool: string; reason: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        marginBottom: "var(--sp-8)",
        padding: "8px 12px",
        background: "rgba(180,80,60,0.06)",
        border: "1px solid var(--danger)",
        borderRadius: 8,
        fontSize: "var(--fs-meta)",
        color: "var(--text)",
      }}
    >
      <div
        style={{
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--danger)",
          marginBottom: "var(--sp-2)",
        }}
      >
        Blocked · {tool}
      </div>
      {reason}
    </motion.div>
  );
}

// ─── Tool feed (stacked, faded-by-age, GitHub-Copilot-ish) ───────────────────

// Some Composio catalog slugs differ from the toolkit token parsed out of
// MCP tool names like `MICROSOFT_TEAMS_SEND_MESSAGE`. Normalize here so the
// ToolkitIcon catalog lookup hits.
const COMPOSIO_SLUG_ALIASES: Record<string, string> = {
  teams: "microsoft_teams",
  microsoft: "microsoft_teams",
  meet: "googlemeet",
  sharepoint: "share_point",
  onedrive: "one_drive",
  calendar: "googlecalendar",
};

function normalizeComposioSlug(toolkit: string): string {
  const k = toolkit.toLowerCase();
  return COMPOSIO_SLUG_ALIASES[k] ?? k;
}

type BuiltinGlyph = {
  Icon: (p: SVGProps<SVGSVGElement>) => React.ReactElement;
  tint: string;
};

// Lucide fallback for built-in (non-Composio) tools — Bash, Read, WebFetch, etc.
function builtinGlyph(toolName: string): BuiltinGlyph | null {
  const t = toolName.toLowerCase();
  if (t.startsWith("subagent:")) return { Icon: (p) => <SparksIcon {...p} />, tint: "#a64fb0" };
  if (t === "bash" || t === "shell") return { Icon: (p) => <Terminal {...p} />, tint: "#444" };
  if (t === "read" || t === "write" || t === "edit" || t === "notebookedit") {
    return { Icon: (p) => <FileTextIcon {...p} />, tint: "#5d4ec0" };
  }
  if (t === "grep" || t === "glob" || t.startsWith("toolsearch")) {
    return { Icon: (p) => <SearchIcon {...p} />, tint: "#3a8a5a" };
  }
  if (t.startsWith("webfetch") || t.startsWith("websearch")) {
    return { Icon: (p) => <Globe {...p} />, tint: "#1f7a8c" };
  }
  if (t.includes("sql") || t.includes("db") || t.includes("neon")) {
    return { Icon: (p) => <DatabaseIcon {...p} />, tint: "#3b6ea5" };
  }
  return { Icon: (p) => <Wrench {...p} />, tint: "#7a7a7a" };
}

// Built-in tools deserve nicer line text than the generic humanizer can give.
function builtinDescriptor(
  toolName: string,
  input: unknown,
): { verb: string; noun: string; detail?: string } | null {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const t = toolName.toLowerCase();
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);

  if (t === "read" && str("file_path")) {
    return { verb: "Read", noun: str("file_path")!.split("/").pop() ?? "file" };
  }
  if (t === "write" && str("file_path")) {
    return { verb: "Wrote", noun: str("file_path")!.split("/").pop() ?? "file" };
  }
  if (t === "edit" && str("file_path")) {
    return { verb: "Edited", noun: str("file_path")!.split("/").pop() ?? "file" };
  }
  if (t === "bash") {
    const cmd = str("command") ?? "";
    const head = cmd.split("\n")[0].slice(0, 80);
    return { verb: "Ran", noun: "shell", detail: head ? ` ${head}` : undefined };
  }
  if (t === "grep" && str("pattern")) {
    return { verb: "Searched", noun: "files", detail: `for "${str("pattern")}"` };
  }
  if (t === "glob" && str("pattern")) {
    return { verb: "Listed", noun: "files", detail: `matching ${str("pattern")}` };
  }
  if (t.startsWith("toolsearch") && str("query")) {
    return { verb: "Looked up", noun: "tools", detail: `"${str("query")}"` };
  }
  if (t.startsWith("webfetch") && str("url")) {
    let host = str("url")!;
    try { host = new URL(host).hostname; } catch { /* keep raw */ }
    return { verb: "Fetched", noun: host };
  }
  if (t.startsWith("websearch") && str("query")) {
    return { verb: "Searched", noun: "web", detail: `"${str("query")}"` };
  }
  if (t.startsWith("subagent:")) {
    const subType = toolName.split(":")[1] ?? "";
    const label =
      subType === "web-researcher"
        ? "🌐 web research"
        : subType === "brain-explorer"
          ? "🧠 brain explorer"
          : subType;
    const desc = str("description");
    return {
      verb: "Spawned",
      noun: label,
      detail: desc ? `— ${desc}` : undefined,
    };
  }
  return null;
}

function describeTrace(trace: ToolTrace) {
  const builtin = builtinDescriptor(trace.tool, trace.input);
  if (builtin) {
    return { ...builtin, toolkit: "" };
  }
  return humanizeToolAction(trace.tool, trace.input);
}

const FADE_OPACITY = [1, 0.72, 0.48];

function ToolFeedRow({
  trace,
  ageIndex,
}: {
  trace: ToolTrace;
  ageIndex: number;
}) {
  const desc = describeTrace(trace);
  const composioSlug = desc.toolkit ? normalizeComposioSlug(desc.toolkit) : "";
  const glyph = composioSlug ? null : builtinGlyph(trace.tool);
  const opacity = ageIndex < FADE_OPACITY.length
    ? FADE_OPACITY[ageIndex]
    : 0.32;
  const isHead = ageIndex === 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-8)",
        padding: "4px 8px 4px 6px",
        borderLeft: `2px solid ${isHead ? "var(--accent-deep)" : "var(--hairline)"}`,
        borderRadius: "0 6px 6px 0",
        background: isHead ? "var(--accent-soft)" : "transparent",
        minHeight: 22,
        transition: "background .2s, border-color .2s",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          display: "grid",
          placeItems: "center",
          color: glyph ? glyph.tint : undefined,
          flexShrink: 0,
          opacity: 0.9,
        }}
      >
        {composioSlug ? (
          <ToolkitIcon slug={composioSlug} size={14} />
        ) : glyph ? (
          <glyph.Icon width={12} height={12} strokeWidth={1.75} />
        ) : null}
      </span>
      <span
        style={{
          fontSize: "var(--fs-sm)",
          lineHeight: 1.35,
          color: "var(--text)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={`${desc.verb} ${desc.noun}${desc.detail ? " " + desc.detail : ""}`}
      >
        <span style={{ fontWeight: 600, color: "var(--accent-deep)" }}>
          {desc.verb}
        </span>{" "}
        <span>{desc.noun}</span>
        {desc.detail && (
          <span style={{ color: "var(--text-muted)" }}>{" "}{desc.detail}</span>
        )}
      </span>
    </motion.div>
  );
}

function ToolFeed({ traces }: { traces: ToolTrace[] }) {
  const [expanded, setExpanded] = useState(false);
  if (traces.length === 0) return null;

  // Newest-first.
  const ordered = [...traces].reverse();
  const HEAD = 3;
  const visible = expanded ? ordered : ordered.slice(0, HEAD);
  const hidden = ordered.length - visible.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        marginBottom: "var(--sp-8)",
        paddingLeft: "var(--sp-2)",
      }}
    >
      <AnimatePresence initial={false}>
        {visible.map((t, i) => (
          <ToolFeedRow
            key={`${t.ts}-${t.tool}-${i}`}
            trace={t}
            ageIndex={i}
          />
        ))}
      </AnimatePresence>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            alignSelf: "flex-start",
            marginTop: "var(--sp-2)",
            padding: "2px 8px",
            background: "transparent",
            border: "1px dashed var(--hairline)",
            borderRadius: 10,
            fontSize: "var(--fs-xs)",
            fontWeight: 500,
            color: "var(--text-subtle)",
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "0.02em",
          }}
        >
          + {hidden} earlier
        </button>
      )}
      {expanded && traces.length > HEAD && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            alignSelf: "flex-start",
            marginTop: "var(--sp-2)",
            padding: "2px 8px",
            background: "transparent",
            border: "1px dashed var(--hairline)",
            borderRadius: 10,
            fontSize: "var(--fs-xs)",
            fontWeight: 500,
            color: "var(--text-subtle)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          collapse
        </button>
      )}
    </div>
  );
}

function BlockedDelegationNote({ fromName, toName }: { fromName: string; toName: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "3px 9px",
        margin: "2px 0 8px 40px",
        background: "transparent",
        border: "1px dashed var(--hairline-strong)",
        borderRadius: 16,
        alignSelf: "flex-start",
        fontSize: "var(--fs-xs)",
        fontWeight: 500,
        color: "var(--text-subtle)",
        fontStyle: "italic",
      }}
      title={`${fromName} tagged ${toName}, but ${toName} was already called in this meeting (each twin can be delegated to once).`}
    >
      <span style={{ opacity: 0.6 }}>↳</span>
      <span>
        <strong style={{ fontWeight: 600 }}>{fromName}</strong> tagged{" "}
        <strong style={{ fontWeight: 600 }}>{toName}</strong> · already in conversation
      </span>
    </motion.div>
  );
}

/**
 * Pick a glyph + label color for a shared file based on its filename
 * extension (or MIME). Office / Google formats get distinctive colors so
 * the CEO can scan the chat at a glance.
 */
function fileTypeBadge(filename: string, contentType: string): { glyph: string; label: string; bg: string; fg: string } {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const ct = contentType.toLowerCase();

  if (ct.startsWith("image/")) return { glyph: "🖼", label: "IMG", bg: "#fce7f3", fg: "#9d174d" };

  // Spreadsheets — Excel / Google Sheets / CSV
  if (ext === "xlsx" || ext === "xls" || ct.includes("spreadsheet")) return { glyph: "X", label: "XLS", bg: "#dcfce7", fg: "#166534" };
  if (ext === "csv" || ct === "text/csv") return { glyph: "≡", label: "CSV", bg: "#dcfce7", fg: "#166534" };
  if (ext === "tsv") return { glyph: "≡", label: "TSV", bg: "#dcfce7", fg: "#166534" };

  // Word / Google Doc
  if (ext === "docx" || ext === "doc" || ct.includes("wordprocessing")) return { glyph: "W", label: "DOC", bg: "#dbeafe", fg: "#1e40af" };

  // PowerPoint / Slides
  if (ext === "pptx" || ext === "ppt" || ct.includes("presentation")) return { glyph: "P", label: "PPT", bg: "#fed7aa", fg: "#9a3412" };

  // PDF
  if (ext === "pdf" || ct === "application/pdf") return { glyph: "P", label: "PDF", bg: "#fee2e2", fg: "#991b1b" };

  // JSON / data
  if (ext === "json" || ct === "application/json") return { glyph: "{ }", label: "JSON", bg: "#fef3c7", fg: "#92400e" };
  if (ext === "yaml" || ext === "yml") return { glyph: "{ }", label: "YML", bg: "#fef3c7", fg: "#92400e" };
  if (ext === "xml" || ct === "application/xml") return { glyph: "<>", label: "XML", bg: "#fef3c7", fg: "#92400e" };

  // Markdown / text
  if (ext === "md" || ct === "text/markdown") return { glyph: "M↓", label: "MD", bg: "#e0e7ff", fg: "#3730a3" };
  if (ext === "html" || ct === "text/html") return { glyph: "<>", label: "HTML", bg: "#fef3c7", fg: "#92400e" };

  // Default — generic file
  return { glyph: "📄", label: "FILE", bg: "var(--surface)", fg: "var(--text-subtle)" };
}

function FileTypeIcon({ filename, contentType, size = 28 }: { filename: string; contentType: string; size?: number }) {
  const badge = fileTypeBadge(filename, contentType);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: badge.bg,
        color: badge.fg,
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.42,
        fontWeight: 700,
        flexShrink: 0,
        fontFamily: "ui-rounded, system-ui",
        letterSpacing: badge.label.length > 3 ? -0.5 : 0,
      }}
      aria-label={badge.label}
      title={badge.label}
    >
      {badge.glyph}
    </div>
  );
}

function FileShareChip({
  chip,
  meetingId,
  onOpen,
}: {
  chip: SharedFileChip;
  meetingId: string | null;
  onOpen: () => void;
}) {
  const sizeLabel =
    chip.sizeBytes >= 1024 * 1024
      ? `${(chip.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(chip.sizeBytes / 1024))} KB`;

  const isImage = chip.kind === "image";
  const imageUrl =
    isImage && meetingId
      ? `/api/council/file?meetingId=${encodeURIComponent(meetingId)}&filename=${encodeURIComponent(chip.filename)}`
      : null;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-10)",
        padding: isImage ? "6px 12px 6px 6px" : "6px 12px 6px 8px",
        margin: "2px 0 8px 40px",
        background: "var(--accent-soft)",
        border: "1px solid var(--hairline-strong)",
        borderRadius: 14,
        alignSelf: "flex-start",
        fontSize: "var(--fs-meta)",
        fontWeight: 500,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        maxWidth: 460,
      }}
      title={`Shared by ${chip.sharedByName} — click to view`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={chip.summary}
          style={{
            width: 56,
            height: 56,
            objectFit: "cover",
            borderRadius: 8,
            background: "var(--surface)",
            flexShrink: 0,
          }}
        />
      ) : (
        <FileTypeIcon filename={chip.filename} contentType={chip.contentType} size={32} />
      )}
      <span style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 0 }}>
        <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {chip.sharedByName} shared <code style={{ background: "var(--surface)", padding: "1px 5px", borderRadius: 4, fontSize: "var(--fs-xs)" }}>{chip.filename}</code>
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {chip.summary} · {sizeLabel}
        </span>
      </span>
    </motion.button>
  );
}

function FileDrawer({
  meetingId,
  chip,
  onClose,
}: {
  meetingId: string | null;
  chip: SharedFileChip | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImage = chip?.kind === "image";

  useEffect(() => {
    if (!chip || !meetingId) return;
    // Images render via <img src> directly — no JSON fetch needed.
    if (chip.kind === "image") {
      setLoading(false);
      setContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    const url = `/api/council/file?meetingId=${encodeURIComponent(meetingId)}&filename=${encodeURIComponent(chip.filename)}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { content: string };
        if (!cancelled) setContent(data.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chip, meetingId]);

  if (!chip || !meetingId) return null;

  const downloadHref = `/api/council/file?meetingId=${encodeURIComponent(meetingId)}&filename=${encodeURIComponent(chip.filename)}&download=1`;
  const imageHref = `/api/council/file?meetingId=${encodeURIComponent(meetingId)}&filename=${encodeURIComponent(chip.filename)}`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 100,
        }}
      />
      <motion.aside
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: "90vw",
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--hairline-strong)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.18)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--hairline)",
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--sp-12)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 700, fontFamily: "monospace", wordBreak: "break-all" }}>
              {chip.filename}
            </div>
            <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", marginTop: "var(--sp-4)" }}>
              {chip.summary}
            </div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", marginTop: "var(--sp-6)" }}>
              shared by <strong>{chip.sharedByName}</strong> · {chip.contentType}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--hairline)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: "var(--fs-sm)",
              cursor: "pointer",
              color: "var(--text)",
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "8px 16px", display: "flex", gap: "var(--sp-8)", borderBottom: "1px solid var(--hairline)" }}>
          <a
            href={downloadHref}
            download={chip.filename}
            style={{
              fontSize: "var(--fs-meta)",
              fontWeight: 600,
              padding: "5px 12px",
              background: "var(--text)",
              color: "var(--bg)",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            ⬇ Download
          </a>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "var(--sp-16)" }}>
          {isImage ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "100%",
                background: "repeating-conic-gradient(var(--bg-sunken) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px",
                borderRadius: 6,
              }}
            >
              <img
                src={imageHref}
                alt={chip.summary}
                style={{
                  maxWidth: "100%",
                  maxHeight: "calc(100vh - 200px)",
                  objectFit: "contain",
                  display: "block",
                }}
                onError={() => setError("could not load image")}
              />
            </div>
          ) : (
            <>
              {loading && (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>Loading…</div>
              )}
              {error && (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--danger, #c33)" }}>
                  Could not load file: {error}
                </div>
              )}
              {content !== null && !loading && !error && (
                <pre
                  style={{
                    fontSize: "var(--fs-meta)",
                    lineHeight: 1.5,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    color: "var(--text)",
                  }}
                >
                  {content}
                </pre>
              )}
            </>
          )}
        </div>
      </motion.aside>
    </>
  );
}

function DelegationArrow({ fromName, toName }: { fromName: string; toName: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-6)",
        padding: "5px 10px",
        margin: "2px 0 10px 40px",
        background: "var(--accent-soft)",
        border: "1px solid var(--hairline)",
        borderRadius: 20,
        alignSelf: "flex-start",
        fontSize: "var(--fs-meta)",
        fontWeight: 500,
        color: "var(--accent-deep)",
      }}
    >
      <Icons.Arrow size={10} />
      <span>
        <strong>{fromName}</strong> called in <strong>{toName}</strong>
      </span>
    </motion.div>
  );
}

function TwinBubble({
  emp,
  text,
  streaming,
  confidence,
  traces,
  pendingApprovals,
  pendingClarifications,
  blocked,
  artifacts,
  onApprove,
  onDeny,
  onClarify,
  delay,
  delegatedFrom,
}: {
  emp: EmployeeWithTwin;
  text: string;
  streaming: boolean;
  confidence?: number;
  traces: ToolTrace[];
  pendingApprovals: PendingApproval[];
  pendingClarifications: PendingClarification[];
  blocked: { tool: string; reason: string }[];
  artifacts: EmployeeCanvas[];
  onApprove: (approvalId: string, updatedInput?: Record<string, unknown>) => void;
  onDeny: (approvalId: string, message?: string) => void;
  onClarify: (approvalId: string, answers: Record<string, string>) => Promise<void>;
  delay: number;
  delegatedFrom?: { id: string; name: string };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut", delay }}
      style={{
        display: "flex",
        gap: "var(--sp-10)",
        marginBottom: "var(--sp-14)",
        maxWidth: 560,
      }}
    >
      <div style={{ flexShrink: 0, paddingTop: "var(--sp-18)" }}>
        <Avatar emp={emp} size={30} />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: "var(--fs-meta)",
            fontWeight: 600,
            color: "var(--text-muted)",
            marginBottom: "var(--sp-5)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-4)",
          }}
        >
          {emp.name}
          <span style={{ fontWeight: 400, color: "var(--text-subtle)", marginLeft: "var(--sp-4)" }}>
            {emp.role}
          </span>
          {delegatedFrom && (
            <span
              style={{
                fontSize: "var(--fs-xs)",
                fontWeight: 500,
                color: "var(--accent-deep)",
                background: "var(--accent-soft)",
                padding: "1px 6px",
                borderRadius: 10,
                marginLeft: "var(--sp-4)",
              }}
            >
              ↳ called in by {delegatedFrom.name}
            </span>
          )}
          {!streaming && confidence !== undefined && (
            <ConfidencePill value={confidence} />
          )}
        </div>
        <ToolFeed traces={traces} />
        {blocked.map((b, i) => (
          <BlockedNotice key={`b-${i}`} tool={b.tool} reason={b.reason} />
        ))}
        {pendingApprovals.map((a) => (
          <ApprovalCard
            key={a.approvalId}
            approval={a}
            onApprove={(updatedInput) => onApprove(a.approvalId, updatedInput)}
            onDeny={(msg) => onDeny(a.approvalId, msg)}
          />
        ))}
        {pendingClarifications.map((c) => (
          <ClarificationCard
            key={c.approvalId}
            approvalId={c.approvalId}
            questions={c.questions}
            onSubmit={(answers) => onClarify(c.approvalId, answers)}
          />
        ))}
        {artifacts.map((artifact) => (
          <EmployeeCanvasPanel key={artifact.artifactId} canvas={artifact} />
        ))}
        {(text.length > 0 || !streaming) && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--surface)",
              border: `1px solid ${streaming ? "var(--accent-soft)" : "var(--hairline)"}`,
              borderRadius: "3px 12px 12px 12px",
              fontSize: "var(--fs-base)",
              color: "var(--text)",
              boxShadow: "var(--shadow-sm)",
              transition: "border-color .3s",
            }}
          >
            <Markdown>{text}</Markdown>
            {streaming && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: "1em",
                  background: "var(--accent)",
                  marginLeft: "var(--sp-2)",
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                }}
              />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function TypingIndicator({ emp }: { emp: EmployeeWithTwin }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      style={{
        display: "flex",
        gap: "var(--sp-10)",
        alignItems: "center",
        marginBottom: "var(--sp-10)",
      }}
    >
      <Avatar emp={emp} size={24} />
      <div
        style={{
          display: "flex",
          gap: "var(--sp-4)",
          padding: "8px 12px",
          background: "var(--surface)",
          border: "1px solid var(--hairline)",
          borderRadius: 20,
        }}
      >
        {[0, 0.15, 0.3].map((d, i) => (
          <motion.div
            key={i}
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: d, ease: "easeInOut" }}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--text-subtle)",
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)" }}>
        {emp.firstName} is thinking…
      </span>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CouncilPage() {
  const roster = useRoster();
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());

  // Sync defaults once roster hydrates (initial render had an empty roster, so
  // we can't seed activeIds via useState initializer).
  useEffect(() => {
    setActiveIds((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set(
        roster.filter((e) => e.twinStatus === "ready").map((e) => e.id)
      );
      return next.size > 0 ? next : prev;
    });
  }, [roster]);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  // Stable across CEO messages — server uses it to load the meeting transcript
  // so every twin sees prior CEO asks and prior twin turns. Resets on page
  // reload (in-memory ref). Server-side meeting state lives in meeting-store.
  const meetingIdRef = useRef<string | null>(null);
  const [input, setInput] = useState("");
  const [typingFor, setTypingFor] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [openFile, setOpenFile] = useState<SharedFileChip | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readyEmployees = useMemo(
    () => roster.filter((e) => e.twinStatus === "ready"),
    [roster]
  );

  /** Twins matching the current @-query */
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return readyEmployees.filter((e) =>
      e.firstName.toLowerCase().startsWith(q)
    );
  }, [mentionQuery, readyEmployees]);

  /** Parse @-mentions from raw text. Returns matched employee ids (or null = no @ mentions). */
  function parseMentions(text: string): string[] | null {
    const re = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;
    const found = new Set<string>();
    for (const match of text.matchAll(re)) {
      const name = match[1].toLowerCase();
      const emp = readyEmployees.find(
        (e) => e.firstName.toLowerCase() === name
      );
      if (emp) found.add(emp.id);
    }
    return found.size > 0 ? Array.from(found) : null;
  }

  function toggleParticipant(id: string) {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
  }

  async function sendMessage(text: string) {
    if (!text.trim()) return;
    const trimmed = text.trim();
    const threadId = `t_${Date.now()}`;

    // If @-mentions are present, only those twins respond.
    // Otherwise, all currently selected twins respond.
    const mentionedIds = parseMentions(trimmed);
    const respondingIds = mentionedIds
      ? mentionedIds
      : roster.filter(
          (e) => activeIds.has(e.id) && e.twinStatus === "ready"
        ).map((e) => e.id);

    if (respondingIds.length === 0) return;

    // Add user message + skeleton responses
    setThreads((prev) => [
      ...prev,
      {
        id: threadId,
        userText: trimmed,
        responses: respondingIds.map((id) => ({
          employeeId: id,
          text: "",
          streaming: false,
          confidence: undefined,
          traces: [],
          pendingApprovals: [], pendingClarifications: [],
          blocked: [],
          artifacts: [],
        })),
        delegations: [],
        blockedDelegations: [],
        fileShares: [],
        pending: true,
      },
    ]);
    setInput("");
    setTypingFor(respondingIds);
    scrollToBottom();

    try {
      const res = await fetch("/api/council/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          employeeIds: respondingIds,
          meetingId: meetingIdRef.current ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: CouncilEvent | { type: "meeting"; meetingId: string };
          try {
            event = JSON.parse(raw) as
              | CouncilEvent
              | { type: "meeting"; meetingId: string };
          } catch {
            continue;
          }

          // Server tells us which meeting this run belonged to. Persist
          // it so the next CEO ask carries the same id and the server
          // loads the same transcript.
          if (event.type === "meeting") {
            meetingIdRef.current = event.meetingId;
            continue;
          }

          handleEvent(event, threadId);
        }
      }
    } catch (err) {
      console.error("Council stream error:", err);
    } finally {
      setTypingFor([]);
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, pending: false } : t
        )
      );
    }

    scrollToBottom();
  }

  /** Find the last response for this employee that is currently streaming.
   *  Falls back to the last response with matching employeeId if none is streaming. */
  function lastStreamingIdx(responses: TwinResponse[], employeeId: string): number {
    for (let i = responses.length - 1; i >= 0; i--) {
      if (responses[i].employeeId === employeeId && responses[i].streaming) {
        return i;
      }
    }
    for (let i = responses.length - 1; i >= 0; i--) {
      if (responses[i].employeeId === employeeId) return i;
    }
    return -1;
  }

  function handleEvent(event: CouncilEvent, threadId: string) {
    switch (event.type) {
      case "employee_start":
        setTypingFor((prev) => prev.filter((id) => id !== event.employeeId));
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            // Find an UNUSED skeleton response for this twin (round 1 placeholder
            // that hasn't received any text yet). If none, add a fresh response.
            // This way every delegation creates a new bubble for the twin.
            const skeletonIdx = t.responses.findIndex(
              (r) =>
                r.employeeId === event.employeeId &&
                r.text === "" &&
                r.traces.length === 0 &&
                r.artifacts.length === 0 &&
                !r.streaming
            );
            const delegation = [...t.delegations].reverse().find(
              (d) => d.toId === event.employeeId
            );
            if (skeletonIdx >= 0) {
              return {
                ...t,
                responses: t.responses.map((r, i) =>
                  i === skeletonIdx
                    ? {
                        ...r,
                        streaming: true,
                        delegatedFrom: delegation
                          ? { id: delegation.fromId, name: delegation.fromName }
                          : undefined,
                      }
                    : r
                ),
              };
            }
            const newResponse: TwinResponse = {
              employeeId: event.employeeId,
              text: "",
              streaming: true,
              confidence: undefined,
              traces: [],
              pendingApprovals: [], pendingClarifications: [],
              blocked: [],
              artifacts: [],
              delegatedFrom: delegation
                ? { id: delegation.fromId, name: delegation.fromName }
                : undefined,
            };
            return { ...t, responses: [...t.responses, newResponse] };
          })
        );
        scrollToBottom();
        break;

      case "delegation":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            return {
              ...t,
              delegations: [
                ...t.delegations,
                {
                  fromId: event.fromId,
                  fromName: event.fromName,
                  toId: event.toId,
                  toName: event.toName,
                },
              ],
            };
          })
        );
        scrollToBottom();
        break;

      case "delegation_blocked":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            // Pin this blocked notice under the speaker's most recent response
            let lastIdx = -1;
            for (let i = t.responses.length - 1; i >= 0; i--) {
              if (t.responses[i].employeeId === event.fromId) {
                lastIdx = i;
                break;
              }
            }
            return {
              ...t,
              blockedDelegations: [
                ...t.blockedDelegations,
                {
                  id: `${event.fromId}-${event.toName}-${event.ts}`,
                  fromId: event.fromId,
                  fromName: event.fromName,
                  toName: event.toName,
                  afterResponseIdx: lastIdx,
                },
              ],
            };
          })
        );
        break;

      case "file_shared":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            // Pin under the sharing twin's most recent (currently streaming) bubble.
            let lastIdx = -1;
            for (let i = t.responses.length - 1; i >= 0; i--) {
              if (t.responses[i].employeeId === event.employeeId) {
                lastIdx = i;
                break;
              }
            }
            return {
              ...t,
              fileShares: [
                ...t.fileShares,
                {
                  id: event.file.id,
                  filename: event.file.filename,
                  summary: event.file.summary,
                  sizeBytes: event.file.sizeBytes,
                  contentType: event.file.contentType,
                  kind: event.file.kind,
                  sharedById: event.employeeId,
                  sharedByName: event.employeeName,
                  ts: event.ts,
                  afterResponseIdx: lastIdx,
                },
              ],
            };
          })
        );
        scrollToBottom();
        break;

      case "text_delta":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx ? { ...r, text: r.text + event.delta } : r
              ),
            };
          })
        );
        scrollToBottom();
        break;

      case "artifact":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? {
                      ...r,
                      streaming: true,
                      artifacts: [
                        ...r.artifacts,
                        {
                          artifactId: event.artifactId,
                          type: event.payload.type,
                          title: event.payload.title,
                          content: event.payload.content,
                        },
                      ],
                    }
                  : r
              ),
            };
          })
        );
        scrollToBottom();
        break;

      case "tool_use":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? {
                      ...r,
                      streaming: true,
                      traces: [
                        ...r.traces,
                        { tool: event.tool, input: event.input, ts: event.ts },
                      ],
                    }
                  : r
              ),
            };
          })
        );
        scrollToBottom();
        break;

      case "tool_result":
        // Tool finished — visual indicator only, traces already shown
        break;

      case "subagent_spawn":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? {
                      ...r,
                      streaming: true,
                      traces: [
                        ...r.traces,
                        {
                          tool: `subagent:${event.subagentType}`,
                          input: { description: event.description },
                          ts: event.ts,
                        },
                      ],
                    }
                  : r
              ),
            };
          })
        );
        scrollToBottom();
        break;

      case "tool_approval_request":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? {
                      ...r,
                      streaming: true,
                      pendingApprovals: [
                        ...r.pendingApprovals,
                        {
                          approvalId: event.approvalId,
                          tool: event.tool,
                          label: event.label,
                          input: event.input,
                          reason: event.reason,
                          ts: event.ts,
                        },
                      ],
                    }
                  : r
              ),
            };
          })
        );
        scrollToBottom();
        break;

      case "tool_approval_resolved":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            return {
              ...t,
              responses: t.responses.map((r) =>
                r.employeeId === event.employeeId
                  ? {
                      ...r,
                      pendingApprovals: r.pendingApprovals.filter(
                        (a) => a.approvalId !== event.approvalId
                      ),
                    }
                  : r
              ),
            };
          })
        );
        break;

      case "clarification_request":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? {
                      ...r,
                      streaming: true,
                      pendingClarifications: [
                        ...r.pendingClarifications,
                        {
                          approvalId: event.approvalId,
                          questions: event.questions,
                          ts: event.ts,
                        },
                      ],
                    }
                  : r
              ),
            };
          })
        );
        scrollToBottom();
        break;

      case "clarification_resolved":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            return {
              ...t,
              responses: t.responses.map((r) =>
                r.employeeId === event.employeeId
                  ? {
                      ...r,
                      pendingClarifications: r.pendingClarifications.filter(
                        (c) => c.approvalId !== event.approvalId
                      ),
                    }
                  : r
              ),
            };
          })
        );
        break;

      case "tool_blocked":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? {
                      ...r,
                      blocked: [
                        ...r.blocked,
                        { tool: event.tool, reason: event.reason },
                      ],
                    }
                  : r
              ),
            };
          })
        );
        break;

      case "employee_done":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? { ...r, streaming: false, confidence: event.confidence }
                  : r
              ),
            };
          })
        );
        break;

      case "employee_error":
        setTypingFor((prev) => prev.filter((id) => id !== event.employeeId));
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            return {
              ...t,
              responses: t.responses.map((r, i) =>
                i === idx
                  ? { ...r, text: `(שגיאה: ${event.message})`, streaming: false }
                  : r
              ),
            };
          })
        );
        break;

      case "council_done":
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? { ...t, pending: false } : t
          )
        );
        setTypingFor([]);
        break;
    }
  }

  /** Detect @-trigger and update mentionQuery as the user types. */
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setInput(value);

    const cursor = e.target.selectionStart ?? value.length;
    const upToCursor = value.slice(0, cursor);
    // Match @word at the end of the input (no space after the @-token yet)
    const m = upToCursor.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  /** Replace the active @-token with the chosen employee firstname. */
  function applyMention(emp: EmployeeWithTwin) {
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, cursor);
    const after = input.slice(cursor);
    const replaced = before.replace(/@([a-zA-Z0-9_-]*)$/, `@${emp.firstName} `);
    const next = replaced + after;
    setInput(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = replaced.length;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Mention dropdown navigation
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + mentionMatches.length) % mentionMatches.length
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(mentionMatches[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  /**
   * POST the user's approve/deny decision to the server. The agent runner
   * is paused on a Promise registered for `approvalId`; this resolves it.
   */
  /**
   * POST the CEO's structured AskUserQuestion answers back. The runner
   * encoded these as a JSON map keyed by question text; we resolve the
   * paused approval with `action: "deny"` and the JSON string as `message`
   * (canUseTool decodes it on the server side).
   */
  async function resolveClarification(
    approvalId: string,
    answers: Record<string, string>
  ) {
    try {
      await fetch("/api/council/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action: "deny",
          message: JSON.stringify(answers),
        }),
      });
    } catch (err) {
      console.error("clarification submit failed", err);
    }
  }

  function resolveApprovalCall(action: "allow" | "deny") {
    return async (
      approvalId: string,
      updatedInputOrMessage?: Record<string, unknown> | string
    ) => {
      const body: Record<string, unknown> = { approvalId, action };
      if (action === "allow" && updatedInputOrMessage && typeof updatedInputOrMessage === "object") {
        body.updatedInput = updatedInputOrMessage;
      }
      if (action === "deny" && typeof updatedInputOrMessage === "string") {
        body.message = updatedInputOrMessage;
      }
      try {
        await fetch("/api/council/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        console.error("approval failed", err);
      }
    };
  }

  const empById = Object.fromEntries(
    roster.map((e) => [e.id, e])
  );
  const readyCount = roster.filter((e) => e.twinStatus === "ready").length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <Topbar crumbs={["Team Meeting"]} />
      <ParticipantsBar active={activeIds} onToggle={toggleParticipant} />

      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 24px 8px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {threads.length === 0 ? (
          <EmptyState onChip={(t) => { sendMessage(t); inputRef.current?.focus(); }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {threads.map((thread) => (
              <div key={thread.id} style={{ marginBottom: "var(--sp-12)" }}>
                <UserBubble text={thread.userText} />

                {/* Twin responses — shown as they stream in */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {thread.responses
                    .map((resp, originalIdx) => ({ resp, originalIdx }))
                    .filter(
                      ({ resp }) =>
                        resp.text.length > 0 ||
                        resp.streaming ||
                        resp.traces.length > 0 ||
                        resp.pendingApprovals.length > 0 ||
                        resp.blocked.length > 0 ||
                        resp.artifacts.length > 0
                    )
                    .map(({ resp, originalIdx }, i) => {
                      const emp = empById[resp.employeeId];
                      if (!emp) return null;
                      const blockedHere = thread.blockedDelegations.filter(
                        (b) => b.afterResponseIdx === originalIdx
                      );
                      const filesHere = thread.fileShares.filter(
                        (f) => f.afterResponseIdx === originalIdx
                      );
                      // Use originalIdx so each response (incl. delegation re-runs) is unique
                      return (
                        <div key={`${resp.employeeId}-${originalIdx}`}>
                          {resp.delegatedFrom && (
                            <DelegationArrow
                              fromName={resp.delegatedFrom.name}
                              toName={emp.firstName}
                            />
                          )}
                          <TwinBubble
                            emp={emp}
                            text={resp.text}
                            streaming={resp.streaming}
                            confidence={resp.confidence}
                            traces={resp.traces}
                            pendingApprovals={resp.pendingApprovals}
                            pendingClarifications={resp.pendingClarifications}
                            blocked={resp.blocked}
                            artifacts={resp.artifacts}
                            onApprove={resolveApprovalCall("allow")}
                            onDeny={resolveApprovalCall("deny")}
                            onClarify={resolveClarification}
                            delay={i * 0.04}
                            delegatedFrom={resp.delegatedFrom}
                          />
                          {filesHere.map((f) => (
                            <FileShareChip
                              key={f.id}
                              chip={f}
                              meetingId={meetingIdRef.current}
                              onOpen={() => setOpenFile(f)}
                            />
                          ))}
                          {blockedHere.map((b) => (
                            <BlockedDelegationNote
                              key={b.id}
                              fromName={b.fromName}
                              toName={b.toName}
                            />
                          ))}
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}

            {/* Typing indicators for employees that haven't started yet */}
            <AnimatePresence>
              {typingFor.map((id) => {
                const emp = empById[id];
                if (!emp) return null;
                return <TypingIndicator key={id} emp={emp} />;
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Input row */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--hairline)",
          padding: "12px 24px 16px",
          background: "var(--bg-elevated)",
          position: "relative",
        }}
      >
        {/* @-mention dropdown */}
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 24,
              right: 24,
              marginBottom: "var(--sp-4)",
              background: "var(--surface)",
              border: "1px solid var(--hairline-strong)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
              overflow: "hidden",
              maxWidth: 320,
              zIndex: 20,
            }}
          >
            <div
              style={{
                fontSize: "var(--fs-xs)",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-subtle)",
                padding: "8px 12px 4px",
              }}
            >
              Address a specific twin
            </div>
            {mentionMatches.map((emp, i) => (
              <button
                key={emp.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(emp);
                }}
                onMouseEnter={() => setMentionIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-10)",
                  width: "100%",
                  padding: "8px 12px",
                  background:
                    i === mentionIndex ? "var(--bg-sunken)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "background .1s",
                }}
              >
                <Avatar emp={emp} size={24} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>
                    {emp.firstName}
                    <span
                      style={{
                        fontWeight: 400,
                        color: "var(--text-subtle)",
                        marginLeft: "var(--sp-6)",
                        fontSize: "var(--fs-meta)",
                      }}
                    >
                      @{emp.firstName.toLowerCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                    {emp.role}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "var(--sp-8)",
            background: "var(--surface)",
            border: "1px solid var(--hairline-strong)",
            borderRadius: 10,
            padding: "6px 6px 6px 14px",
            alignItems: "center",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Raise a problem… mention @twin-name to address a specific twin"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "var(--fs-base)",
              color: "var(--text)",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-5)",
              padding: "6px 12px",
              background: input.trim() ? "var(--text)" : "var(--bg-sunken)",
              color: input.trim() ? "var(--bg)" : "var(--text-subtle)",
              border: "none",
              borderRadius: 7,
              fontSize: "var(--fs-sm)",
              fontWeight: 600,
              cursor: input.trim() ? "pointer" : "default",
              fontFamily: "inherit",
              transition: "background .15s, color .15s",
              height: 32,
            }}
          >
            <Icons.Arrow size={13} />
            Ask
          </button>
        </div>
        <div
          style={{
            fontSize: "var(--fs-meta)",
            color: "var(--text-subtle)",
            marginTop: "var(--sp-7)",
            paddingLeft: "var(--sp-2)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-6)",
          }}
        >
          <span>{readyCount} twins connected ·</span>
          <span>
            Type{" "}
            <code
              style={{
                fontFamily: "inherit",
                background: "var(--bg-sunken)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              @
            </code>{" "}
            to address one specific twin
          </span>
        </div>
      </div>

      <AnimatePresence>
        {openFile && (
          <FileDrawer
            key={openFile.id}
            meetingId={meetingIdRef.current}
            chip={openFile}
            onClose={() => setOpenFile(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
