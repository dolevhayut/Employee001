"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { Topbar } from "@/components/ex/shell";
import { Markdown } from "@/components/ex/markdown";
import { PageHead } from "@/components/ex/page-head";
import { TwinEditor } from "@/components/editor/TwinEditor";
import {
  EMPLOYEES_WITH_TWIN,
  CLAUDE_MODELS,
  ELEVENLABS_VOICES,
  ELEVENLABS_VOICE_STORAGE_KEY,
  type EmployeeWithTwin,
  type ClaudeModel,
} from "@/lib/employees";
import type { OrgSkillPlaybook } from "@/lib/org-skills";

const MODELS_STORAGE_KEY = "employee001.models.v1";

// Extract short bullets / h3 headings from a profile markdown body. Used to
// populate the Overview tab's "Authoritative domains" (EXPERTISE.md) and
// "Boundaries" (BOUNDARIES.md) panels from the actual twin's content rather
// than a hardcoded list. Strips leading bullet markers, normalises
// whitespace, drops items that are obviously sentences rather than topics.
function extractBullets(md: string, max = 8): string[] {
  if (!md) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let item: string | undefined;
    const bullet = line.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    if (bullet) item = bullet[1];
    else {
      const heading = line.match(/^#{2,4}\s+(.+)$/);
      if (heading) item = heading[1];
    }
    if (!item) continue;
    // Strip inline markdown formatting and trailing punctuation
    item = item
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/[.;,:]+$/, "")
      .trim();
    if (item.length < 3 || item.length > 80) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

const PROFILE_FILE_DESCRIPTIONS: Record<string, string> = {
  "EXPERTISE.md": "Domains the twin can answer authoritatively",
  "TONE.md": "Voice, communication style, characteristic phrases",
  "CONTEXT.md": "Role, org chart, current priorities",
  "DECISIONS.md": "Decision-making patterns and past calls",
  "PREFERENCES.md": "How they like to work, tools, communication",
  "PEOPLE.md": "Relationships and who they defer to",
  "PROJECTS.md": "Currently active projects",
  "BOUNDARIES.md": "Topics the twin should never answer alone",
  "EMPLOYMENT.md": "Formal HR record, manager, reports, certifications",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type FileNode = {
  name: string;
  tokens: number;
  confidence: number;
  lastUpdated: string;
  sources: string[];
  linkedFiles: string[];
  tags: string[];
};

type Tab = "overview" | "files" | "versions" | "danger";

// A knowledge file as returned by GET /api/employees/<id>/knowledge.
type KnowledgeFileMeta = {
  name: string;
  size: number;
  tokens: number;
  ext: string;
  mtime: string;
};

// Which group the currently-selected file lives in. "profile" files are the
// 9 base files (twin-builder may overwrite them); "knowledge" files are
// CEO-owned enrichment files that are never overwritten.
type FileGroup = "profile" | "knowledge";

type SelectedFile = { group: FileGroup; name: string };

// Extensions the knowledge upload picker accepts — text only (agent-readable).
const KNOWLEDGE_ACCEPT = ".md,.markdown,.txt,.csv,.json";

type EmployeeSkillsPayload = {
  skills: OrgSkillPlaybook[];
  assignedSkillIds: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="badge"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        fontSize: "var(--fs-sm)",
        padding: "5px 10px",
      }}
    >
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </h2>
  );
}

function SectionGroup({
  title,
  subhead,
  children,
  divider = true,
}: {
  title: string;
  subhead?: string;
  children: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <section
      style={{
        paddingTop: divider ? 28 : 0,
        borderTop: divider ? "1px solid var(--hairline)" : "none",
      }}
    >
      <header style={{ marginBottom: "var(--sp-24)" }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {subhead && (
          <p
            className="muted"
            style={{
              fontSize: "var(--fs-ui)",
              lineHeight: 1.5,
              color: "var(--text-subtle)",
              margin: "6px 0 0",
            }}
          >
            {subhead}
          </p>
        )}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-28)" }}>
        {children}
      </div>
    </section>
  );
}

