"use client";

import { ApprovalArgs } from "@/components/ex/approval-args";

import { Suspense, useState, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Markdown, linkMentions } from "@/components/ex/markdown";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import {
  EmployeeCanvasPanel,
  type EmployeeCanvas,
} from "@/components/ex/employee-canvas";
import { ClarificationCard } from "@/components/ex/clarification-card";
import { type EmployeeWithTwin, displayRole } from "@/lib/employees";
import { useRoster } from "@/components/ex/roster-context";
import type { CouncilEvent, ClarificationQuestion } from "@/lib/council-runner";
import { humanizeToolAction } from "@/lib/tool-humanize";
import { useT } from "@/components/ex/i18n-context";
import { isolate } from "@/lib/i18n/format";
import type { MessageKey, MessageVars } from "@/lib/i18n/messages";
import { MeetingHistoryDrawer, fetchMeetingDetail, type HistoryDetail } from "./meeting-history";
import { SendToRoomate, type RoomateAction, type RoomateSummary } from "./send-to-roomate";
import { MeetingMemoryCard } from "./meeting-memory-card";

type TFn = (key: MessageKey, vars?: MessageVars) => string;

/** Keep `?meeting=<id>` in the URL so a reload reopens the same meeting. The
 *  native History API syncs with useSearchParams in the App Router. */
function setMeetingParam(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id) params.set("meeting", id);
  else params.delete("meeting");
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// Event-time unique id for a chat thread. Lives at module scope because it is a
// side-effecting utility invoked from event handlers, not part of render.
function makeThreadId(): string {
  return `t_${Date.now()}`;
}

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
  /** The twin's reasoning while it works (shown before its answer arrives). */
  thinking?: string;
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
  /** Set when the CEO replied to one twin's message (Slack/WhatsApp style). */
  replyTo?: { employeeId: string; name: string; excerpt: string };
  /** "Relevant" mode: who the router asked, and why (null while routing). */
  routed?: { id: string; matched: string[] }[] | null;
};

type MeetingDecision = {
  decision: string;
  actions: RoomateAction[];
  open: string[];
};

/** Rebuild chat threads from a stored meeting, so it can be continued: one
 *  thread per CEO message, with the twin turns that followed it. */
function threadsFromMeeting(detail: HistoryDetail): MessageThread[] {
  const threads: MessageThread[] = [];
  const turnTs: number[][] = [];
  const startTs: number[] = [];
  detail.transcript.forEach((turn, i) => {
    if (turn.kind === "ceo" || threads.length === 0) {
      threads.push({
        id: `hist_${detail.id}_${i}`,
        userText: turn.kind === "ceo" ? turn.text : "",
        responses: [],
        delegations: [],
        blockedDelegations: [],
        fileShares: [],
        pending: false,
      });
      turnTs.push([]);
      startTs.push(turn.ts);
      if (turn.kind === "ceo") return;
    }
    if (turn.kind !== "twin") return;
    const thread = threads[threads.length - 1];
    thread.responses.push({
      employeeId: turn.employeeId,
      text: turn.text,
      streaming: false,
      traces: [],
      pendingApprovals: [],
      pendingClarifications: [],
      blocked: [],
      artifacts: [],
      ...(turn.delegatedFromId ? { delegatedFrom: { id: turn.delegatedFromId, name: turn.delegatedFromName ?? turn.delegatedFromId } } : {}),
    });
    turnTs[turnTs.length - 1].push(turn.ts);
    if (turn.delegatedFromId) {
      thread.delegations.push({ fromId: turn.delegatedFromId, fromName: turn.delegatedFromName ?? "", toId: turn.employeeId, toName: turn.employeeName });
    }
  });
  // A file is shared during its author's turn, which is stored when the turn
  // ends: attach it to that author's first turn at or after the share.
  for (const f of detail.sharedFiles) {
    let ti = 0;
    startTs.forEach((ts, i) => {
      if (ts <= f.sharedAt) ti = i;
    });
    const thread = threads[ti];
    if (!thread) continue;
    const after = thread.responses.findIndex((r, j) => r.employeeId === f.sharedById && turnTs[ti][j] >= f.sharedAt);
    const idx = after >= 0 ? after : thread.responses.findLastIndex((r) => r.employeeId === f.sharedById);
    thread.fileShares.push({
      id: f.id,
      filename: f.filename,
      summary: f.summary,
      sizeBytes: f.sizeBytes,
      contentType: f.contentType,
      kind: f.kind,
      sharedById: f.sharedById,
      sharedByName: f.sharedByName,
      ts: f.sharedAt,
      afterResponseIdx: idx,
    });
  }
  return threads;
}

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

const CHIP_KEYS = [
  "meeting.chip.targets",
  "meeting.chip.hire",
  "meeting.chip.deal",
  "meeting.chip.slow",
] as const;

const VERB_KEYS: Record<string, MessageKey> = {
  Listing: "meeting.verb.listing",
  Fetching: "meeting.verb.fetching",
  Searching: "meeting.verb.searching",
  Sending: "meeting.verb.sending",
  Posting: "meeting.verb.posting",
  Creating: "meeting.verb.creating",
  Updating: "meeting.verb.updating",
  Deleting: "meeting.verb.deleting",
  Uploading: "meeting.verb.uploading",
  Downloading: "meeting.verb.downloading",
  Starring: "meeting.verb.starring",
  Merging: "meeting.verb.merging",
  Approving: "meeting.verb.approving",
};

function displayVerb(verb: string, translate: TFn): string {
  const key = VERB_KEYS[verb];
  return key ? translate(key) : verb;
}

// ─── Participants bar ─────────────────────────────────────────────────────────

function ParticipantsBar({
  active,
  onToggle,
}: {
  active: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useT();
  const readyEmployees = useRoster().filter(
    (e) => e.twinStatus === "ready" && e.lifecycle !== "retired"
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
          marginInlineEnd: "var(--sp-4)",
        }}
      >
        {t("meeting.inRoom")}
      </span>
      {readyEmployees.map((emp) => {
        const isActive = active.has(emp.id);
        return (
          <button
            key={emp.id}
            onClick={() => onToggle(emp.id)}
            title={t(isActive ? "meeting.exclude" : "meeting.include", { name: isolate(emp.firstName) })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-7)",
              paddingTop: 4,
              paddingBottom: 4,
              paddingInlineStart: 6,
              paddingInlineEnd: 10,
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
                    insetInlineEnd: 0,
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
              <bdi>{emp.firstName}</bdi>
            </span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
              <bdi>{displayRole(emp)}</bdi>
            </span>
          </button>
        );
      })}

    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onChip }: { onChip: (text: string) => void }) {
  const { t } = useT();
  // A replay demo can only answer its one recorded question, so offer that
  // instead of chips that would replay an unrelated meeting.
  const [replayQuestion, setReplayQuestion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/demo", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ demo: boolean; live?: boolean; question?: string }>) : null))
      .then((status) => {
        if (!cancelled && status?.demo && !status.live && status.question) setReplayQuestion(status.question);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const chips = replayQuestion ? [replayQuestion] : CHIP_KEYS.map((key) => t(key));
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
          {t("meeting.emptyTitle")}
        </div>
        <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", lineHeight: 1.6 }}>
          {t("meeting.emptyBody")}
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
        {chips.map((text) => (
          <button
            key={text}
            dir="auto"
            onClick={() => onChip(text)}
            style={{
              padding: "10px 16px",
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 8,
              fontSize: "var(--fs-ui)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "start",
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
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Message bubbles ──────────────────────────────────────────────────────────

function UserBubble({ text, replyTo }: { text: string; replyTo?: { name: string; excerpt: string } }) {
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
        dir="auto"
        style={{
          maxWidth: 520,
          padding: "10px 14px",
          background: "var(--text)",
          color: "var(--bg)",
          borderStartStartRadius: 12,
          borderStartEndRadius: 12,
          borderEndEndRadius: 3,
          borderEndStartRadius: 12,
          fontSize: "var(--fs-base)",
          lineHeight: 1.6,
          fontWeight: 450,
        }}
      >
        {replyTo && (
          <div
            dir="auto"
            style={{ marginBottom: 6, padding: "5px 9px", borderRadius: 7, borderInlineStart: "3px solid var(--accent)", background: "color-mix(in oklab, var(--bg) 14%, transparent)", fontSize: "var(--fs-sm)", lineHeight: 1.4, opacity: 0.85 }}
          >
            <div style={{ fontWeight: 650 }}><bdi>{replyTo.name}</bdi></div>
            <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{replyTo.excerpt}</div>
          </div>
        )}
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
        marginInlineStart: "var(--sp-6)",
      }}
    >
      <bdi>{Math.round(value * 100)}%</bdi>
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
  const { t } = useT();
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
          setError(t("meeting.badJson"));
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
        boxShadow: "var(--shadow-sm)",
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
          {t("meeting.approvalNeeded")}
        </div>
        <div
          style={{
            fontSize: "var(--fs-meta)",
            fontWeight: 500,
            color: "var(--text)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            marginInlineStart: "auto",
          }}
        >
          <bdi>{approval.label}</bdi>
        </div>
      </div>

      <div dir="auto" style={{ fontSize: "var(--fs-sm)", color: "var(--text)", lineHeight: 1.5 }}>
        {approval.reason}
      </div>

      <div>
        {!editing ? (
          <ApprovalArgs input={(approval.input ?? {}) as Record<string, unknown>} />
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
            color: "var(--bg)",
            border: "none",
            borderRadius: 6,
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ✓ {t("inbox.approve")}
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
          {editing ? t("inbox.overlay.cancelEdit") : t("inbox.overlay.edit")}
        </button>
        <button
          onClick={deny}
          disabled={submitting}
          style={{
            marginInlineStart: "auto",
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
          {t("inbox.overlay.skip")}
        </button>
      </div>
    </motion.div>
  );
}

function BlockedNotice({ tool, reason }: { tool: string; reason: string }) {
  const { t } = useT();
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        marginBottom: "var(--sp-8)",
        padding: "8px 12px",
        background: "color-mix(in oklch, var(--danger) 12%, transparent)",
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
        {t("meeting.blocked")} · <bdi>{tool}</bdi>
      </div>
      <span dir="auto">{reason}</span>
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
  if (t.startsWith("subagent:")) return { Icon: (p) => <SparksIcon {...p} />, tint: "var(--accent)" };
  if (t === "bash" || t === "shell") return { Icon: (p) => <Terminal {...p} />, tint: "var(--text-muted)" };
  if (t === "read" || t === "write" || t === "edit" || t === "notebookedit") {
    return { Icon: (p) => <FileTextIcon {...p} />, tint: "var(--twin)" };
  }
  if (t === "grep" || t === "glob" || t.startsWith("toolsearch")) {
    return { Icon: (p) => <SearchIcon {...p} />, tint: "var(--success)" };
  }
  if (t.startsWith("webfetch") || t.startsWith("websearch")) {
    return { Icon: (p) => <Globe {...p} />, tint: "var(--accent-deep)" };
  }
  if (t.includes("sql") || t.includes("db") || t.includes("neon")) {
    return { Icon: (p) => <DatabaseIcon {...p} />, tint: "var(--twin)" };
  }
  return { Icon: (p) => <Wrench {...p} />, tint: "var(--text-subtle)" };
}

// Built-in tools deserve nicer line text than the generic humanizer can give.
function builtinDescriptor(
  toolName: string,
  input: unknown,
  translate: TFn,
): { verb: string; noun: string; detail?: string } | null {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const t = toolName.toLowerCase();
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);

  if (t === "read" && str("file_path")) {
    return { verb: translate("meeting.trace.read"), noun: str("file_path")!.split("/").pop() ?? translate("meeting.trace.file") };
  }
  if (t === "write" && str("file_path")) {
    return { verb: translate("meeting.trace.wrote"), noun: str("file_path")!.split("/").pop() ?? translate("meeting.trace.file") };
  }
  if (t === "edit" && str("file_path")) {
    return { verb: translate("meeting.trace.edited"), noun: str("file_path")!.split("/").pop() ?? translate("meeting.trace.file") };
  }
  if (t === "bash") {
    const cmd = str("command") ?? "";
    const head = cmd.split("\n")[0].slice(0, 80);
    return { verb: translate("meeting.trace.ran"), noun: translate("meeting.trace.shell"), detail: head ? ` ${head}` : undefined };
  }
  if (t === "grep" && str("pattern")) {
    return { verb: translate("meeting.trace.searched"), noun: translate("meeting.trace.files"), detail: translate("meeting.trace.forPattern", { pattern: str("pattern")! }) };
  }
  if (t === "glob" && str("pattern")) {
    return { verb: translate("meeting.trace.listed"), noun: translate("meeting.trace.files"), detail: translate("meeting.trace.matching", { pattern: str("pattern")! }) };
  }
  if (t.startsWith("toolsearch") && str("query")) {
    return { verb: translate("meeting.trace.lookedUp"), noun: translate("meeting.trace.tools"), detail: `"${str("query")}"` };
  }
  if (t.startsWith("webfetch") && str("url")) {
    let host = str("url")!;
    try { host = new URL(host).hostname; } catch { /* keep raw */ }
    return { verb: translate("meeting.trace.fetched"), noun: host };
  }
  if (t.startsWith("websearch") && str("query")) {
    return { verb: translate("meeting.trace.searched"), noun: translate("meeting.trace.web"), detail: `"${str("query")}"` };
  }
  if (t.startsWith("subagent:")) {
    const subType = toolName.split(":")[1] ?? "";
    const label =
      subType === "web-researcher"
        ? `🌐 ${translate("meeting.trace.webResearch")}`
        : subType === "brain-explorer"
          ? `🧠 ${translate("meeting.trace.brainExplorer")}`
          : subType;
    const desc = str("description");
    return {
      verb: translate("meeting.trace.spawned"),
      noun: label,
      detail: desc ? `— ${desc}` : undefined,
    };
  }
  return null;
}

function describeTrace(trace: ToolTrace, translate: TFn) {
  const builtin = builtinDescriptor(trace.tool, trace.input, translate);
  if (builtin) {
    return { ...builtin, toolkit: "" };
  }
  const human = humanizeToolAction(trace.tool, trace.input);
  return { ...human, verb: displayVerb(human.verb, translate) };
}

const FADE_OPACITY = [1, 0.72, 0.48];

function ToolFeedRow({
  trace,
  ageIndex,
}: {
  trace: ToolTrace;
  ageIndex: number;
}) {
  const { t } = useT();
  const desc = describeTrace(trace, t);
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
        paddingTop: 4,
        paddingBottom: 4,
        paddingInlineStart: 6,
        paddingInlineEnd: 8,
        borderInlineStart: `2px solid ${isHead ? "var(--accent-deep)" : "var(--hairline)"}`,
        borderStartStartRadius: 0,
        borderStartEndRadius: 6,
        borderEndEndRadius: 6,
        borderEndStartRadius: 0,
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
        <bdi>{desc.noun}</bdi>
        {desc.detail && (
          <span style={{ color: "var(--text-muted)" }}>{" "}<bdi>{desc.detail}</bdi></span>
        )}
      </span>
    </motion.div>
  );
}

function ToolFeed({ traces }: { traces: ToolTrace[] }) {
  const { t } = useT();
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
        paddingInlineStart: "var(--sp-2)",
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
          + <bdi>{hidden}</bdi> {t("meeting.earlier")}
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
          {t("shell.collapse")}
        </button>
      )}
    </div>
  );
}

function BlockedDelegationNote({ fromName, toName }: { fromName: string; toName: string }) {
  const { t, locale } = useT();
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
        marginTop: 2,
        marginBottom: 8,
        marginInlineStart: 40,
        background: "transparent",
        border: "1px dashed var(--hairline-strong)",
        borderRadius: 16,
        alignSelf: "flex-start",
        fontSize: "var(--fs-xs)",
        fontWeight: 500,
        color: "var(--text-subtle)",
        fontStyle: "italic",
      }}
      title={t("meeting.taggedTitle", { from: isolate(fromName), to: isolate(toName) })}
    >
      <span style={{ opacity: 0.6, display: "inline-block", transform: locale === "he" ? "scaleX(-1)" : undefined }}>↳</span>
      <span>
        <strong style={{ fontWeight: 600 }}><bdi>{fromName}</bdi></strong> {t("meeting.tagged")}{" "}
        <strong style={{ fontWeight: 600 }}><bdi>{toName}</bdi></strong> · {t("meeting.alreadyIn")}
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

  if (ct.startsWith("image/")) return { glyph: "🖼", label: "IMG", bg: "color-mix(in oklch, var(--danger) 12%, transparent)", fg: "var(--danger)" };

  // Spreadsheets — Excel / Google Sheets / CSV
  if (ext === "xlsx" || ext === "xls" || ct.includes("spreadsheet")) return { glyph: "X", label: "XLS", bg: "color-mix(in oklch, var(--success) 12%, transparent)", fg: "var(--success)" };
  if (ext === "csv" || ct === "text/csv") return { glyph: "≡", label: "CSV", bg: "color-mix(in oklch, var(--success) 12%, transparent)", fg: "var(--success)" };
  if (ext === "tsv") return { glyph: "≡", label: "TSV", bg: "color-mix(in oklch, var(--success) 12%, transparent)", fg: "var(--success)" };

  // Word / Google Doc
  if (ext === "docx" || ext === "doc" || ct.includes("wordprocessing")) return { glyph: "W", label: "DOC", bg: "color-mix(in oklch, var(--twin) 12%, transparent)", fg: "var(--twin)" };

  // PowerPoint / Slides
  if (ext === "pptx" || ext === "ppt" || ct.includes("presentation")) return { glyph: "P", label: "PPT", bg: "color-mix(in oklch, var(--warn) 12%, transparent)", fg: "var(--warn)" };

  // PDF
  if (ext === "pdf" || ct === "application/pdf") return { glyph: "P", label: "PDF", bg: "color-mix(in oklch, var(--danger) 12%, transparent)", fg: "var(--danger)" };

  // JSON / data
  if (ext === "json" || ct === "application/json") return { glyph: "{ }", label: "JSON", bg: "color-mix(in oklch, var(--warn) 12%, transparent)", fg: "var(--warn)" };
  if (ext === "yaml" || ext === "yml") return { glyph: "{ }", label: "YML", bg: "color-mix(in oklch, var(--warn) 12%, transparent)", fg: "var(--warn)" };
  if (ext === "xml" || ct === "application/xml") return { glyph: "<>", label: "XML", bg: "color-mix(in oklch, var(--warn) 12%, transparent)", fg: "var(--warn)" };

  // Markdown / text
  if (ext === "md" || ct === "text/markdown") return { glyph: "M↓", label: "MD", bg: "color-mix(in oklch, var(--accent) 12%, transparent)", fg: "var(--accent-deep)" };
  if (ext === "html" || ct === "text/html") return { glyph: "<>", label: "HTML", bg: "color-mix(in oklch, var(--warn) 12%, transparent)", fg: "var(--warn)" };

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

/* eslint-disable @next/next/no-img-element -- remote attachment previews require native URLs */
function FileShareChip({
  chip,
  meetingId,
  onOpen,
}: {
  chip: SharedFileChip;
  meetingId: string | null;
  onOpen: () => void;
}) {
  const { t } = useT();
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
        paddingTop: 6,
        paddingBottom: 6,
        paddingInlineEnd: 12,
        paddingInlineStart: isImage ? 6 : 8,
        marginTop: 2,
        marginBottom: 8,
        marginInlineStart: 40,
        background: "var(--accent-soft)",
        border: "1px solid var(--hairline-strong)",
        borderRadius: 14,
        alignSelf: "flex-start",
        fontSize: "var(--fs-meta)",
        fontWeight: 500,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "start",
        maxWidth: 460,
      }}
      title={t("meeting.sharedByTitle", { name: isolate(chip.sharedByName) })}
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
          <bdi>{chip.sharedByName}</bdi> {t("meeting.shared")} <code style={{ background: "var(--surface)", padding: "1px 5px", borderRadius: 4, fontSize: "var(--fs-xs)" }}><bdi>{chip.filename}</bdi></code>
        </span>
        <span dir="auto" style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {chip.summary} · <bdi>{sizeLabel}</bdi>
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
  const { t, locale } = useT();
  const rtl = locale === "he";
  const [content, setContent] = useState<string | null>(null);
  // Start in the loading state when a JSON fetch is pending on mount, so the
  // effect doesn't need a synchronous setState to enter it. Image chips (and
  // the no-chip case) render without a fetch, so they start not-loading.
  const [loading, setLoading] = useState(
    () => Boolean(chip && meetingId && chip.kind !== "image")
  );
  const [error, setError] = useState<string | null>(null);

  const isImage = chip?.kind === "image";

  useEffect(() => {
    if (!chip || !meetingId) return;
    // Images render via <img src> directly — no JSON fetch needed.
    if (chip.kind === "image") return;
    let cancelled = false;
    const url = `/api/council/file?meetingId=${encodeURIComponent(meetingId)}&filename=${encodeURIComponent(chip.filename)}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { content: string };
        if (!cancelled) setContent(data.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "fetch_failed");
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
          background: "color-mix(in oklch, var(--text) 32%, transparent)",
          zIndex: 100,
        }}
      />
      <motion.aside
        initial={{ x: rtl ? -480 : 480 }}
        animate={{ x: 0 }}
        exit={{ x: rtl ? -480 : 480 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: "fixed",
          top: 0,
          insetInlineEnd: 0,
          bottom: 0,
          width: 480,
          maxWidth: "90vw",
          background: "var(--bg-elevated)",
          borderInlineStart: "1px solid var(--hairline-strong)",
          boxShadow: "var(--shadow-lg)",
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
              <bdi>{chip.filename}</bdi>
            </div>
            <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)", marginTop: "var(--sp-4)" }}>
              {chip.summary}
            </div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", marginTop: "var(--sp-6)" }}>
              {t("meeting.sharedBy")} <strong><bdi>{chip.sharedByName}</bdi></strong> · <bdi>{chip.contentType}</bdi>
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
            aria-label={t("settings.action.close")}
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
            ⬇ {t("meeting.file.download")}
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
                onError={() => setError(t("meeting.file.imageFailed"))}
              />
            </div>
          ) : (
            <>
              {loading && (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>{t("settings.status.loading")}</div>
              )}
              {error && (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--danger)" }}>
                  {t("meeting.file.loadFailed")}{" "}
                  <bdi>{error === "fetch_failed" ? t("meeting.file.fetchFailed") : error}</bdi>
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

/* eslint-enable @next/next/no-img-element */

function DelegationArrow({ fromName, toName }: { fromName: string; toName: string }) {
  const { t, locale } = useT();
  return (
    <motion.div
      initial={{ opacity: 0, x: locale === "he" ? 6 : -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-6)",
        padding: "5px 10px",
        marginTop: 2,
        marginBottom: 10,
        marginInlineStart: 40,
        background: "var(--accent-soft)",
        border: "1px solid var(--hairline)",
        borderRadius: 20,
        alignSelf: "flex-start",
        fontSize: "var(--fs-meta)",
        fontWeight: 500,
        color: "var(--accent-deep)",
      }}
    >
      <Icons.Arrow size={10} style={locale === "he" ? { transform: "scaleX(-1)" } : undefined} />
      <span>
        <strong><bdi>{fromName}</bdi></strong> {t("meeting.calledIn")} <strong><bdi>{toName}</bdi></strong>
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
  thinking,
  onReply,
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
  thinking?: string;
  onReply?: () => void;
}) {
  const { t, locale } = useT();
  const [hover, setHover] = useState(false);
  const roster = useRoster();
  const thought = thinking && thinking.length > 220 ? `…${thinking.slice(-220)}` : thinking;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut", delay }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "flex",
        gap: "var(--sp-10)",
        marginBottom: "var(--sp-14)",
        maxWidth: 560,
      }}
    >
      {/* reply to this message, like Slack / WhatsApp */}
      <AnimatePresence>
        {onReply && !streaming && text && hover && (
          <motion.button
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.12 }}
            onClick={onReply}
            title={t("meeting.reply")}
            style={{ position: "absolute", top: 12, insetInlineEnd: -8, zIndex: 2, display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--hairline-strong)", background: "var(--surface)", color: "var(--text)", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 600, cursor: "pointer", boxShadow: "var(--shadow-sm)" }}
          >
            <span style={{ display: "inline-block", transform: locale === "he" ? "scaleX(-1)" : undefined }}>↩</span> {t("meeting.reply")}
          </motion.button>
        )}
      </AnimatePresence>
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
          <bdi>{emp.name}</bdi>
          <span style={{ fontWeight: 400, color: "var(--text-subtle)", marginInlineStart: "var(--sp-4)" }}>
            <bdi>{displayRole(emp)}</bdi>
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
                marginInlineStart: "var(--sp-4)",
              }}
            >
              <span style={{ display: "inline-block", transform: locale === "he" ? "scaleX(-1)" : undefined }}>↳</span>{" "}
              {t("meeting.calledInBy")} <bdi>{delegatedFrom.name}</bdi>
            </span>
          )}
          {!streaming && confidence !== undefined && (
            <ConfidencePill value={confidence} />
          )}
        </div>
        <ToolFeed traces={traces} />
        {/* the twin's reasoning, live, until its answer starts */}
        {streaming && !text && thought && (
          <div
            dir="auto"
            style={{ margin: "2px 0 8px", padding: "6px 10px", borderInlineStart: "2px solid var(--accent-soft)", fontSize: "var(--fs-sm)", fontStyle: "italic", lineHeight: 1.5, color: "var(--text-subtle)" }}
          >
            {thought}
          </div>
        )}
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
              borderStartStartRadius: 3,
              borderStartEndRadius: 12,
              borderEndEndRadius: 12,
              borderEndStartRadius: 12,
              fontSize: "var(--fs-base)",
              color: "var(--text)",
              boxShadow: "var(--shadow-sm)",
              transition: "border-color .3s",
            }}
          >
            <Markdown>{linkMentions(text, roster)}</Markdown>
            {streaming && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: "1em",
                  background: "var(--accent)",
                  marginInlineStart: "var(--sp-2)",
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

/** What leaves the meeting besides words: a follow-up on the calendar, Jira
 *  tickets for the next steps, the summary posted to Slack. Each card opens a
 *  preview of exactly what would be sent. For now these are example outputs;
 *  the real send goes through the owner twin's own Composio connection. */
function MeetingOutputs({ decision, empById, question }: { decision: MeetingDecision; empById: Record<string, EmployeeWithTwin>; question: string }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState<"calendar" | "jira" | "slack" | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const owners = [...new Set(decision.actions.map((a) => a.employeeId))].map((id) => empById[id]).filter(Boolean);
  const when = (() => {
    const d = new Date();
    do d.setDate(d.getDate() + 1);
    while (d.getDay() === 5 || d.getDay() === 6); // skip Fri/Sat (IL work week)
    d.setHours(10, 0, 0, 0);
    return d.toLocaleString(locale === "he" ? "he-IL" : "en-US", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  })();
  const topic = question.replace(/\s+/g, " ").slice(0, 60);
  const cards = [
    { key: "calendar" as const, slug: "googlecalendar", title: t("meeting.out.calendar"), sub: `${when} · ${owners.length + 1}` },
    { key: "jira" as const, slug: "jira", title: t("meeting.out.jira"), sub: t("meeting.out.ticketCount", { count: decision.actions.length }) },
    { key: "slack" as const, slug: "slack", title: t("meeting.out.slack"), sub: "#leadership" },
  ];
  const mono = "var(--font-mono, ui-monospace, monospace)";
  return (
    <div style={{ padding: "4px 12px 12px" }}>
      <div style={{ fontSize: "var(--fs-xs)", fontWeight: 650, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 4px 8px" }}>{t("meeting.outputs")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {cards.map((c, i) => {
          const on = open === c.key;
          return (
            <motion.button
              key={c.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.07 }}
              whileHover={{ y: -2 }}
              onClick={() => setOpen(on ? null : c.key)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, cursor: "pointer", font: "inherit", textAlign: "start", background: on ? "var(--bg-sunken)" : "var(--surface)", border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`, boxShadow: on ? "0 0 0 3px color-mix(in oklab, var(--accent) 12%, transparent)" : "var(--shadow-sm)" }}
            >
              <span style={{ display: "flex", alignItems: "center", width: "100%" }}>
                <ToolkitIcon slug={c.slug} size={26} />
                {sent[c.key] && (
                  <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 650, color: "var(--success)" }}>
                    <Icons.Check size={11} /> {t("meeting.out.sent")}
                  </span>
                )}
              </span>
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 650, color: "var(--text)" }}>{c.title}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{c.sub}</span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {open && (
          <motion.div
            key={open}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ marginTop: 8, padding: 14, borderRadius: 12, border: "1px solid var(--hairline)", background: "var(--bg-sunken)", display: "flex", flexDirection: "column", gap: 10 }}>
              {open === "calendar" && (
                <>
                  <div style={{ fontSize: "var(--fs-base)", fontWeight: 650, color: "var(--text)" }} dir="auto">{`Follow-up: ${topic}`}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                    <Icons.Clock size={13} /> {when} · 30 min · Google Meet
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[{ name: "CEO", initials: "CEO" }, ...owners.map((e) => ({ name: e.firstName, initials: e.initials }))].map((p) => (
                      <span key={p.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px 3px 4px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--hairline)", fontSize: "var(--fs-xs)", color: "var(--text)" }}>
                        <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 8, fontWeight: 700, background: "var(--accent-soft)" }}>{p.initials}</span>
                        <bdi>{p.name}</bdi>
                      </span>
                    ))}
                  </div>
                  <div dir="auto" style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {(decision.open.length ? decision.open : [decision.decision]).map((q, i) => (
                      <div key={i}>• {q}</div>
                    ))}
                  </div>
                </>
              )}
              {open === "jira" &&
                decision.actions.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--hairline)" }}>
                    <span style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 650, color: "var(--accent-deep)", whiteSpace: "nowrap" }}>OPS-{142 + i}</span>
                    <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-sm)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.action}</span>
                    <span style={{ fontSize: 11.5, color: "var(--text-subtle)", whiteSpace: "nowrap" }}>
                      <bdi>{empById[a.employeeId]?.firstName}</bdi>
                      {a.due && ` · ${a.due}`}
                    </span>
                  </div>
                ))}
              {open === "slack" && (
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--surface)", border: "1px solid var(--hairline)", flexShrink: 0 }}>
                    <ToolkitIcon slug="slack" size={18} />
                  </span>
                  <div dir="auto" style={{ fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "var(--text)" }}>
                    <div style={{ fontWeight: 700 }}>Employee001 · <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>#leadership</span></div>
                    <div style={{ marginTop: 4 }}><b>Decision:</b> {decision.decision}</div>
                    <div style={{ marginTop: 4 }}><b>Next steps:</b></div>
                    {decision.actions.map((a, i) => (
                      <div key={i}>• <b><bdi>{empById[a.employeeId]?.firstName}</bdi></b> — {a.action}</div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                <span style={{ flex: 1, fontSize: 11, color: "var(--text-subtle)", lineHeight: 1.45 }}>{t("meeting.outputsNote")}</span>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setSent((x) => ({ ...x, [open]: true }))}
                  disabled={sent[open]}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 9, border: "none", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 650, cursor: sent[open] ? "default" : "pointer", color: sent[open] ? "var(--success)" : "var(--bg)", background: sent[open] ? "color-mix(in oklab, var(--success) 14%, transparent)" : "var(--text)" }}
                >
                  {sent[open] ? <><Icons.Check size={12} /> {t("meeting.out.sent")}</> : <><Icons.Send size={12} /> {t("meeting.out.send")}</>}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Summarize & decide": the meeting ends in a decision and owned next steps,
 *  each one a click away from becoming that twin's task. */
function DecisionPanel({
  state,
  empById,
  question,
  meetingId,
  onSummarize,
  onAssign,
  onSummary,
}: {
  state?: { status: "loading" | "ready" | "error"; data?: MeetingDecision; assigned?: Record<number, boolean> };
  empById: Record<string, EmployeeWithTwin>;
  question: string;
  meetingId: string;
  onSummarize: () => void;
  onAssign: (idx: number) => void;
  /** The stored summary changed (an action was sent to Roomate). */
  onSummary: (summary: RoomateSummary) => void;
}) {
  const { t } = useT();
  if (!state || state.status === "error") {
    return (
      <div style={{ margin: "4px 0 12px 40px", display: "flex", alignItems: "center", gap: 10 }}>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          onClick={onSummarize}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999, border: "1px solid var(--hairline-strong)", background: "var(--surface)", color: "var(--text)", font: "inherit", fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer", boxShadow: "var(--shadow-sm)" }}
        >
          <Icons.CheckCircle size={14} /> {t("meeting.decide")}
        </motion.button>
        {state?.status === "error" && <span style={{ fontSize: "var(--fs-xs)", color: "var(--danger)" }}>{t("meeting.decideError")}</span>}
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div style={{ margin: "4px 0 12px 40px", display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
        <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} style={{ display: "inline-flex" }}>
          <Icons.Loader size={14} />
        </motion.span>
        {t("meeting.deciding")}
      </div>
    );
  }
  const d = state.data!;
  const assigned = state.assigned ?? {};
  const allAssigned = d.actions.length > 0 && d.actions.every((_, i) => assigned[i]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      style={{ margin: "4px 0 16px 40px", maxWidth: 640, borderRadius: "var(--radius-xl)", border: "1px solid color-mix(in oklab, var(--success) 45%, var(--hairline))", background: "var(--surface)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}
    >
      <div style={{ padding: "14px 16px", background: "color-mix(in oklab, var(--success) 8%, var(--surface))", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "var(--fs-xs)", fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--success)" }}>
          <Icons.CheckCircle size={13} /> {t("meeting.decision")}
        </div>
        <div dir="auto" style={{ marginTop: 6, fontSize: "var(--fs-base)", fontWeight: 600, lineHeight: 1.5, color: "var(--text)" }}>{d.decision}</div>
      </div>
      {d.actions.length > 0 && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", padding: "0 4px 4px" }}>
            <span style={{ fontSize: "var(--fs-xs)", fontWeight: 650, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("meeting.nextSteps")}</span>
            {!allAssigned && (
              <button
                onClick={() => d.actions.forEach((_, i) => !assigned[i] && onAssign(i))}
                style={{ marginInlineStart: "auto", padding: "4px 10px", borderRadius: 8, border: "none", background: "var(--text)", color: "var(--bg)", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 650, cursor: "pointer" }}
              >
                {t("meeting.assignAll")}
              </button>
            )}
          </div>
          {d.actions.map((a, i) => {
            const emp = empById[a.employeeId];
            const done = assigned[i];
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 * i }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "var(--bg-sunken)" }}
              >
                {emp && <Avatar emp={emp} size={26} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div dir="auto" style={{ fontSize: "var(--fs-sm)", color: "var(--text)", lineHeight: 1.45 }}>{a.action}</div>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                    <bdi>{emp?.firstName ?? a.employeeId}</bdi>
                    {a.due && <> · {a.due}</>}
                  </div>
                  <SendToRoomate
                    meetingId={meetingId}
                    index={i}
                    action={a}
                    ownerName={emp?.firstName ?? a.employeeId}
                    ownerLeft={emp?.lifecycle === "retired"}
                    onSummary={onSummary}
                  />
                </div>
                <button
                  onClick={() => !done && onAssign(i)}
                  disabled={done}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, border: `1px solid ${done ? "transparent" : "var(--hairline-strong)"}`, background: done ? "color-mix(in oklab, var(--success) 14%, transparent)" : "var(--surface)", color: done ? "var(--success)" : "var(--text)", font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 650, cursor: done ? "default" : "pointer", whiteSpace: "nowrap" }}
                >
                  {done ? <><Icons.Check size={11} /> {t("meeting.assigned")}</> : <><Icons.Zap size={11} /> {t("meeting.assign")}</>}
                </button>
              </motion.div>
            );
          })}
        </div>
      )}
      <MeetingOutputs decision={d} empById={empById} question={question} />
      {d.open.length > 0 && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ fontSize: "var(--fs-xs)", fontWeight: 650, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "6px 0 4px" }}>{t("meeting.open")}</div>
          {d.open.map((q, i) => (
            <div key={i} dir="auto" style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>• {q}</div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function TypingIndicator({ emp }: { emp: EmployeeWithTwin }) {
  const { t } = useT();
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
        <bdi>{emp.firstName}</bdi> {t("meeting.thinking")}
      </span>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

// useSearchParams (the demo's `?q=` prefill) needs a Suspense boundary, or
// Next can't prerender this route.
export default function CouncilPage() {
  return (
    <Suspense fallback={null}>
      <CouncilPageInner />
    </Suspense>
  );
}

function CouncilPageInner() {
  const { t, locale } = useT();
  const searchParams = useSearchParams();
  const rtl = locale === "he";
  const roster = useRoster();
  // `null` means "not customized yet" — the active set defaults to every ready
  // twin, derived during render. Once the CEO toggles a participant it holds a
  // concrete Set. This derives the default from the (asynchronously-hydrated)
  // roster without seeding state from an effect.
  const [activeIdsOverride, setActiveIdsOverride] = useState<Set<string> | null>(
    null
  );
  // The override is narrowed to twins that can answer now: a meeting continued
  // from History may list twins since retired or not ready. If none are left,
  // fall back to every ready twin so the CEO can still ask.
  // `?with=a,b` opens the room with just those twins (an Inbox conflict item
  // links here); a toggle by the CEO replaces it.
  const withParam = searchParams.get("with");
  const activeIds = useMemo(() => {
    const ready = roster.filter((e) => e.twinStatus === "ready" && e.lifecycle !== "retired").map((e) => e.id);
    const requested = activeIdsOverride ?? (withParam ? new Set(withParam.split(",")) : null);
    if (!requested) return new Set(ready);
    const kept = ready.filter((id) => requested.has(id));
    return new Set(kept.length > 0 ? kept : ready);
  }, [activeIdsOverride, roster, withParam]);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  // Stable across CEO messages — server uses it to load the meeting transcript
  // so every twin sees prior CEO asks and prior twin turns. Meetings are stored
  // server-side (meeting-store), and `?meeting=<id>` reopens one after a
  // reload or from History. Held in state (not a ref) because file chips read
  // it during render to build their download/preview URLs.
  const [meetingId, setMeetingId] = useState<string | null>(null);
  // Meeting memory: skip the brief / keep this meeting out of later briefs,
  // and the brief a reopened meeting started from.
  const [freshStart, setFreshStart] = useState(false);
  const [forgetMeeting, setForgetMeeting] = useState(false);
  const [frozenBrief, setFrozenBrief] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  // The meeting id last asked for via `?meeting=`; stops repeat fetches and
  // drops a late answer once something else was opened.
  const requestedMeeting = useRef<string | null>(null);
  const meetingParam = searchParams.get("meeting");
  // `?q=` prefills the input (the demo banner links to the recorded
  // question). Re-apply it when the param changes, because the banner link is
  // a client-side navigation to this same, already-mounted page.
  const rawQ = searchParams.get("q");
  const prefill = rawQ && rawQ.length <= 500 ? rawQ : "";
  const sendPrefill = searchParams.get("send") === "1";
  const [input, setInput] = useState(prefill);
  const [appliedPrefill, setAppliedPrefill] = useState(prefill);
  const sentPrefills = useRef(new Set<string>());
  if (prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    if (prefill) setInput(prefill);
  }
  const [typingFor, setTypingFor] = useState<string[]>([]);
  // Who answers: only the relevant twins (router picks) or everyone selected.
  const [relevantOnly, setRelevantOnly] = useState(true);
  const [replyTo, setReplyTo] = useState<{ employeeId: string; name: string; excerpt: string } | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { status: "loading" | "ready" | "error"; data?: MeetingDecision; assigned?: Record<number, boolean> }>>({});
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [openFile, setOpenFile] = useState<SharedFileChip | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readyEmployees = useMemo(
    () => roster.filter((e) => e.twinStatus === "ready" && e.lifecycle !== "retired"),
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
    setActiveIdsOverride((prev) => {
      // Toggle on the effective room, so the "at least one" guard counts real twins.
      const next = new Set(activeIds);
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
    const threadId = makeThreadId();

    // If @-mentions are present, only those twins respond.
    // Otherwise, all currently selected twins respond.
    const mentionedIds = parseMentions(trimmed);
    const quoting = replyTo;
    setReplyTo(null);
    const respondingIds = mentionedIds
      ? mentionedIds
      : quoting
        ? [quoting.employeeId]
        : roster.filter(
          (e) => activeIds.has(e.id) && e.twinStatus === "ready" && e.lifecycle !== "retired"
        ).map((e) => e.id);

    if (respondingIds.length === 0) return;
    // Relevant mode (no @mentions): the server picks who answers out of the room.
    const auto = relevantOnly && !mentionedIds && !quoting && respondingIds.length > 1;

    // Add user message + skeleton responses
    setThreads((prev) => [
      ...prev,
      {
        id: threadId,
        userText: trimmed,
        routed: auto ? null : undefined,
        replyTo: quoting ?? undefined,
        responses: (auto ? [] : respondingIds).map((id) => ({
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
    setTypingFor(auto ? [] : respondingIds);
    scrollToBottom();

    try {
      const res = await fetch("/api/council/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // A reply carries the quoted message, so the twin knows what it answers.
          question: quoting ? `(Replying to ${quoting.name}'s message: "${quoting.excerpt}")\n\n${trimmed}` : trimmed,
          employeeIds: respondingIds,
          meetingId: meetingId ?? undefined,
          auto,
          // Applied only to a meeting nobody has spoken in yet, including a new
          // one the server opens because the old id is gone.
          fresh: freshStart,
          forget: forgetMeeting,
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

          let event: CouncilEvent | { type: "meeting"; meetingId: string } | { type: "routed"; picks: { id: string; matched: string[] }[] };
          try {
            event = JSON.parse(raw) as
              | CouncilEvent
              | { type: "meeting"; meetingId: string }
              | { type: "routed"; picks: { id: string; matched: string[] }[] };
          } catch {
            continue;
          }

          // Relevant mode: the server says who it asked. Seed their bubbles.
          if (event.type === "routed") {
            const picks = event.picks;
            setThreads((prev) =>
              prev.map((t) =>
                t.id === threadId
                  ? {
                      ...t,
                      routed: picks,
                      responses: picks.map((p) => ({
                        employeeId: p.id,
                        text: "",
                        streaming: false,
                        confidence: undefined,
                        traces: [],
                        pendingApprovals: [],
                        pendingClarifications: [],
                        blocked: [],
                        artifacts: [],
                      })),
                    }
                  : t,
              ),
            );
            setTypingFor(picks.map((p) => p.id));
            continue;
          }

          // Server tells us which meeting this run belonged to. Persist
          // it so the next CEO ask carries the same id and the server
          // loads the same transcript.
          if (event.type === "meeting") {
            setMeetingId(event.meetingId);
            requestedMeeting.current = event.meetingId;
            setMeetingParam(event.meetingId);
            // Show the brief the server froze for the twins, not the preview.
            const id = event.meetingId;
            void fetchMeetingDetail(id).then((detail) => {
              if (!detail || requestedMeeting.current !== id) return;
              setFrozenBrief(detail.brief?.text ?? null);
              setForgetMeeting(detail.forget === true);
            });
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

      case "thinking_delta":
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== threadId) return t;
            const idx = lastStreamingIdx(t.responses, event.employeeId);
            if (idx < 0) return t;
            const responses = t.responses.slice();
            responses[idx] = { ...responses[idx], thinking: (responses[idx].thinking ?? "") + event.delta };
            return { ...t, responses };
          })
        );
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
                  ? { ...r, text: `⚠️ ${event.message}`, streaming: false }
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

  const router = useRouter();
  // After the handlers it calls (sendMessage → handleEvent), so the React
  // compiler sees them declared. sendMessage is intentionally omitted: sentPrefills makes this URL-triggered effect one-shot.
  useEffect(() => {
    if (!sendPrefill) {
      sentPrefills.current.delete(prefill);
      return;
    }
    if (!prefill || readyEmployees.length === 0 || sentPrefills.current.has(prefill)) return;
    sentPrefills.current.add(prefill);
    void sendMessage(prefill);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("send");
    router.replace(params.size ? `/council?${params}` : "/council");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, readyEmployees.length, router, searchParams, sendPrefill]);

  const busy = threads.some((th) => th.pending);

  /** Make a stored meeting the active one: its transcript becomes the chat,
   *  its participants the room, and an up-to-date summary its decision. */
  function applyMeeting(detail: HistoryDetail) {
    const rebuilt = threadsFromMeeting(detail);
    setThreads(rebuilt);
    setMeetingId(detail.id);
    setFreshStart(false);
    setForgetMeeting(detail.forget === true);
    setFrozenBrief(detail.brief?.text ?? null);
    setReplyTo(null);
    setOpenFile(null);
    setTypingFor([]);
    // Not filtered by readiness here: the roster may still be loading after a
    // reload, and sendMessage already skips twins that aren't ready.
    const room = detail.participants.map((p) => p.id);
    setActiveIdsOverride(room.length > 0 ? new Set(room) : null);
    const last = rebuilt[rebuilt.length - 1];
    const summary = detail.summary;
    setDecisions(
      last && summary && summary.throughTurn >= detail.transcript.length
        ? { [last.id]: { status: "ready", data: summary, assigned: {} } }
        : {}
    );
    scrollToBottom();
  }

  function continueMeeting(detail: HistoryDetail) {
    requestedMeeting.current = detail.id;
    applyMeeting(detail);
    setMeetingParam(detail.id);
    setHistoryOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function startNewMeeting() {
    requestedMeeting.current = null;
    setThreads([]);
    setMeetingId(null);
    setFreshStart(false);
    setForgetMeeting(false);
    setFrozenBrief(null);
    setDecisions({});
    setReplyTo(null);
    setOpenFile(null);
    setActiveIdsOverride(null);
    setMeetingParam(null);
    inputRef.current?.focus();
  }

  // `?meeting=<id>` (a reload, or a shared link) reopens a stored meeting.
  useEffect(() => {
    if (!meetingParam || meetingParam === meetingId || requestedMeeting.current === meetingParam) return;
    requestedMeeting.current = meetingParam;
    void fetchMeetingDetail(meetingParam).then((detail) => {
      if (requestedMeeting.current !== meetingParam) return;
      if (detail) applyMeeting(detail);
      else {
        requestedMeeting.current = null;
        setMeetingParam(null);
      }
    });
  // applyMeeting only sets state; re-running on its identity would refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingParam, meetingId]);

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
  const readyCount = roster.filter((e) => e.twinStatus === "ready" && e.lifecycle !== "retired").length;

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

      <Topbar
        crumbs={[t("nav.teamMeeting")]}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
            {threads.length > 0 && (
              <button
                type="button"
                className="btn sm"
                onClick={startNewMeeting}
                disabled={busy}
                style={{ height: 28, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icons.Plus size={12} /> {t("meeting.new")}
              </button>
            )}
            <button
              ref={historyButtonRef}
              type="button"
              className="btn sm"
              onClick={() => setHistoryOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              style={{ height: 28, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icons.Clock size={12} /> {t("meeting.history")}
            </button>
          </div>
        }
      />
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
                <UserBubble text={thread.userText} replyTo={thread.replyTo} />

                {/* who the room asked (relevant mode) */}
                {thread.routed === null && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px 40px", fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                    <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.1, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
                    {t("meeting.routing")}
                  </div>
                )}
                {thread.routed && thread.routed.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, margin: "0 0 12px 40px", fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                    {t("meeting.routedTo")}
                    {thread.routed.map((p) => (
                      <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px 2px 3px", borderRadius: 999, border: "1px solid var(--hairline)", background: "var(--surface)" }}>
                        {empById[p.id] && <Avatar emp={empById[p.id]} size={16} />}
                        <span style={{ fontWeight: 600, color: "var(--text-muted)" }}><bdi>{empById[p.id]?.firstName ?? p.id}</bdi></span>
                        {p.matched.length > 0 && <span>· {p.matched.join(", ")}</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Twin responses, Slack-style: a twin called in by a @tag answers
                    in a thread under the message that tagged them. */}
                {(() => {
                  const visible = thread.responses
                    .map((resp, originalIdx) => ({ resp, originalIdx }))
                    .filter(
                      ({ resp }) =>
                        resp.text.length > 0 ||
                        resp.streaming ||
                        resp.traces.length > 0 ||
                        resp.pendingApprovals.length > 0 ||
                        resp.blocked.length > 0 ||
                        resp.artifacts.length > 0
                    );
                  // Thread root of each response: the latest earlier message by
                  // whoever tagged it (and that message's own root).
                  const rootOf = new Map<number, number>();
                  for (const { resp, originalIdx } of visible) {
                    let root = originalIdx;
                    if (resp.delegatedFrom) {
                      for (let j = originalIdx - 1; j >= 0; j--) {
                        if (thread.responses[j].employeeId === resp.delegatedFrom.id && rootOf.has(j)) {
                          root = rootOf.get(j) ?? j;
                          break;
                        }
                      }
                    }
                    rootOf.set(originalIdx, root);
                  }
                  const renderOne = (resp: TwinResponse, originalIdx: number, i: number, inThread: boolean) => {
                    const emp = empById[resp.employeeId];
                    if (!emp) return null;
                    const blockedHere = thread.blockedDelegations.filter((b) => b.afterResponseIdx === originalIdx);
                    const filesHere = thread.fileShares.filter((f) => f.afterResponseIdx === originalIdx);
                    return (
                      <div key={`${resp.employeeId}-${originalIdx}`}>
                        {resp.delegatedFrom && !inThread && <DelegationArrow fromName={resp.delegatedFrom.name} toName={emp.firstName} />}
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
                          thinking={resp.thinking}
                          onReply={() => {
                            const plain = resp.text.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
                            setReplyTo({ employeeId: resp.employeeId, name: emp.firstName, excerpt: plain.length > 160 ? `${plain.slice(0, 160)}…` : plain });
                            inputRef.current?.focus();
                          }}
                        />
                        {filesHere.map((f) => (
                          <FileShareChip key={f.id} chip={f} meetingId={meetingId} onOpen={() => setOpenFile(f)} />
                        ))}
                        {blockedHere.map((b) => (
                          <BlockedDelegationNote key={b.id} fromName={b.fromName} toName={b.toName} />
                        ))}
                      </div>
                    );
                  };
                  const roots = visible.filter(({ originalIdx }) => rootOf.get(originalIdx) === originalIdx);
                  return (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {roots.map(({ resp, originalIdx }, i) => {
                        const replies = visible.filter((v) => v.originalIdx !== originalIdx && rootOf.get(v.originalIdx) === originalIdx);
                        return (
                          <div key={`root-${originalIdx}`}>
                            {renderOne(resp, originalIdx, i, false)}
                            {replies.length > 0 && (
                              <motion.div
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                                style={{ marginInlineStart: 40, marginTop: -6, marginBottom: 14, paddingInlineStart: 16, borderInlineStart: "2px solid var(--hairline-strong)" }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0 10px", fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--accent-deep)" }}>
                                  <Icons.MessageSquare size={11} />
                                  {t(replies.length === 1 ? "meeting.replyOne" : "meeting.replies", { count: replies.length })}
                                </div>
                                {replies.map((r, j) => renderOne(r.resp, r.originalIdx, j, true))}
                              </motion.div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* close the discussion: a decision and who does what next */}
                {!thread.pending && meetingId && thread.id === threads[threads.length - 1]?.id && thread.responses.filter((r) => r.text).length >= 2 && (
                  <DecisionPanel
                    state={decisions[thread.id]}
                    empById={empById}
                    question={thread.userText}
                    meetingId={meetingId}
                    onSummary={(summary) =>
                      setDecisions((d) => ({ ...d, [thread.id]: { ...d[thread.id], status: "ready", data: summary } }))
                    }
                    onSummarize={async () => {
                      setDecisions((d) => ({ ...d, [thread.id]: { status: "loading" } }));
                      try {
                        const res = await fetch("/api/council/summary", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ meetingId }),
                        });
                        if (!res.ok) throw new Error(String(res.status));
                        const data = (await res.json()) as MeetingDecision;
                        setDecisions((d) => ({ ...d, [thread.id]: { status: "ready", data, assigned: {} } }));
                      } catch {
                        setDecisions((d) => ({ ...d, [thread.id]: { status: "error" } }));
                      }
                    }}
                    onAssign={async (idx) => {
                      const a = decisions[thread.id]?.data?.actions[idx];
                      if (!a) return;
                      setDecisions((d) => ({ ...d, [thread.id]: { ...d[thread.id], assigned: { ...d[thread.id]?.assigned, [idx]: true } } }));
                      await fetch("/api/work-items", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          assigneeEmployeeId: a.employeeId,
                          title: a.action.slice(0, 90),
                          task: `From today's team meeting ("${thread.userText.slice(0, 200)}"), the CEO assigned you this next step${a.due ? ` (due: ${a.due})` : ""}. Do it, then end with a short summary of what you did and the result.\n\n${a.action}`,
                          startNow: true,
                        }),
                      }).catch(() => {});
                    }}
                  />
                )}
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

      <MeetingMemoryCard
        meetingId={meetingId}
        started={threads.length > 0}
        participantIds={[...activeIds]}
        frozenBrief={frozenBrief}
        fresh={freshStart}
        onFresh={setFreshStart}
        forget={forgetMeeting}
        onForget={setForgetMeeting}
      />

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
        {/* replying to one message: the quote sits above the input, like WhatsApp */}
        <AnimatePresence>
          {replyTo && (
            <motion.div
              initial={{ opacity: 0, y: 6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: 6, height: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: "hidden" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "7px 10px", borderRadius: 10, borderInlineStart: "3px solid var(--accent)", background: "var(--surface)", border: "1px solid var(--hairline)" }}>
                {empById[replyTo.employeeId] && <Avatar emp={empById[replyTo.employeeId]} size={22} />}
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                  <div style={{ fontSize: "var(--fs-xs)", fontWeight: 650, color: "var(--accent-deep)" }}>
                    {t("meeting.replyingTo")} <bdi>{replyTo.name}</bdi>
                  </div>
                  <div dir="auto" style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{replyTo.excerpt}</div>
                </div>
                <button
                  onClick={() => setReplyTo(null)}
                  aria-label={t("meeting.cancelReply")}
                  style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-subtle)", cursor: "pointer" }}
                >
                  <Icons.X size={12} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* @-mention dropdown */}
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              insetInlineStart: 24,
              insetInlineEnd: 24,
              marginBottom: "var(--sp-4)",
              background: "var(--surface)",
              border: "1px solid var(--hairline-strong)",
              borderRadius: 10,
              boxShadow: "var(--shadow-dropdown)",
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
              {t("meeting.address")}
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
                  textAlign: "start",
                  fontFamily: "inherit",
                  transition: "background .1s",
                }}
              >
                <Avatar emp={emp} size={24} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>
                    <bdi>{emp.firstName}</bdi>
                    <span
                      style={{
                        fontWeight: 400,
                        color: "var(--text-subtle)",
                        marginInlineStart: "var(--sp-6)",
                        fontSize: "var(--fs-meta)",
                      }}
                    >
                      <bdi>@{emp.firstName.toLowerCase()}</bdi>
                    </span>
                  </div>
                  <div style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                    <bdi>{displayRole(emp)}</bdi>
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
            paddingTop: 6,
            paddingBottom: 6,
            paddingInlineStart: 14,
            paddingInlineEnd: 6,
            alignItems: "center",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            dir="auto"
            placeholder={t("meeting.placeholder")}
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
            <Icons.Arrow size={13} style={rtl ? { transform: "scaleX(-1)" } : undefined} />
            {t("meeting.ask")}
          </button>
        </div>
        <div
          style={{
            fontSize: "var(--fs-meta)",
            color: "var(--text-subtle)",
            marginTop: "var(--sp-7)",
            paddingInlineStart: "var(--sp-2)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-6)",
          }}
        >
          <span role="group" aria-label={t("meeting.whoAnswers")} style={{ display: "inline-flex", padding: 2, gap: 2, borderRadius: 8, background: "var(--bg-sunken)", border: "1px solid var(--hairline)" }}>
            {([true, false] as const).map((rel) => (
              <button
                key={String(rel)}
                onClick={() => setRelevantOnly(rel)}
                aria-pressed={relevantOnly === rel}
                title={rel ? t("meeting.relevantHint") : t("meeting.everyoneHint")}
                style={{ padding: "2px 9px", borderRadius: 6, border: "none", cursor: "pointer", font: "inherit", fontSize: "var(--fs-meta)", fontWeight: 600, background: relevantOnly === rel ? "var(--surface)" : "transparent", color: relevantOnly === rel ? "var(--text)" : "var(--text-subtle)", boxShadow: relevantOnly === rel ? "0 1px 2px color-mix(in oklab, var(--text) 12%, transparent)" : "none" }}
              >
                {rel ? t("meeting.relevant") : t("meeting.everyone")}
              </button>
            ))}
          </span>
          <span>
            <bdi>{readyCount}</bdi>{" "}
            {t(readyCount === 1 ? "meeting.twinsConnectedOne" : "meeting.twinsConnectedMany")} ·
          </span>
          <span>
            {t("meeting.mentionBefore")}{" "}
            <code
              style={{
                fontFamily: "inherit",
                background: "var(--bg-sunken)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              <bdi>@</bdi>
            </code>{" "}
            {t("meeting.mentionAfter")}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {openFile && (
          <FileDrawer
            key={openFile.id}
            meetingId={meetingId}
            chip={openFile}
            onClose={() => setOpenFile(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {historyOpen && (
          <MeetingHistoryDrawer
            key="meeting-history"
            currentMeetingId={meetingId}
            busy={busy}
            empById={empById}
            onClose={() => {
              setHistoryOpen(false);
              requestAnimationFrame(() => historyButtonRef.current?.focus());
            }}
            onContinue={continueMeeting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