function ConsentCard({ employee }: { employee: EmployeeWithTwin }) {
  const consent = employee.consent;
  const firstName = employee.name.split(" ")[0];

  if (!consent) {
    return (
      <div
        className="card"
        style={{
          padding: "var(--sp-16)",
          borderColor: "var(--warn)",
          background: "rgba(180,140,60,0.06)",
        }}
      >
        <div className="row" style={{ gap: "var(--sp-10)", alignItems: "flex-start" }}>
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              flexShrink: 0,
              marginTop: "var(--sp-2)",
              borderRadius: "50%",
              background: "var(--warn)",
              color: "var(--bg)",
              display: "grid",
              placeItems: "center",
              fontSize: "var(--fs-meta)",
              fontWeight: 700,
            }}
          >
            !
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>
              Consent not on file
            </div>
            <div className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-3)", lineHeight: 1.5 }}>
              {firstName} has not yet consented to having a digital twin trained on
              their work data. The twin cannot ingest data until consent is granted.
            </div>
          </div>
          <Link
            href={`/onboarding?employee=${employee.id}`}
            className="btn sm"
            style={{ textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Request consent
          </Link>
        </div>
      </div>
    );
  }

  const grantedDate = new Date(consent.grantedAt);
  const dateLabel = grantedDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="card" style={{ padding: "var(--sp-16)" }}>
      <div className="row" style={{ gap: "var(--sp-10)", alignItems: "center", marginBottom: "var(--sp-12)" }}>
        <Icons.Check size={14} style={{ color: "var(--success)" }} />
        <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
          Consented on {dateLabel}
        </div>
        <span className="badge mono" style={{ fontSize: "var(--fs-xs)" }}>
          v{consent.version}
        </span>
        <div className="spacer" />
        <button
          className="btn sm ghost"
          style={{ color: "var(--danger)" }}
          title="Revoke consent — pauses the twin and queues data deletion within 30 days"
        >
          Revoke
        </button>
      </div>
      <div
        className="subtle"
        style={{ fontSize: "var(--fs-meta)", lineHeight: 1.5, marginBottom: "var(--sp-8)" }}
      >
        Scopes granted by {firstName}:
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: "var(--sp-6)" }}>
        {consent.scopes.map((s) => (
          <span
            key={s}
            className="badge"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent-deep)",
              fontSize: "var(--fs-xs)",
              padding: "2px 8px",
            }}
          >
            {s.replace(/-/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

function LineageCard({ employee }: { employee: EmployeeWithTwin }) {
  const lineage = employee.lineage;

  if (!lineage || lineage.sources.length === 0) {
    return (
      <div className="card" style={{ padding: "var(--sp-16)" }}>
        <div className="subtle" style={{ fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>
          No data ingested yet. Once {employee.name.split(" ")[0]} connects sources,
          this section will show exactly what fed the twin.
        </div>
      </div>
    );
  }

  const totalItems = lineage.sources.reduce((sum, s) => sum + s.count, 0);
  const tokensM = (lineage.totalTokens / 1_000_000).toFixed(2);
  const lastSync = new Date(lineage.lastSyncAt);
  const lastSyncRel = relTime(lastSync);
  const earliest = lineage.sources.reduce(
    (min, s) => (s.fromDate < min ? s.fromDate : min),
    lineage.sources[0].fromDate
  );
  const windowMonths = Math.round(
    (Date.now() - new Date(earliest).getTime()) / (1000 * 60 * 60 * 24 * 30)
  );

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Headline stats */}
      <div
        className="row"
        style={{
          padding: "16px 18px",
          gap: "var(--sp-28)",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg-elevated)",
          flexWrap: "wrap",
        }}
      >
        <Stat label="Items indexed" value={totalItems.toLocaleString()} />
        <Stat label="Tokens" value={`${tokensM}M`} />
        <Stat label="Window" value={`${windowMonths} months`} />
        <Stat label="Last sync" value={lastSyncRel} />
        <div className="spacer" />
        <button
          className="btn sm ghost"
          title="Re-index all sources now"
          style={{ alignSelf: "center" }}
        >
          <Icons.Refresh size={11} /> Re-sync
        </button>
      </div>

      {/* Per-source breakdown */}
      <div>
        {lineage.sources.map((s, i) => {
          const pct = Math.round((s.tokens / lineage.totalTokens) * 100);
          const from = new Date(s.fromDate).toLocaleDateString(undefined, {
            month: "short",
            year: "2-digit",
          });
          const to = new Date(s.toDate).toLocaleDateString(undefined, {
            month: "short",
            year: "2-digit",
          });
          return (
            <div
              key={s.toolkit + s.itemType}
              className="row"
              style={{
                padding: "12px 18px",
                gap: "var(--sp-14)",
                borderBottom:
                  i < lineage.sources.length - 1
                    ? "1px solid var(--hairline)"
                    : "none",
              }}
            >
              <ToolkitIcon slug={s.toolkit} size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: "var(--sp-8)", alignItems: "baseline" }}>
                  <div
                    style={{
                      fontSize: "var(--fs-ui)",
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}
                  >
                    {s.toolkit}
                  </div>
                  <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
                    {s.itemType}
                  </div>
                </div>
                <div className="subtle mono" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-2)" }}>
                  {from} → {to} · synced {relTime(new Date(s.lastSyncAt))}
                </div>
              </div>
              <div style={{ textAlign: "right", minWidth: 110 }}>
                <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
                  {s.count.toLocaleString()}
                </div>
                <div className="subtle" style={{ fontSize: "var(--fs-xs)" }}>
                  {(s.tokens / 1000).toFixed(0)}K tokens · {pct}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="section-title"
        style={{ fontSize: "var(--fs-2xs)", marginBottom: "var(--sp-2)" }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: "var(--fs-lg)", fontWeight: 600, letterSpacing: "-0.01em" }}
      >
        {value}
      </div>
    </div>
  );
}

function relTime(d: Date) {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProfilePageContent() {
  const sp = useSearchParams();
  const empId = sp.get("employee");

  // Pull static + hired (marketplace) employees and resolve by id
  const [allEmployees, setAllEmployees] = useState<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);
  useEffect(() => {
    fetch("/api/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: EmployeeWithTwin[]) => setAllEmployees(data))
      .catch(() => {/* fall back to static */});
  }, []);

  // After a fresh install — or when a CEO opens a stale profile URL whose
  // employee was deleted — `allEmployees` is empty. Previously we fell back
  // to `allEmployees[0]` (undefined) and crashed on `.id`. Now we treat the
  // missing case explicitly and render a friendly empty state below.
  const employee: EmployeeWithTwin | undefined =
    allEmployees.find((e) => e.id === empId) ?? allEmployees[0];
  const employeeId = employee?.id;

  const [tab, setTab] = useState<Tab>("overview");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [activeToolkits, setActiveToolkits] = useState<string[]>([]);

  // Reset to overview when switching employee
  useEffect(() => {
    setTab("overview");
    setSelectedFile(null);
  }, [employeeId]);

  // Fetch connections
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    fetch(`/api/connections/${employeeId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const active = Object.entries(
          (data.connections ?? {}) as Record<string, { status: string }>
        )
          .filter(([, v]) => v.status === "ACTIVE")
          .map(([k]) => k.toUpperCase());
        setActiveToolkits(active);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  // Fetch file list (from graph endpoint, which includes frontmatter metadata)
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    fetch(`/api/employees/${employeeId}/graph`)
      .then((r) => (r.ok ? r.json() : { nodes: [] }))
      .then((data) => {
        if (cancelled) return;
        setFiles(((data.nodes ?? []) as FileNode[]).slice());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  if (!employee) {
    return (
      <>
        <Topbar crumbs={["Workspace", "Profile"]} />
        <div
          className="scrollbar"
          style={{ overflow: "auto", padding: "32px 40px 60px" }}
        >
          <div
            style={{
              maxWidth: 520,
              margin: "120px auto",
              textAlign: "center",
            }}
          >
            <h1
              style={{
                fontSize: "var(--fs-h2)",
                fontWeight: 600,
                margin: "0 0 12px",
                letterSpacing: "-0.02em",
              }}
            >
              No twin to show here.
            </h1>
            <p
              style={{
                fontSize: "var(--fs-body)",
                color: "var(--text-muted)",
                lineHeight: 1.55,
                margin: "0 0 24px",
              }}
            >
              {empId
                ? "This profile doesn't exist anymore — it may have been revoked or deleted."
                : "You haven't created a twin yet. Start by inviting your first employee."}
            </p>
            <a
              href="/employees"
              className="btn primary"
              style={{ display: "inline-block", padding: "10px 18px" }}
            >
              Go to Employees →
            </a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar crumbs={["Workspace", "Profile", employee.name]} />
      <div className="scrollbar" style={{ overflow: "auto", padding: "32px 40px 60px" }}>
        <PageHead
          icon="User"
          title="Profile"
          subtitle="A twin’s operating manual: expertise, tone, boundaries, preferences, and project context. Use it to review or adjust how the twin should behave."
          style={{ marginBottom: "var(--sp-16)", maxWidth: 880 }}
        />
        {/* Hero (always shown) */}
        <Hero employee={employee} />

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 0,
            marginTop: "var(--sp-24)",
            maxWidth: 880,
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {(["overview", "files", "versions", "danger"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 18px",
                fontSize: "var(--fs-ui)",
                fontWeight: tab === t ? 600 : 500,
                color: tab === t ? "var(--text)" : "var(--text-muted)",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${tab === t ? "var(--text)" : "transparent"}`,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: -1,
                textTransform: "capitalize",
                letterSpacing: "0.005em",
                transition: "all .15s",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ maxWidth: 880, marginTop: "var(--sp-24)" }}>
          <AnimatePresence mode="wait">
            {tab === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <OverviewTab
                  employee={employee}
                  activeToolkits={activeToolkits}
                />
              </motion.div>
            )}
            {tab === "files" && (
              <motion.div
                key="files"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <FilesTab
                  employeeId={employee.id}
                  profileFiles={files}
                  selected={selectedFile}
                  onSelect={setSelectedFile}
                />
              </motion.div>
            )}
            {tab === "versions" && (
              <motion.div
                key="versions"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <VersionsTab employeeId={employee.id} />
              </motion.div>
            )}
            {tab === "danger" && (
              <motion.div
                key="danger"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <DangerTab employee={employee} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

// ─── Danger Tab ───────────────────────────────────────────────────────────────
// The CEO's escape hatch when a twin was created by mistake (typo on the
// invite name, abandoned OAuth that left a `pending-*` shell, marketplace
// hire that turned out useless) or when an employee leaves the company.
// Type-to-confirm gates the destructive action — the CEO has to type the
// twin's exact name before the button enables.

function DangerTab({ employee }: { employee: EmployeeWithTwin }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = confirmText.trim() === employee.name.trim() && !deleting;

  async function deleteTwin() {
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(employee.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Delete failed (${res.status})`);
      }
      // Twin gone — back to the roster.
      router.push("/employees");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-32)" }}>
      <div>
        <h2
          style={{
            fontSize: "var(--fs-h3)",
            fontWeight: 600,
            letterSpacing: "-0.015em",
            margin: "0 0 8px",
            color: "var(--text)",
          }}
        >
          Danger zone
        </h2>
        <p
          className="muted"
          style={{ fontSize: "var(--fs-base)", lineHeight: 1.55, margin: 0 }}
        >
          Use this when a twin was created by mistake or is no longer needed.
          Everything below is permanent — there&apos;s no undo button.
        </p>
      </div>

      <div
        className="card"
        style={{
          padding: "var(--sp-24)",
          border: "1px solid var(--danger)",
          background: "color-mix(in srgb, var(--danger) 4%, transparent)",
        }}
      >
        <div className="row" style={{ gap: "var(--sp-10)", marginBottom: "var(--sp-12)" }}>
          <Icons.Trash size={16} style={{ color: "var(--danger)" }} />
          <span style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--danger)" }}>
            Delete this twin
          </span>
        </div>

        <p
          style={{
            fontSize: "var(--fs-sm)",
            lineHeight: 1.6,
            margin: "0 0 var(--sp-12)",
            color: "var(--text-muted)",
          }}
        >
          This will remove:
        </p>
        <ul
          style={{
            margin: "0 0 var(--sp-16)",
            paddingLeft: "var(--sp-20)",
            fontSize: "var(--fs-sm)",
            lineHeight: 1.7,
            color: "var(--text-muted)",
          }}
        >
          <li>The 9 profile files (<span className="mono">EXPERTISE.md</span>, <span className="mono">DECISIONS.md</span>, etc.) and all version snapshots.</li>
          <li>The Composio connections this twin owns — the underlying SaaS tokens stay with the employee&apos;s own accounts.</li>
          <li>Any scratch notes the twin wrote under <span className="mono">data/scratch/{employee.id}/</span>.</li>
          <li>Routines, scheduled work, and pending approvals scoped to this twin.</li>
        </ul>
        <p
          style={{
            fontSize: "var(--fs-sm)",
            lineHeight: 1.6,
            margin: "0 0 var(--sp-20)",
            color: "var(--text-muted)",
          }}
        >
          The audit log entry for this twin is preserved — the deletion itself is
          recorded with the timestamp and the operator id.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-8)",
            marginBottom: "var(--sp-16)",
          }}
        >
          <label
            htmlFor="confirm-twin-name"
            style={{
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              color: "var(--text)",
            }}
          >
            Type <span className="mono" style={{ color: "var(--danger)" }}>{employee.name}</span> to confirm:
          </label>
          <input
            id="confirm-twin-name"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleting}
            autoComplete="off"
            spellCheck={false}
            style={{
              padding: "10px 12px",
              fontSize: "var(--fs-ui)",
              fontFamily: "var(--font-mono, monospace)",
              background: "var(--bg)",
              border: "1px solid var(--hairline-strong)",
              borderRadius: 4,
              color: "var(--text)",
              outline: "none",
              maxWidth: 360,
            }}
          />
        </div>

        <button
          onClick={deleteTwin}
          disabled={!confirmed}
          style={{
            padding: "10px 20px",
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
            color: confirmed ? "#FFFFFF" : "var(--text-subtle)",
            background: confirmed ? "var(--danger)" : "var(--bg-sunken)",
            border: `1px solid ${confirmed ? "var(--danger)" : "var(--hairline)"}`,
            borderRadius: 6,
            cursor: confirmed ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            transition: "all .15s",
          }}
        >
          {deleting ? "Deleting…" : `Delete ${employee.name} permanently`}
        </button>

        {error && (
          <div
            style={{
              marginTop: "var(--sp-12)",
              padding: "var(--sp-10) var(--sp-12)",
              background: "color-mix(in srgb, var(--danger) 8%, transparent)",
              border: "1px solid var(--danger)",
              borderRadius: 4,
              fontSize: "var(--fs-sm)",
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfilePageContent />
    </Suspense>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero({ employee }: { employee: EmployeeWithTwin }) {
  return (
    <div className="card" style={{ padding: "var(--sp-24)", maxWidth: 880 }}>
      <div
        className="row"
        style={{
          gap: "var(--sp-20)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: employee.avatarColor,
            color: "var(--text)",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: "var(--fs-h3)",
            flexShrink: 0,
          }}
        >
          {employee.initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: "var(--sp-10)", marginBottom: "var(--sp-6)" }}>
            {employee.twinStatus === "ready" && (
              <span className="badge twin">
                <span className="dot success pulse" /> Twin is live
              </span>
            )}
            {employee.twinStatus === "building" && (
              <span className="badge warn">Building</span>
            )}
            {employee.twinStatus === "pending" && (
              <span className="badge">Not started</span>
            )}
          </div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 4px",
            }}
          >
            {employee.name}
          </h1>
          <div className="muted" style={{ fontSize: "var(--fs-ui)" }}>
            {employee.role} · Employee001
          </div>
        </div>
        <div
          className="row"
          style={{
            gap: "var(--sp-8)",
            flexShrink: 0,
            marginLeft: "auto",
          }}
        >
          <Link
            href={`/twin-build?employee=${employee.id}`}
            className="btn"
            style={{ textDecoration: "none" }}
            title={
              employee.profileFilesComplete >= 9
                ? "Re-run the autonomous Twin Builder agent. Will overwrite existing profile files."
                : "Run the autonomous Twin Builder agent to generate profile files from connected systems."
            }
          >
            <Icons.Spark size={12} />{" "}
            {employee.profileFilesComplete >= 9 ? "Rebuild twin" : "Build twin"}
          </Link>
          <Link
            href={`/flow?employee=${employee.id}`}
            className="btn primary"
            style={{ textDecoration: "none" }}
          >
            <Icons.Bot size={12} /> Chat with twin
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Model Picker ─────────────────────────────────────────────────────────────

const BASE_SEED_COST = 44.80;
const BASE_REFRESH_COST = 32.00;

function readStoredModels(): Record<string, { seed: ClaudeModel; refresh: ClaudeModel }> {
  try {
    const raw = localStorage.getItem(MODELS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function ModelPicker({ employee }: { employee: EmployeeWithTwin }) {
  const [seedModel, setSeedModel] = useState<ClaudeModel>(employee.seedModel);
  const [refreshModel, setRefreshModel] = useState<ClaudeModel>(employee.refreshModel);
  const [saved, setSaved] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = readStoredModels();
    if (stored[employee.id]) {
      setSeedModel(stored[employee.id].seed);
      setRefreshModel(stored[employee.id].refresh);
    }
  }, [employee.id]);

  function save() {
    const all = readStoredModels();
    all[employee.id] = { seed: seedModel, refresh: refreshModel };
    localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(all));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const seedMeta   = CLAUDE_MODELS.find((m) => m.id === seedModel)!;
  const refreshMeta = CLAUDE_MODELS.find((m) => m.id === refreshModel)!;
  const estSeed    = (BASE_SEED_COST * seedMeta.seedCostMultiplier).toFixed(2);
  const estRefresh = (BASE_REFRESH_COST * refreshMeta.refreshCostMultiplier).toFixed(2);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Seed model */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-14)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>Seed model</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
              Used once for the 180-day initial data pull · est. <span className="mono">${estSeed}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          {CLAUDE_MODELS.map((m) => {
            const active = seedModel === m.id;
            const cost = (BASE_SEED_COST * m.seedCostMultiplier).toFixed(2);
            return (
              <button
                key={m.id}
                onClick={() => setSeedModel(m.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-12)",
                  padding: "11px 14px",
                  borderRadius: 8,
                  border: `1px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
                  background: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "all .12s",
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `2px solid ${active ? "var(--accent)" : "var(--hairline-strong)"}`,
                    background: active ? "var(--accent)" : "transparent",
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {active && (
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-ui)", fontWeight: active ? 600 : 500, color: active ? "var(--accent-deep)" : "var(--text)" }}>
                    {m.label}
                  </div>
                  <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-1)" }}>{m.sub}</div>
                </div>
                <div className="mono" style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: active ? "var(--accent-deep)" : "var(--text-muted)", flexShrink: 0 }}>
                  ~${cost}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Refresh model */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-14)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>Refresh model</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
              Used every week to keep the twin current · est. <span className="mono">${estRefresh}/mo</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          {CLAUDE_MODELS.map((m) => {
            const active = refreshModel === m.id;
            const cost = (BASE_REFRESH_COST * m.refreshCostMultiplier).toFixed(2);
            return (
              <button
                key={m.id}
                onClick={() => setRefreshModel(m.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-12)",
                  padding: "11px 14px",
                  borderRadius: 8,
                  border: `1px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
                  background: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "all .12s",
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `2px solid ${active ? "var(--accent)" : "var(--hairline-strong)"}`,
                    background: active ? "var(--accent)" : "transparent",
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {active && (
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-ui)", fontWeight: active ? 600 : 500, color: active ? "var(--accent-deep)" : "var(--text)" }}>
                    {m.label}
                  </div>
                  <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-1)" }}>{m.sub}</div>
                </div>
                <div className="mono" style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: active ? "var(--accent-deep)" : "var(--text-muted)", flexShrink: 0 }}>
                  ~${cost}/mo
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: "var(--sp-12)" }}>
        <div className="subtle" style={{ fontSize: "var(--fs-meta)", flex: 1 }}>
          Changes apply to the next seed or refresh run. Prompt caching reduces input costs by ~70%.
        </div>
        {saved && (
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--success)", fontWeight: 500 }}>Saved ✓</span>
        )}
        <button className="btn primary sm" onClick={save}>
          Save changes
        </button>
      </div>
    </div>
  );
}

// ─── VoicePicker ─────────────────────────────────────────────────────────────

type ELVoice = {
  voice_id: string;
  name: string;
  category: string;
  labels?: Record<string, string>;
  preview_url?: string;
};

type GenderFilter = "all" | "male" | "female" | "neutral";

function readStoredVoices(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ELEVENLABS_VOICE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function VoicePicker({ employee }: { employee: EmployeeWithTwin }) {
  const [voiceId, setVoiceId] = useState<string>(employee.ttsVoiceId);
  const [saved, setSaved] = useState(false);
  const [voices, setVoices] = useState<ELVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const stored = readStoredVoices();
    if (stored[employee.id]) setVoiceId(stored[employee.id]);
  }, [employee.id]);

  useEffect(() => {
    fetch("/api/tts/voices")
      .then((r) => r.json())
      .then((d: { voices?: ELVoice[] }) => setVoices(d.voices ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function playPreview(v: ELVoice) {
    if (!v.preview_url) return;
    previewAudioRef.current?.pause();
    if (previewingId === v.voice_id) { setPreviewingId(null); return; }
    const audio = new Audio(v.preview_url);
    previewAudioRef.current = audio;
    setPreviewingId(v.voice_id);
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => setPreviewingId(null);
    audio.play();
  }

  useEffect(() => () => { previewAudioRef.current?.pause(); }, []);

  function save() {
    const all = readStoredVoices();
    all[employee.id] = voiceId;
    localStorage.setItem(ELEVENLABS_VOICE_STORAGE_KEY, JSON.stringify(all));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const filtered = voices.filter((v) => {
    if (genderFilter === "all") return true;
    return v.labels?.gender === genderFilter;
  });

  const GENDER_TABS: { key: GenderFilter; label: string }[] = [
    { key: "all",     label: "All" },
    { key: "male",    label: "♂ Male" },
    { key: "female",  label: "♀ Female" },
    { key: "neutral", label: "⊙ Neutral" },
  ];

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header + gender filter */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, marginBottom: "var(--sp-2)" }}>Twin voice</div>
        <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginBottom: "var(--sp-12)" }}>
          Powered by ElevenLabs · used when clicking &quot;listen&quot; in chat
        </div>
        {/* Gender tabs */}
        <div style={{ display: "flex", gap: "var(--sp-4)" }}>
          {GENDER_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setGenderFilter(t.key)}
              style={{
                padding: "4px 10px", fontSize: "var(--fs-meta)", borderRadius: 5, fontFamily: "inherit",
                border: `1px solid ${genderFilter === t.key ? "var(--accent)" : "var(--hairline)"}`,
                background: genderFilter === t.key ? "var(--accent-soft)" : "transparent",
                color: genderFilter === t.key ? "var(--accent-deep)" : "var(--text-muted)",
                cursor: "pointer", fontWeight: genderFilter === t.key ? 600 : 400,
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Voice list */}
      <div style={{ maxHeight: 340, overflowY: "auto" }} className="scrollbar">
        {loading ? (
          <div style={{ padding: "24px 18px", color: "var(--text-subtle)", fontSize: "var(--fs-sm)", textAlign: "center" }}>
            Loading voices…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "24px 18px", color: "var(--text-subtle)", fontSize: "var(--fs-sm)", textAlign: "center" }}>
            No voices in this category
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {filtered.map((v) => {
              const active = voiceId === v.voice_id;
              const gender = v.labels?.gender ?? "";
              const accent = v.labels?.accent ?? "";
              const descriptive = v.labels?.descriptive ?? v.labels?.use_case ?? "";
              const isPreviewing = previewingId === v.voice_id;

              return (
                <div
                  key={v.voice_id}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--sp-10)",
                    padding: "10px 18px",
                    borderBottom: "1px solid var(--hairline)",
                    background: active ? "var(--accent-soft)" : "transparent",
                    transition: "background .1s",
                  }}
                >
                  {/* Radio */}
                  <button
                    onClick={() => setVoiceId(v.voice_id)}
                    style={{
                      width: 15, height: 15, borderRadius: "50%", flexShrink: 0,
                      border: `2px solid ${active ? "var(--accent)" : "var(--hairline-strong)"}`,
                      background: active ? "var(--accent)" : "transparent",
                      display: "grid", placeItems: "center", cursor: "pointer",
                    }}
                  >
                    {active && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                  </button>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setVoiceId(v.voice_id)}>
                    <div style={{ fontSize: "var(--fs-sm)", fontWeight: active ? 600 : 500, color: active ? "var(--accent-deep)" : "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {v.name}
                    </div>
                    <div style={{ display: "flex", gap: "var(--sp-4)", marginTop: "var(--sp-3)", flexWrap: "wrap" }}>
                      {gender && (
                        <span style={{ fontSize: "var(--fs-2xs)", padding: "1px 5px", borderRadius: 3, background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {gender === "male" ? "♂" : gender === "female" ? "♀" : "⊙"} {gender}
                        </span>
                      )}
                      {accent && (
                        <span style={{ fontSize: "var(--fs-2xs)", padding: "1px 5px", borderRadius: 3, background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--text-muted)" }}>
                          {accent}
                        </span>
                      )}
                      {descriptive && (
                        <span style={{ fontSize: "var(--fs-2xs)", padding: "1px 5px", borderRadius: 3, background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--text-muted)" }}>
                          {descriptive.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Preview play button */}
                  {v.preview_url && (
                    <button
                      onClick={() => playPreview(v)}
                      title={isPreviewing ? "Stop preview" : "Play preview"}
                      style={{
                        width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                        border: `1px solid ${isPreviewing ? "var(--accent)" : "var(--hairline)"}`,
                        background: isPreviewing ? "var(--accent-soft)" : "var(--surface)",
                        color: isPreviewing ? "var(--accent-deep)" : "var(--text-muted)",
                        display: "grid", placeItems: "center", cursor: "pointer",
                      }}
                    >
                      {isPreviewing
                        ? <Icons.VolumeOff size={11} />
                        : <Icons.Volume size={11} />
                      }
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: "var(--sp-12)", borderTop: "1px solid var(--hairline)" }}>
        <div className="subtle" style={{ fontSize: "var(--fs-meta)", flex: 1 }}>
          {voices.length > 0 ? `${voices.length} voices available` : ""}  · Changes take effect immediately in chat.
        </div>
        {saved && <span style={{ fontSize: "var(--fs-sm)", color: "var(--success)", fontWeight: 500 }}>Saved ✓</span>}
        <button className="btn primary sm" onClick={save}>Save changes</button>
      </div>
    </div>
  );
}

// ─── Org Skill Assignment ────────────────────────────────────────────────────

function OrgSkillAssignmentCard({ employee }: { employee: EmployeeWithTwin }) {
  const [skills, setSkills] = useState<OrgSkillPlaybook[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set(employee.orgSkillIds));
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${employee.id}/skills`, {
        cache: "no-store",
      });
      const data = (await res.json()) as EmployeeSkillsPayload;
      setSkills(data.skills ?? []);
      setAssigned(new Set(data.assignedSkillIds ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, [employee.id]);

  useEffect(() => {
    const id = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(id);
  }, [load]);

  async function toggle(skillId: string) {
    const next = new Set(assigned);
    if (next.has(skillId)) next.delete(skillId);
    else next.add(skillId);

    setAssigned(next);
    setSavingId(skillId);
    setError(null);

    try {
      const res = await fetch(`/api/employees/${employee.id}/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillIds: Array.from(next) }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setAssigned(new Set(assigned));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>Assigned org skills</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
              Playbooks this twin can use at runtime. Manage the library in{" "}
              <Link href="/settings" style={{ color: "var(--accent-deep)" }}>
                Settings
              </Link>
              .
            </div>
          </div>
          <span className="badge twin" style={{ fontSize: "var(--fs-xs)" }}>
            {assigned.size} assigned
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            margin: "var(--sp-12)",
            padding: "var(--sp-10)",
            fontSize: "var(--fs-sm)",
            background: "rgba(220, 80, 60, 0.08)",
            color: "var(--danger)",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "22px 18px", fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
          Loading skills…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {skills.map((skill) => {
            const active = assigned.has(skill.id);
            return (
              <button
                key={skill.id}
                onClick={() => toggle(skill.id)}
                disabled={savingId !== null}
                style={{
                  display: "flex",
                  gap: "var(--sp-12)",
                  padding: "13px 18px",
                  border: "none",
                  borderBottom: "1px solid var(--hairline)",
                  background: active ? "var(--twin-soft)" : "transparent",
                  color: "var(--text)",
                  cursor: savingId === null ? "pointer" : "wait",
                  textAlign: "left",
                  fontFamily: "inherit",
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    border: `1.5px solid ${active ? "var(--twin)" : "var(--hairline-strong)"}`,
                    background: active ? "var(--twin)" : "transparent",
                    color: "var(--bg)",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    marginTop: "var(--sp-1)",
                  }}
                >
                  {active && <Icons.Check size={11} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>{skill.label}</div>
                  <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)", lineHeight: 1.4 }}>
                    {skill.description}
                  </div>
                  <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", marginTop: "var(--sp-7)" }}>
                    {skill.triggers.slice(0, 5).map((trigger) => (
                      <span
                        key={trigger}
                        className="mono"
                        style={{
                          fontSize: "var(--fs-2xs)",
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: "var(--surface)",
                          border: "1px solid var(--hairline)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {trigger}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  employee,
  activeToolkits,
}: {
  employee: EmployeeWithTwin;
  activeToolkits: string[];
}) {
  const [domains, setDomains] = useState<string[]>([]);
  const [boundaries, setBoundaries] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load(name: string): Promise<string> {
      try {
        const r = await fetch(`/api/employees/${employee.id}/file/${name}`);
        if (!r.ok) return "";
        const data = (await r.json()) as { body?: string };
        return data.body ?? "";
      } catch {
        return "";
      }
    }
    Promise.all([load("EXPERTISE.md"), load("BOUNDARIES.md")]).then(
      ([expertise, bounds]) => {
        if (cancelled) return;
        setDomains(extractBullets(expertise, 8));
        setBoundaries(extractBullets(bounds, 6));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-56)" }}>
      <SectionGroup
        title="Identity & voice"
        subhead="What this twin sounds like, what it speaks to with confidence, and where it stays silent."
        divider={false}
      >
        {employee.twinStatus === "ready" ? (
          <div>
            <SectionTitle>Sample voice</SectionTitle>
            <div
              className="card"
              style={{
                padding: "var(--sp-20)",
                background: "var(--twin-soft)",
                borderColor: "var(--twin)",
              }}
            >
              <div className="row" style={{ gap: "var(--sp-10)", marginBottom: "var(--sp-10)" }}>
                <Icons.Bot size={14} style={{ color: "var(--twin)" }} />
                <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--twin)" }}>
                  Twin reply preview
                </span>
                <div className="spacer" />
                <span className="subtle mono" style={{ fontSize: "var(--fs-meta)" }}>
                  Ask the twin a question at <Link href={`/flow?employee=${employee.id}`} style={{ color: "var(--twin)" }}>/flow</Link>
                </span>
              </div>
              <p style={{ fontSize: "var(--fs-base)", lineHeight: 1.6, margin: 0, color: "var(--text-muted)" }}>
                Sample replies appear here after the twin is trained and you&apos;ve had your first conversation. The voice is shaped by <span className="mono">TONE.md</span>, <span className="mono">EXPERTISE.md</span>, and <span className="mono">CONTEXT.md</span>.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <SectionTitle>Sample voice</SectionTitle>
            <div
              className="card"
              style={{
                padding: "var(--sp-20)",
                background: "var(--bg-elevated)",
              }}
            >
              <p style={{ fontSize: "var(--fs-base)", lineHeight: 1.6, margin: 0, color: "var(--text-muted)" }}>
                No replies to preview yet — the twin hasn&apos;t been trained.{" "}
                <Link href={`/twin-build?employee=${employee.id}`} style={{ color: "var(--accent)" }}>
                  Start training
                </Link>{" "}
                to generate the 9 profile files that define the twin&apos;s voice.
              </p>
            </div>
          </div>
        )}

        <div>
          <SectionTitle>Voice</SectionTitle>
          <VoicePicker employee={employee} />
        </div>

        <div>
          <SectionTitle>Authoritative domains</SectionTitle>
          <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: "0 0 14px", lineHeight: 1.5 }}>
            The twin will answer with high confidence on these topics. Outside this
            list, it defers or escalates.
          </p>
          {domains.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, fontStyle: "italic" }}>
              No domains parsed from <span className="mono">EXPERTISE.md</span> yet —
              add bullets to that file to populate this list.
            </p>
          ) : (
            <div className="row" style={{ flexWrap: "wrap", gap: "var(--sp-8)" }}>
              {domains.map((d) => (
                <Chip key={d}>{d}</Chip>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionTitle>Boundaries</SectionTitle>
          <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: "0 0 14px", lineHeight: 1.5 }}>
            Topics the twin will never answer alone. These always escalate to you.
          </p>
          {boundaries.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, fontStyle: "italic" }}>
              No boundaries parsed from <span className="mono">BOUNDARIES.md</span> yet —
              add bullets to that file to populate this list.
            </p>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {boundaries.map((b, i) => (
                <div
                  key={b}
                  className="row"
                  style={{
                    padding: "12px 16px",
                    gap: "var(--sp-12)",
                    borderBottom:
                      i < boundaries.length - 1 ? "1px solid var(--hairline)" : "none",
                  }}
                >
                  <Icons.Lock size={13} style={{ color: "var(--text-subtle)" }} />
                  <span style={{ fontSize: "var(--fs-ui)" }}>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionGroup>

      <SectionGroup
        title="Knowledge & sources"
        subhead="Where the twin's expertise comes from — live tools, training data, and assigned skills."
      >
        <div>
          <SectionTitle>Connected sources</SectionTitle>
          {activeToolkits.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0 }}>
              No active connections yet.{" "}
              <Link href={`/connections/${employee.id}`} style={{ color: "var(--text)" }}>
                Connect tools →
              </Link>
            </p>
          ) : (
            <div className="row" style={{ flexWrap: "wrap", gap: "var(--sp-10)" }}>
              {activeToolkits.map((slug) => {
                const label = slug.charAt(0) + slug.slice(1).toLowerCase();
                return (
                  <span
                    key={slug}
                    className="row"
                    style={{
                      gap: "var(--sp-8)",
                      padding: "6px 12px 6px 8px",
                      background: "var(--surface)",
                      border: "1px solid var(--hairline)",
                      borderRadius: 999,
                      fontSize: "var(--fs-sm)",
                      fontWeight: 500,
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

        <div>
          <SectionTitle>Trained on</SectionTitle>
          <LineageCard employee={employee} />
        </div>

        <div>
          <SectionTitle>Org skills</SectionTitle>
          <OrgSkillAssignmentCard employee={employee} />
        </div>
      </SectionGroup>

      <SectionGroup
        title="Trust & configuration"
        subhead="The operating contract you control: consent on file and the model that powers this twin."
      >
        <div>
          <SectionTitle>Consent</SectionTitle>
          <ConsentCard employee={employee} />
        </div>

        <div>
          <SectionTitle>Training model</SectionTitle>
          <ModelPicker employee={employee} />
        </div>
      </SectionGroup>
    </div>
  );
}

// ─── Files Tab (split-pane editor) ────────────────────────────────────────────
// LEFT: a two-group file tree — profile/ (the 9 base files) and knowledge/
// (CEO-uploaded enrichment files). RIGHT: the TwinEditor, editing the selected
// file's markdown. profile/ files load/save via /api/employees/<id>/file/<name>;
// knowledge/ files via /api/employees/<id>/knowledge/<name>.

function FilesTab({
  employeeId,
  profileFiles,
  selected,
  onSelect,
}: {
  employeeId: string;
  profileFiles: FileNode[];
  selected: SelectedFile | null;
  onSelect: (sel: SelectedFile) => void;
}) {
  const [knowledge, setKnowledge] = useState<KnowledgeFileMeta[]>([]);

  const loadKnowledge = useCallback(async () => {
    try {
      const r = await fetch(`/api/employees/${employeeId}/knowledge`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as { files?: KnowledgeFileMeta[] };
      setKnowledge(data.files ?? []);
    } catch {
      /* leave list as-is on transient error */
    }
  }, [employeeId]);

  useEffect(() => {
    void loadKnowledge();
  }, [loadKnowledge]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 280px) 1fr",
        gap: "var(--sp-16)",
        alignItems: "start",
      }}
    >
      <FileTreePane
        employeeId={employeeId}
        profileFiles={profileFiles}
        knowledge={knowledge}
        selected={selected}
        onSelect={onSelect}
        onKnowledgeChanged={loadKnowledge}
      />
      <FileEditorPane
        employeeId={employeeId}
        selected={selected}
        onKnowledgeChanged={loadKnowledge}
      />
    </div>
  );
}

// ─── File tree (left pane) ────────────────────────────────────────────────────

function FileTreePane({
  employeeId,
  profileFiles,
  knowledge,
  selected,
  onSelect,
  onKnowledgeChanged,
}: {
  employeeId: string;
  profileFiles: FileNode[];
  knowledge: KnowledgeFileMeta[];
  selected: SelectedFile | null;
  onSelect: (sel: SelectedFile) => void;
  onKnowledgeChanged: () => void | Promise<void>;
}) {
  const [profileOpen, setProfileOpen] = useState(true);
  const [knowledgeOpen, setKnowledgeOpen] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const items = Array.from(fileList);
      if (items.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of items) {
          const fd = new FormData();
          fd.append("file", file);
          const r = await fetch(`/api/employees/${employeeId}/knowledge`, {
            method: "POST",
            body: fd,
          });
          if (!r.ok) {
            const data = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? `Upload failed (${r.status})`);
          }
        }
        await onKnowledgeChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [employeeId, onKnowledgeChanged]
  );

  async function createFile() {
    const raw = window.prompt("New knowledge file name (must end in .md):", "notes.md");
    if (!raw) return;
    const name = raw.trim().toLowerCase().endsWith(".md") ? raw.trim() : `${raw.trim()}.md`;
    setError(null);
    try {
      const r = await fetch(`/api/employees/${employeeId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body: "" }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        file?: KnowledgeFileMeta;
        error?: string;
      };
      if (!r.ok || !data.file) throw new Error(data.error ?? "Could not create file");
      await onKnowledgeChanged();
      onSelect({ group: "knowledge", name: data.file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create file");
    }
  }

  async function deleteFile(name: string) {
    if (!window.confirm(`Delete ${name}? This permanently removes it from the twin's knowledge.`)) return;
    setError(null);
    try {
      const r = await fetch(
        `/api/employees/${employeeId}/knowledge/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${r.status})`);
      }
      await onKnowledgeChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const isSelected = (group: FileGroup, name: string) =>
    selected?.group === group && selected.name === name;

  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-10) var(--sp-8)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--hairline)",
        fontFamily: "var(--font-mono, monospace)",
        position: "sticky",
        top: 0,
      }}
    >
      {/* ── profile/ group ── */}
      <button
        onClick={() => setProfileOpen((v) => !v)}
        style={folderRowStyle}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-soft)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <motion.span
          animate={{ rotate: profileOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ display: "inline-flex", color: "var(--text-muted)" }}
        >
          <Icons.Chevron size={11} />
        </motion.span>
        <Icons.Doc size={13} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>profile/</span>
        <div style={{ flex: 1 }} />
        <span className="subtle" style={{ fontSize: "var(--fs-xs)", fontWeight: 400 }}>
          {profileFiles.length}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {profileOpen && (
          <motion.div
            key="profile-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ overflow: "hidden", marginLeft: 12, borderLeft: "1px solid var(--hairline)" }}
          >
            {profileFiles.length === 0 ? (
              <div className="subtle" style={{ fontSize: "var(--fs-xs)", padding: "6px 8px 6px 16px", fontFamily: "var(--font-sans, sans-serif)" }}>
                No profile files yet — run the twin builder.
              </div>
            ) : (
              profileFiles.map((f) => (
                <FileTreeRow
                  key={f.name}
                  name={f.name}
                  tokens={f.tokens}
                  active={isSelected("profile", f.name)}
                  hovered={hovered === `profile:${f.name}`}
                  title={PROFILE_FILE_DESCRIPTIONS[f.name] ?? ""}
                  onHover={(h) => setHovered(h ? `profile:${f.name}` : null)}
                  onClick={() => onSelect({ group: "profile", name: f.name })}
                />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── knowledge/ group ── */}
      <button
        onClick={() => setKnowledgeOpen((v) => !v)}
        style={{ ...folderRowStyle, marginTop: "var(--sp-6)" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-soft)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <motion.span
          animate={{ rotate: knowledgeOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ display: "inline-flex", color: "var(--text-muted)" }}
        >
          <Icons.Chevron size={11} />
        </motion.span>
        <Icons.Doc size={13} style={{ color: "var(--twin)" }} />
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>knowledge/</span>
        <div style={{ flex: 1 }} />
        <span className="subtle" style={{ fontSize: "var(--fs-xs)", fontWeight: 400 }}>
          {knowledge.length}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {knowledgeOpen && (
          <motion.div
            key="knowledge-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ overflow: "hidden", marginLeft: 12, borderLeft: "1px solid var(--hairline)" }}
          >
            {knowledge.map((f) => (
              <FileTreeRow
                key={f.name}
                name={f.name}
                tokens={f.tokens}
                active={isSelected("knowledge", f.name)}
                hovered={hovered === `knowledge:${f.name}`}
                onHover={(h) => setHovered(h ? `knowledge:${f.name}` : null)}
                onClick={() => onSelect({ group: "knowledge", name: f.name })}
                onDelete={() => deleteFile(f.name)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload + new-file controls (drag-and-drop zone is the whole footer) */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
        }}
        style={{
          marginTop: "var(--sp-10)",
          padding: "var(--sp-10)",
          borderRadius: 6,
          border: `1px dashed ${dragOver ? "var(--accent)" : "var(--hairline-strong)"}`,
          background: dragOver ? "var(--accent-soft)" : "transparent",
          transition: "all .12s",
          fontFamily: "var(--font-sans, sans-serif)",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={KNOWLEDGE_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="subtle" style={{ fontSize: "var(--fs-2xs)", textAlign: "center", marginBottom: "var(--sp-8)", lineHeight: 1.4 }}>
          {dragOver ? "Drop to upload" : "Drag files here, or"}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-6)" }}>
          <button
            className="btn sm"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Icons.Plus size={11} /> {uploading ? "Uploading…" : "Upload"}
          </button>
          <button
            className="btn sm"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={createFile}
            disabled={uploading}
          >
            <Icons.Plus size={11} /> New file
          </button>
        </div>
        <div className="subtle" style={{ fontSize: "var(--fs-2xs)", textAlign: "center", marginTop: "var(--sp-6)", lineHeight: 1.4 }}>
          .md, .txt, .csv, .json · PDF/DOCX coming soon
        </div>
        {error && (
          <div style={{ fontSize: "var(--fs-2xs)", color: "var(--danger)", marginTop: "var(--sp-6)", textAlign: "center" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const folderRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-8)",
  width: "100%",
  padding: "6px 8px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--text)",
  borderRadius: 4,
  transition: "background .12s",
};

function FileTreeRow({
  name,
  tokens,
  active,
  hovered,
  title,
  onHover,
  onClick,
  onDelete,
}: {
  name: string;
  tokens: number;
  active: boolean;
  hovered: boolean;
  title?: string;
  onHover: (hovering: boolean) => void;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-6)",
        marginLeft: 8,
        background: active
          ? "var(--accent-soft)"
          : hovered
          ? "var(--surface-soft)"
          : "transparent",
        borderRadius: 4,
        transition: "background .1s",
      }}
    >
      <button
        onClick={onClick}
        title={title}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
          flex: 1,
          minWidth: 0,
          padding: "5px 4px 5px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          color: active ? "var(--accent-deep)" : hovered ? "var(--text)" : "var(--text-muted)",
          textAlign: "left",
        }}
      >
        <Icons.Doc
          size={12}
          style={{ color: active ? "var(--accent-deep)" : "var(--text-subtle)", flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: "var(--fs-sm)",
            fontWeight: active ? 600 : 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        <div style={{ flex: 1, minWidth: 4 }} />
        <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)", flexShrink: 0 }}>
          ~{tokens.toLocaleString()}
        </span>
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          title={`Delete ${name}`}
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            marginRight: 4,
            flexShrink: 0,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            color: hovered ? "var(--danger)" : "var(--text-subtle)",
            opacity: hovered ? 1 : 0.4,
            transition: "opacity .1s, color .1s",
          }}
        >
          <Icons.Trash size={11} />
        </button>
      )}
    </div>
  );
}

// ─── File editor (right pane) ─────────────────────────────────────────────────

function FileEditorPane({
  employeeId,
  selected,
  onKnowledgeChanged,
}: {
  employeeId: string;
  selected: SelectedFile | null;
  onKnowledgeChanged: () => void | Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState("");

  const fileUrl = useCallback(
    (sel: SelectedFile) =>
      sel.group === "profile"
        ? `/api/employees/${employeeId}/file/${encodeURIComponent(sel.name)}`
        : `/api/employees/${employeeId}/knowledge/${encodeURIComponent(sel.name)}`,
    [employeeId]
  );

  // Load the selected file's body. Both APIs return { body, ... }.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSavedAt(null);
    fetch(fileUrl(selected))
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { body?: string };
      })
      .then((data) => {
        if (cancelled) return;
        setBody(data.body ?? "");
        setOriginal(data.body ?? "");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selected, fileUrl]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch(fileUrl(selected), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
        throw new Error(
          data.code === "disk_write_failed"
            ? "Couldn't write to disk — the data directory may be read-only or full."
            : data.error ?? `Save failed (${r.status})`
        );
      }
      setOriginal(body);
      setSavedAt(Date.now());
      // A knowledge file's token count / mtime may have changed — refresh the tree.
      if (selected.group === "knowledge") await onKnowledgeChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!selected) {
    return (
      <div
        className="card"
        style={{
          padding: "48px var(--sp-24)",
          background: "var(--bg-elevated)",
          textAlign: "center",
          minHeight: 420,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div>
          <Icons.Doc size={22} style={{ color: "var(--text-subtle)", marginBottom: "var(--sp-10)" }} />
          <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, lineHeight: 1.55 }}>
            Select a file on the left to view and edit it. Profile files shape the
            twin&apos;s voice; knowledge files enrich what it knows.
          </p>
        </div>
      </div>
    );
  }

  const dirty = body !== original;

  return (
    <div
      className="card"
      style={{ padding: 0, background: "var(--bg-elevated)", overflow: "hidden" }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-10)",
          padding: "12px 16px",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <Icons.Doc size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
          {selected.group}/{selected.name}
        </span>
        <div style={{ flex: 1 }} />
        {dirty && (
          <span
            aria-label="Unsaved changes"
            title="Unsaved changes"
            style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--warn)", flexShrink: 0 }}
          />
        )}
        {!dirty && savedAt && (
          <span style={{ fontSize: "var(--fs-meta)", color: "var(--success)" }}>Saved</span>
        )}
        <button
          onClick={save}
          className="btn primary sm"
          style={{ height: 28 }}
          disabled={saving || !dirty || loading}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Ownership note */}
      <div
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--hairline)",
          fontSize: "var(--fs-meta)",
          color: "var(--text-subtle)",
          background: "var(--bg-sunken)",
          lineHeight: 1.45,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-6)",
        }}
      >
        {selected.group === "profile" ? (
          <>
            <Icons.Spark size={11} style={{ color: "var(--warn)", flexShrink: 0 }} />
            A base profile file — the Twin Builder may overwrite it on the next rebuild.
          </>
        ) : (
          <>
            <Icons.Lock size={11} style={{ color: "var(--twin)", flexShrink: 0 }} />
            CEO-owned knowledge — the twin reads this but never overwrites it.
          </>
        )}
      </div>

      {error && (
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--danger)", padding: "10px 16px", borderBottom: "1px solid var(--hairline)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ fontSize: "var(--fs-ui)", padding: "24px 16px", margin: 0 }}>
          Loading…
        </p>
      ) : (
        <div style={{ padding: "var(--sp-8)" }}>
          <TwinEditor
            key={`${selected.group}:${selected.name}`}
            value={original}
            onChange={setBody}
            placeholder="Start writing…"
          />
        </div>
      )}
    </div>
  );
}

// ─── Versions Tab ────────────────────────────────────────────────────────────

type BuildSummary = {
  buildId: string;
  version: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  modelUsed: string;
  costUsd: number;
  turns: number;
  stoppedReason: string;
  ceoContext?: string;
  activeToolkits: string[];
  files: Array<{
    filename: string;
    snapshotTs: string;
    sizeBytes: number;
    written: boolean;
  }>;
};

function VersionsTab({ employeeId }: { employeeId: string }) {
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBuildId, setOpenBuildId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{
    buildId: string;
    filename: string;
    snapshotTs: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadBuilds = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/employees/${employeeId}/versions/builds`, {
        cache: "no-store",
      });
      const data = (await r.json()) as { builds: BuildSummary[] };
      setBuilds(data.builds ?? []);
    } catch {
      setBuilds([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    loadBuilds();
  }, [loadBuilds]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  async function previewVersion(
    buildId: string,
    filename: string,
    snapshotTs: string
  ) {
    setBusy(`preview:${snapshotTs}`);
    try {
      const r = await fetch(
        `/api/employees/${employeeId}/versions/file/${filename}/${snapshotTs}`
      );
      const data = (await r.json()) as { body?: string; error?: string };
      if (!r.ok || typeof data.body !== "string") {
        throw new Error(data.error ?? "could not load version");
      }
      setPreviewing({ buildId, filename, snapshotTs, body: data.body });
    } catch (err) {
      showToast(`Preview failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function restoreOneFile(filename: string, snapshotTs: string) {
    if (!confirm(`Restore ${filename} to this version? Current ${filename} will be saved as a new version automatically.`)) return;
    setBusy(`restore:${filename}:${snapshotTs}`);
    try {
      const r = await fetch(
        `/api/employees/${employeeId}/versions/restore-file`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, ts: snapshotTs }),
        }
      );
      const data = (await r.json()) as { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "restore failed");
      showToast(`${filename} restored. Current state saved as a new version.`);
      await loadBuilds();
    } catch (err) {
      showToast(`Restore failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function restoreEntireBuild(buildId: string, version: number) {
    if (
      !confirm(
        `Restore the entire twin to version v${version}? All 9 files will be replaced. The current state will be saved as a new version automatically.`
      )
    )
      return;
    setBusy(`restoreBuild:${buildId}`);
    try {
      const r = await fetch(
        `/api/employees/${employeeId}/versions/restore-build`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buildId }),
        }
      );
      const data = (await r.json()) as { ok?: boolean; error?: string; restored?: string[] };
      if (!data.ok) throw new Error(data.error ?? "restore failed");
      showToast(
        `Twin restored to v${version} — ${data.restored?.length ?? 0} files replaced.`
      );
      await loadBuilds();
    } catch (err) {
      showToast(`Restore failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-ui)", padding: "24px 0" }}>
        Loading version history…
      </div>
    );
  }

  if (builds.length === 0) {
    return (
      <div className="card" style={{ padding: "var(--sp-24)", maxWidth: 720 }}>
        <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, margin: "0 0 6px" }}>
          No twin versions yet
        </h2>
        <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: "0 0 14px", lineHeight: 1.55 }}>
          Each Twin Builder run becomes a version on this timeline. You'll be
          able to compare versions, restore any past version, or cherry-pick
          individual files across builds.
        </p>
        <Link
          href={`/twin-build?employee=${employeeId}`}
          className="btn primary"
          style={{ textDecoration: "none" }}
        >
          <Icons.Spark size={12} /> Build the first version
        </Link>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            padding: "10px 14px",
            background: "var(--surface)",
            border: "1px solid var(--hairline-strong)",
            borderRadius: 6,
            fontSize: "var(--fs-sm)",
            zIndex: 50,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
        >
          {toast}
        </div>
      )}

      <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: "0 0 18px", lineHeight: 1.55, maxWidth: 680 }}>
        Each row is a complete twin snapshot from one Twin Builder run. Expand
        any version to see the 9 files at that point. Restore individual files
        to mix-and-match the best output across builds, or restore an entire
        version to switch the live twin.
      </p>

      {builds.map((b) => {
        const isOpen = openBuildId === b.buildId;
        const finished = new Date(b.finishedAt);
        const writtenCount = b.files.filter((f) => f.written).length;
        return (
          <div
            key={b.buildId}
            className="card"
            style={{ padding: 0, marginBottom: "var(--sp-12)", overflow: "hidden" }}
          >
            <button
              onClick={() => setOpenBuildId(isOpen ? null : b.buildId)}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "14px 18px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-14)",
                fontFamily: "inherit",
                color: "var(--text)",
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: "var(--fs-ui)",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  background: "var(--accent-soft)",
                  color: "var(--accent-deep)",
                  padding: "3px 9px",
                  borderRadius: 4,
                  minWidth: 38,
                  textAlign: "center",
                }}
              >
                v{b.version}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: "var(--sp-10)", alignItems: "baseline" }}>
                  <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
                    {finished.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="subtle mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {b.modelUsed}
                  </span>
                  {b.stoppedReason !== "natural" && (
                    <span
                      className="badge"
                      style={{ fontSize: "var(--fs-2xs)", background: "var(--bg-sunken)" }}
                    >
                      {b.stoppedReason}
                    </span>
                  )}
                </div>
                <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-3)" }}>
                  {writtenCount} file{writtenCount === 1 ? "" : "s"} rewritten ·{" "}
                  {b.turns} turn{b.turns === 1 ? "" : "s"} · ${b.costUsd.toFixed(3)} ·{" "}
                  {Math.round(b.durationMs / 1000)}s
                  {b.activeToolkits.length > 0 ? (
                    <> · sources: {b.activeToolkits.join(", ")}</>
                  ) : null}
                </div>
              </div>
              <Icons.Chevron
                size={14}
                style={{
                  transform: isOpen ? "rotate(90deg)" : "none",
                  transition: "transform .15s",
                  color: "var(--text-subtle)",
                }}
              />
            </button>

            {isOpen && (
              <div
                style={{
                  borderTop: "1px solid var(--hairline)",
                  padding: "14px 18px 16px",
                  background: "var(--bg-sunken)",
                }}
              >
                <div
                  className="row"
                  style={{ marginBottom: "var(--sp-12)", gap: "var(--sp-10)", alignItems: "center" }}
                >
                  <button
                    className="btn primary"
                    onClick={() => restoreEntireBuild(b.buildId, b.version)}
                    disabled={busy === `restoreBuild:${b.buildId}`}
                  >
                    <Icons.Refresh size={11} />{" "}
                    {busy === `restoreBuild:${b.buildId}`
                      ? "Restoring…"
                      : `Restore entire v${b.version}`}
                  </button>
                  {b.ceoContext && (
                    <span
                      className="subtle"
                      style={{ fontSize: "var(--fs-meta)", fontStyle: "italic" }}
                    >
                      “{b.ceoContext.slice(0, 120)}{b.ceoContext.length > 120 ? "…" : ""}”
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "var(--sp-8)",
                  }}
                >
                  {b.files.map((f) => (
                    <div
                      key={f.filename}
                      style={{
                        padding: "10px 12px",
                        background: "var(--surface)",
                        border: "1px solid var(--hairline)",
                        borderRadius: 5,
                        fontSize: 11.5,
                      }}
                    >
                      <div className="row" style={{ gap: "var(--sp-6)", alignItems: "baseline" }}>
                        <span
                          className="mono"
                          style={{ fontSize: 11.5, fontWeight: 600, flex: 1, minWidth: 0 }}
                        >
                          {f.filename}
                        </span>
                        {f.written && (
                          <span
                            className="badge"
                            style={{
                              fontSize: "var(--fs-2xs)",
                              background: "var(--accent-soft)",
                              color: "var(--accent-deep)",
                            }}
                          >
                            new
                          </span>
                        )}
                      </div>
                      <div className="subtle" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-3)" }}>
                        {(f.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                      <div className="row" style={{ gap: "var(--sp-6)", marginTop: "var(--sp-8)" }}>
                        <button
                          className="btn"
                          style={{ fontSize: "var(--fs-xs)", padding: "3px 8px" }}
                          onClick={() =>
                            previewVersion(b.buildId, f.filename, f.snapshotTs)
                          }
                          disabled={busy === `preview:${f.snapshotTs}`}
                        >
                          <Icons.Eye size={10} /> Preview
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: "var(--fs-xs)", padding: "3px 8px" }}
                          onClick={() => restoreOneFile(f.filename, f.snapshotTs)}
                          disabled={busy === `restore:${f.filename}:${f.snapshotTs}`}
                        >
                          <Icons.Refresh size={10} /> Restore file
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {previewing && (
        <div
          onClick={() => setPreviewing(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--sp-20)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: "min(820px, 100%)",
              maxHeight: "90vh",
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-elevated)",
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--hairline)",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-10)",
              }}
            >
              <span className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}>
                {previewing.filename}
              </span>
              <span
                className="subtle mono"
                style={{ fontSize: "var(--fs-xs)" }}
              >
                snapshot {previewing.snapshotTs}
              </span>
              <div className="spacer" />
              <button
                className="btn"
                onClick={() =>
                  restoreOneFile(previewing.filename, previewing.snapshotTs)
                }
              >
                <Icons.Refresh size={11} /> Restore this file
              </button>
              <button className="btn" onClick={() => setPreviewing(null)}>
                <Icons.X size={11} /> Close
              </button>
            </div>
            <div
              className="scrollbar"
              style={{ overflow: "auto", padding: "20px 24px" }}
            >
              <Markdown>{previewing.body}</Markdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
