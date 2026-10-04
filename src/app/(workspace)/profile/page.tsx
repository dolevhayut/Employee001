"use client";

import Link from "next/link";
import { KnowledgeProposalsPanel } from "@/components/ex/knowledge-proposals-panel";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icons } from "@/components/ex/icons";
import { useOrgName } from "@/components/ex/use-org-name";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { Topbar } from "@/components/ex/shell";
import { Markdown } from "@/components/ex/markdown";
import { PageHead } from "@/components/ex/page-head";
import { useT } from "@/components/ex/i18n-context";
import { TwinEditor } from "@/components/editor/TwinEditor";
import {
  EMPLOYEES_WITH_TWIN,
  CLAUDE_MODELS,
  ELEVENLABS_VOICE_STORAGE_KEY,
  type EmployeeWithTwin,
  type ClaudeModel,
} from "@/lib/employees";
import type { OrgSkillPlaybook } from "@/lib/org-skills";
import { DIFF_TOO_LARGE_TEXT, diffLines, isCollapsedUnchanged } from "@/lib/text-diff";
import { formatDateTime, formatRelativeTime } from "@/lib/i18n/format";

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

type KnowledgeVersionRow = {
  ts: string;
  name: string;
  sizeBytes: number;
  source: string;
};

// Which group the currently-selected file lives in. "profile" files are the
// 9 base files (twin-builder may overwrite them); "knowledge" files are
// CEO-owned enrichment files that are never overwritten.
type FileGroup = "profile" | "knowledge";

type SelectedFile = { group: FileGroup; name: string };

// Extensions the knowledge upload picker accepts — text only (agent-readable).
const KNOWLEDGE_ACCEPT = ".md,.markdown,.txt,.csv,.json";
const KNOWLEDGE_TEXT_EXT_LIST = [".md", ".markdown", ".txt", ".csv", ".json"];

function isKnowledgeTextName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return KNOWLEDGE_TEXT_EXT_LIST.includes(ext);
}

function formatSnapshotTime(ts: string, locale: "en" | "he"): string {
  const match = /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(ts);
  if (!match) return ts;
  const date = new Date(`${match[1]}${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  if (Number.isNaN(date.getTime())) return ts;
  return formatDateTime(date, locale);
}

function formatSnapshotSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

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
  const { t, locale } = useT();
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
              {t("profile.consent.missing")}
            </div>
            <div className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-3)", lineHeight: 1.5 }}>
              {t("profile.consent.missingDesc", { name: firstName })}
            </div>
          </div>
          <Link
            href={`/onboarding?employee=${employee.id}`}
            className="btn sm"
            style={{ textDecoration: "none", whiteSpace: "nowrap" }}
          >
            {t("profile.consent.request")}
          </Link>
        </div>
      </div>
    );
  }

  const grantedDate = new Date(consent.grantedAt);
  const dateLabel = formatDateTime(grantedDate, locale);

  return (
    <div className="card" style={{ padding: "var(--sp-16)" }}>
      <div className="row" style={{ gap: "var(--sp-10)", alignItems: "center", marginBottom: "var(--sp-12)" }}>
        <Icons.Check size={14} style={{ color: "var(--success)" }} />
        <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
          {t("profile.consent.granted", { date: dateLabel })}
        </div>
        <span className="badge mono" style={{ fontSize: "var(--fs-xs)" }}>
          <bdi>v{consent.version}</bdi>
        </span>
        <div className="spacer" />
        <button
          className="btn sm ghost"
          style={{ color: "var(--danger)" }}
          title={t("profile.consent.revokeTitle")}
        >
          {t("profile.consent.revoke")}
        </button>
      </div>
      <div
        className="subtle"
        style={{ fontSize: "var(--fs-meta)", lineHeight: 1.5, marginBottom: "var(--sp-8)" }}
      >
        {t("profile.consent.scopes", { name: firstName })}
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
  const { t, locale } = useT();
  const lineage = employee.lineage;
  // Snapshot "now" once for this card's life — the window is measured in months,
  // so a per-render clock read would only be render-impure without changing what
  // the user sees.
  const [nowMs] = useState(() => Date.now());

  if (!lineage || lineage.sources.length === 0) {
    return (
      <div className="card" style={{ padding: "var(--sp-16)" }}>
        <div className="subtle" style={{ fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>
          {t("profile.lineage.none", { name: employee.name.split(" ")[0] })}
        </div>
      </div>
    );
  }

  const totalItems = lineage.sources.reduce((sum, s) => sum + s.count, 0);
  const tokensM = (lineage.totalTokens / 1_000_000).toFixed(2);
  const lastSync = new Date(lineage.lastSyncAt);
  const lastSyncRel = formatRelativeTime(lastSync, locale);
  const earliest = lineage.sources.reduce(
    (min, s) => (s.fromDate < min ? s.fromDate : min),
    lineage.sources[0].fromDate
  );
  const windowMonths = Math.round(
    (nowMs - new Date(earliest).getTime()) / (1000 * 60 * 60 * 24 * 30)
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
        <Stat label={t("profile.lineage.items")} value={totalItems.toLocaleString(locale === "he" ? "he-IL" : "en-US")} />
        <Stat label={t("profile.lineage.tokens")} value={`${tokensM}M`} />
        <Stat label={t("profile.lineage.window")} value={t("profile.lineage.months", { count: windowMonths })} />
        <Stat label={t("profile.lineage.lastSync")} value={lastSyncRel} />
        <div className="spacer" />
        <button
          className="btn sm ghost"
          title={t("profile.lineage.resyncTitle")}
          style={{ alignSelf: "center" }}
        >
          <Icons.Refresh size={11} /> {t("profile.lineage.resync")}
        </button>
      </div>

      {/* Per-source breakdown */}
      <div>
        {lineage.sources.map((s, i) => {
          const pct = Math.round((s.tokens / lineage.totalTokens) * 100);
          const from = formatDateTime(new Date(s.fromDate), locale);
          const to = formatDateTime(new Date(s.toDate), locale);
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
                  <bdi>{from} → {to}</bdi> · {t("profile.lineage.synced", { time: formatRelativeTime(new Date(s.lastSyncAt), locale) })}
                </div>
              </div>
              <div style={{ textAlign: "end", minWidth: 110 }}>
                <div className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
                  <bdi>{s.count.toLocaleString(locale === "he" ? "he-IL" : "en-US")}</bdi>
                </div>
                <div className="subtle" style={{ fontSize: "var(--fs-xs)" }}>
                  {t("profile.lineage.tokenCount", { count: (s.tokens / 1000).toFixed(0), percent: pct })}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProfilePageContent() {
  const { t } = useT();
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

  // Reset to overview when switching employee. Done during render (the React
  // "storing information from previous renders" pattern) rather than in an
  // effect, so the new employee never paints with the previous tab/file.
  const [prevEmployeeId, setPrevEmployeeId] = useState(employeeId);
  if (employeeId !== prevEmployeeId) {
    setPrevEmployeeId(employeeId);
    setTab("overview");
    setSelectedFile(null);
  }

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
        <Topbar crumbs={["Workspace", t("profile.title")]} />
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
              {t("profile.empty.title")}
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
                ? t("profile.empty.missing")
                : t("profile.empty.new")}
            </p>
            <a
              href="/employees"
              className="btn primary"
              style={{ display: "inline-block", padding: "10px 18px" }}
            >
              {t("profile.empty.goEmployees")} ←
            </a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar crumbs={["Workspace", t("profile.title"), employee.name]} />
      <div className="scrollbar" style={{ overflow: "auto", padding: "32px 40px 60px" }}>
        <PageHead
          icon="User"
          title={t("profile.title")}
          subtitle={t("profile.subtitle")}
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
          {(["overview", "files", "versions", "danger"] as const).map((tabName) => (
            <button
              key={tabName}
              onClick={() => setTab(tabName)}
              style={{
                padding: "8px 18px",
                fontSize: "var(--fs-ui)",
                fontWeight: tab === tabName ? 600 : 500,
                color: tab === tabName ? "var(--text)" : "var(--text-muted)",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${tab === tabName ? "var(--text)" : "transparent"}`,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: -1,
                textTransform: "capitalize",
                letterSpacing: "0.005em",
                transition: "all .15s",
              }}
            >
              {t(`profile.tab.${tabName}`)}
            </button>
          ))}
        </div>

        {/* Tab content — the Files split-pane editor wants more room than the
            reading-oriented tabs, so widen it; keep 880 for the rest. */}
        <div style={{ maxWidth: tab === "files" ? 1280 : 880, marginTop: "var(--sp-24)" }}>
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
  const { t } = useT();
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
      setError(err instanceof Error ? err.message : t("profile.danger.error"));
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
          {t("profile.danger.title")}
        </h2>
        <p
          className="muted"
          style={{ fontSize: "var(--fs-base)", lineHeight: 1.55, margin: 0 }}
        >
          {t("profile.danger.desc")}
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
            {t("profile.danger.delete")}
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
          {t("profile.danger.remove")}
        </p>
        <ul
          style={{
            margin: "0 0 var(--sp-16)",
            paddingInlineStart: "var(--sp-20)",
            fontSize: "var(--fs-sm)",
            lineHeight: 1.7,
            color: "var(--text-muted)",
          }}
        >
          <li>{t("profile.danger.files", { files: "EXPERTISE.md, DECISIONS.md, etc." })}</li>
          <li>{t("profile.danger.connections")}</li>
          <li>{t("profile.danger.notes", { path: `data/scratch/${employee.id}/` })}</li>
          <li>{t("profile.danger.routines")}</li>
        </ul>
        <p
          style={{
            fontSize: "var(--fs-sm)",
            lineHeight: 1.6,
            margin: "0 0 var(--sp-20)",
            color: "var(--text-muted)",
          }}
        >
          {t("profile.danger.audit")}
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
            {t("profile.danger.confirm", { name: employee.name })}
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
          {deleting ? t("profile.danger.deleting") : t("profile.danger.deleteNamed", { name: employee.name })}
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
  const { t } = useT();
  const orgName = useOrgName();
  const [boundId, setBoundId] = useState(employee.id);
  const [nameHe, setNameHe] = useState(employee.nameHe ?? "");
  const [draft, setDraft] = useState(employee.nameHe ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (boundId !== employee.id) {
    setBoundId(employee.id);
    setNameHe(employee.nameHe ?? "");
    setDraft(employee.nameHe ?? "");
    setEditing(false);
    setSaving(false);
    setError(null);
  }

  function beginEdit() {
    setDraft(nameHe);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(nameHe);
    setError(null);
    setEditing(false);
  }

  async function saveNameHe() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameHe: draft }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; nameHe?: string }
        | null;
      if (!res.ok) {
        setError(
          data?.error === "not_hebrew"
            ? t("profile.name.invalid")
            : t("profile.name.error"),
        );
        return;
      }
      const next = typeof data?.nameHe === "string" ? data.nameHe : "";
      setNameHe(next);
      setDraft(next);
      setEditing(false);
    } catch {
      setError(t("profile.name.error"));
    } finally {
      setSaving(false);
    }
  }

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
                <span className="dot success pulse" /> {t("profile.status.live")}
              </span>
            )}
            {employee.twinStatus === "building" && (
              <span className="badge warn">{t("profile.status.building")}</span>
            )}
            {employee.twinStatus === "pending" && (
              <span className="badge">{t("profile.status.notStarted")}</span>
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
            {nameHe ? (
              <span
                dir="rtl"
                style={{
                  display: "inline-block",
                  marginInlineStart: "var(--sp-10)",
                  whiteSpace: "nowrap",
                  unicodeBidi: "isolate",
                  color: "var(--text-muted)",
                  fontWeight: 400,
                }}
              >
                {nameHe}
              </span>
            ) : null}
          </h1>
          <div className="muted" style={{ fontSize: "var(--fs-ui)" }}>
            {employee.role}
            {orgName ? ` · ${orgName}` : ""}
          </div>
          <div style={{ marginTop: "var(--sp-6)" }}>
            {editing ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-8)",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                  {t("profile.name.label")}
                </span>
                <input
                  dir="rtl"
                  value={draft}
                  aria-label={t("profile.name.label")}
                  disabled={saving}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveNameHe();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  style={{
                    minWidth: 160,
                    padding: "4px 8px",
                    fontSize: "var(--fs-ui)",
                    background: "var(--surface)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 4,
                    color: "var(--text)",
                    fontFamily: "inherit",
                  }}
                />
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={saving}
                  onClick={() => void saveNameHe()}
                >
                  {saving ? t("profile.name.saving") : t("profile.name.save")}
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={saving}
                  onClick={cancelEdit}
                >
                  {t("profile.name.cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={beginEdit}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: "var(--text-muted)",
                  fontSize: "var(--fs-sm)",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {nameHe ? t("profile.name.edit") : t("profile.name.add")}
              </button>
            )}
            {error ? (
              <div
                style={{
                  marginTop: "var(--sp-4)",
                  fontSize: "var(--fs-xs)",
                  color: "var(--danger)",
                }}
              >
                {error}
              </div>
            ) : null}
          </div>
        </div>
        <div
          className="row"
          style={{
            gap: "var(--sp-8)",
            flexShrink: 0,
            marginInlineStart: "auto",
          }}
        >
          <Link
            href={`/twin-build?employee=${employee.id}`}
            className="btn"
            style={{ textDecoration: "none" }}
            title={
              employee.profileFilesComplete >= 9
                ? t("profile.hero.rebuildTitle")
                : t("profile.hero.buildTitle")
            }
          >
            <Icons.Spark size={12} />{" "}
            {employee.profileFilesComplete >= 9 ? t("profile.hero.rebuild") : t("profile.hero.build")}
          </Link>
          <Link
            href={`/flow?employee=${employee.id}`}
            className="btn primary"
            style={{ textDecoration: "none" }}
          >
            <Icons.Bot size={12} /> {t("profile.hero.chat")}
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
  const { t } = useT();
  const [seedModel, setSeedModel] = useState<ClaudeModel>(employee.seedModel);
  const [refreshModel, setRefreshModel] = useState<ClaudeModel>(employee.refreshModel);
  const [saved, setSaved] = useState(false);

  // Hydrate from localStorage whenever the employee changes (including on mount).
  // Done during render — React's "adjust state when a prop changes" pattern —
  // rather than in an effect, so a persisted choice never flashes the prop
  // default first. localStorage is read client-side only (readStoredModels
  // swallows the server-side ReferenceError and returns {}).
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  if (hydratedFor !== employee.id) {
    setHydratedFor(employee.id);
    const stored = readStoredModels();
    if (stored[employee.id]) {
      setSeedModel(stored[employee.id].seed);
      setRefreshModel(stored[employee.id].refresh);
    }
  }

  function save() {
    const all = readStoredModels();
    all[employee.id] = { seed: seedModel, refresh: refreshModel };
    localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(all));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const seedMeta   = CLAUDE_MODELS.find((m) => m.id === seedModel) ?? CLAUDE_MODELS[0];
  const refreshMeta = CLAUDE_MODELS.find((m) => m.id === refreshModel) ?? CLAUDE_MODELS[0];
  const estSeed    = (BASE_SEED_COST * seedMeta.seedCostMultiplier).toFixed(2);
  const estRefresh = (BASE_REFRESH_COST * refreshMeta.refreshCostMultiplier).toFixed(2);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Seed model */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-10)", marginBottom: "var(--sp-14)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{t("profile.model.seed")}</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
              {t("profile.model.seedDesc", { cost: `$${estSeed}` })}
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
                  textAlign: "start",
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
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{t("profile.model.refresh")}</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
              {t("profile.model.refreshDesc", { cost: `$${estRefresh}` })}
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
                  textAlign: "start",
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
          {t("profile.model.footer")}
        </div>
        {saved && (
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--success)", fontWeight: 500 }}>{t("profile.common.saved")}</span>
        )}
        <button className="btn primary sm" onClick={save}>
          {t("profile.common.saveChanges")}
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
  const { t } = useT();
  const [voiceId, setVoiceId] = useState<string>(employee.ttsVoiceId);
  const [saved, setSaved] = useState(false);
  const [voices, setVoices] = useState<ELVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Hydrate the selected voice from localStorage whenever the employee changes
  // (including on mount). Done during render — React's "adjust state when a prop
  // changes" pattern — so a persisted choice never flashes the prop default
  // first. readStoredVoices swallows the server-side ReferenceError.
  const [voiceHydratedFor, setVoiceHydratedFor] = useState<string | null>(null);
  if (voiceHydratedFor !== employee.id) {
    setVoiceHydratedFor(employee.id);
    const stored = readStoredVoices();
    if (stored[employee.id]) setVoiceId(stored[employee.id]);
  }

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
    { key: "all",     label: t("profile.voice.all") },
    { key: "male",    label: t("profile.voice.male") },
    { key: "female",  label: t("profile.voice.female") },
    { key: "neutral", label: t("profile.voice.neutral") },
  ];

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header + gender filter */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, marginBottom: "var(--sp-2)" }}>{t("profile.voice.title")}</div>
        <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginBottom: "var(--sp-12)" }}>
          {t("profile.voice.desc")}
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
            {t("profile.voice.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "24px 18px", color: "var(--text-subtle)", fontSize: "var(--fs-sm)", textAlign: "center" }}>
            {t("profile.voice.none")}
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
                      title={isPreviewing ? t("profile.voice.stop") : t("profile.voice.play")}
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
          {voices.length > 0 ? t("profile.voice.available", { count: voices.length }) : ""} · {t("profile.voice.footer")}
        </div>
        {saved && <span style={{ fontSize: "var(--fs-sm)", color: "var(--success)", fontWeight: 500 }}>{t("profile.common.saved")}</span>}
        <button className="btn primary sm" onClick={save}>{t("profile.common.saveChanges")}</button>
      </div>
    </div>
  );
}

// ─── Org Skill Assignment ────────────────────────────────────────────────────

function OrgSkillAssignmentCard({ employee }: { employee: EmployeeWithTwin }) {
  const { t } = useT();
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
      setError(err instanceof Error ? err.message : t("profile.skills.loadError"));
    } finally {
      setLoading(false);
    }
  }, [employee.id, t]);

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
        throw new Error(data.error ?? t("profile.skills.saveError"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profile.skills.saveError"));
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
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{t("profile.skills.title")}</div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
              {t("profile.skills.desc", { settings: t("profile.skills.settings") })}
            </div>
          </div>
          <span className="badge twin" style={{ fontSize: "var(--fs-xs)" }}>
            {t("profile.skills.assigned", { count: assigned.size })}
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
          {t("profile.skills.loading")}
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
                  textAlign: "start",
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
  const { t } = useT();
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
        title={t("profile.overview.identity")}
        subhead={t("profile.overview.identitySub")}
        divider={false}
      >
        {employee.twinStatus === "ready" ? (
          <div>
            <SectionTitle>{t("profile.overview.sample")}</SectionTitle>
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
                  {t("profile.overview.preview")}
                </span>
                <div className="spacer" />
                <span className="subtle mono" style={{ fontSize: "var(--fs-meta)" }}>
                  {t("profile.overview.ask")} <Link href={`/flow?employee=${employee.id}`} style={{ color: "var(--twin)" }}><bdi>/flow</bdi></Link>
                </span>
              </div>
              <p style={{ fontSize: "var(--fs-base)", lineHeight: 1.6, margin: 0, color: "var(--text-muted)" }}>
                {t("profile.overview.sampleDesc", { files: "TONE.md, EXPERTISE.md, CONTEXT.md" })}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <SectionTitle>{t("profile.overview.sample")}</SectionTitle>
            <div
              className="card"
              style={{
                padding: "var(--sp-20)",
                background: "var(--bg-elevated)",
              }}
            >
              <p style={{ fontSize: "var(--fs-base)", lineHeight: 1.6, margin: 0, color: "var(--text-muted)" }}>
                {t("profile.overview.noPreview")} {" "}
                <Link href={`/twin-build?employee=${employee.id}`} style={{ color: "var(--accent)" }}>
                  {t("profile.overview.startTraining")}
                </Link>{" "}
                {t("profile.overview.startTrainingTail")}
              </p>
            </div>
          </div>
        )}

        <div>
          <SectionTitle>{t("profile.overview.voice")}</SectionTitle>
          <VoicePicker employee={employee} />
        </div>

        <div>
          <SectionTitle>{t("profile.overview.domains")}</SectionTitle>
          <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: "0 0 14px", lineHeight: 1.5 }}>
            {t("profile.overview.domainsDesc")}
          </p>
          {domains.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, fontStyle: "italic" }}>
              {t("profile.overview.domainsEmpty", { file: "EXPERTISE.md" })}
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
          <SectionTitle>{t("profile.overview.boundaries")}</SectionTitle>
          <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: "0 0 14px", lineHeight: 1.5 }}>
            {t("profile.overview.boundariesDesc")}
          </p>
          {boundaries.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, fontStyle: "italic" }}>
              {t("profile.overview.boundariesEmpty", { file: "BOUNDARIES.md" })}
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
        title={t("profile.overview.knowledge")}
        subhead={t("profile.overview.knowledgeSub")}
      >
        <div>
          <SectionTitle>{t("profile.overview.sources")}</SectionTitle>
          {activeToolkits.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0 }}>
              {t("profile.overview.noSources")} {" "}
              <Link href={`/connections/${employee.id}`} style={{ color: "var(--text)" }}>
                {t("profile.overview.connect")} ←
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
          <SectionTitle>{t("profile.overview.trained")}</SectionTitle>
          <LineageCard employee={employee} />
        </div>

        <div>
          <SectionTitle>{t("profile.overview.skills")}</SectionTitle>
          <OrgSkillAssignmentCard employee={employee} />
        </div>
      </SectionGroup>

      <SectionGroup
        title={t("profile.overview.trust")}
        subhead={t("profile.overview.trustSub")}
      >
        <div>
          <SectionTitle>{t("profile.overview.consent")}</SectionTitle>
          <ConsentCard employee={employee} />
        </div>

        <div>
          <SectionTitle>{t("profile.overview.model")}</SectionTitle>
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
  const [deletedKnowledge, setDeletedKnowledge] = useState<KnowledgeVersionRow[]>([]);

  const loadKnowledge = useCallback(async () => {
    try {
      const r = await fetch(`/api/employees/${employeeId}/knowledge`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as {
        files?: KnowledgeFileMeta[];
        deleted?: KnowledgeVersionRow[];
      };
      setKnowledge(data.files ?? []);
      setDeletedKnowledge(data.deleted ?? []);
    } catch {
      /* leave list as-is on transient error */
    }
  }, [employeeId]);

  useEffect(() => {
    void (async () => {
      await loadKnowledge();
    })();
  }, [loadKnowledge]);

  return (
    <>
    <KnowledgeProposalsPanel employeeId={employeeId} onAccepted={() => void loadKnowledge()} />
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
        deleted={deletedKnowledge}
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
    </>
  );
}

// ─── File tree (left pane) ────────────────────────────────────────────────────

function FileTreePane({
  employeeId,
  profileFiles,
  knowledge,
  deleted,
  selected,
  onSelect,
  onKnowledgeChanged,
}: {
  employeeId: string;
  profileFiles: FileNode[];
  knowledge: KnowledgeFileMeta[];
  deleted: KnowledgeVersionRow[];
  selected: SelectedFile | null;
  onSelect: (sel: SelectedFile) => void;
  onKnowledgeChanged: () => void | Promise<void>;
}) {
  const { t } = useT();
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
    const raw = window.prompt(t("profile.files.newPrompt"), "notes.md");
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

  async function restoreDeleted(entry: KnowledgeVersionRow) {
    if (!window.confirm(t("profile.files.restoreConfirm", { name: entry.name }))) return;
    setError(null);
    try {
      const r = await fetch(
        `/api/employees/${employeeId}/knowledge/${encodeURIComponent(entry.name)}/versions/${encodeURIComponent(entry.ts)}/restore`,
        { method: "POST" },
      );
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? "Restore failed");
      await onKnowledgeChanged();
      onSelect({ group: "knowledge", name: entry.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  }

  async function deleteFile(name: string) {
    const restoreNote = isKnowledgeTextName(name)
      ? t("profile.files.restoreNote")
      : "";
    if (!window.confirm(t("profile.files.deleteConfirm", { name, note: restoreNote }))) return;
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
            style={{ overflow: "hidden", marginInlineStart: 12, borderInlineStart: "1px solid var(--hairline)" }}
          >
            {profileFiles.length === 0 ? (
              <div className="subtle" style={{ fontSize: "var(--fs-xs)", padding: "6px 8px 6px 16px", fontFamily: "var(--font-sans, sans-serif)" }}>
                {t("profile.files.profileEmpty")}
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
            style={{ overflow: "hidden", marginInlineStart: 12, borderInlineStart: "1px solid var(--hairline)" }}
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

      {deleted.length > 0 && (
        <div
          style={{
            marginTop: "var(--sp-8)",
            padding: "0 8px",
            fontFamily: "var(--font-sans, sans-serif)",
          }}
        >
          <div
            className="subtle"
            style={{ fontSize: "var(--fs-2xs)", fontWeight: 600, marginBottom: "var(--sp-4)" }}
          >
            {t("profile.files.recentlyDeleted")}
          </div>
          <div className="scrollbar" style={{ maxHeight: 160, overflow: "auto" }}>
            {deleted.map((entry) => (
              <div
                key={`${entry.name}:${entry.ts}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-6)",
                  marginBottom: "var(--sp-4)",
                }}
              >
                <span
                  dir="auto"
                  title={entry.name}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "var(--fs-xs)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.name}
                </span>
                <span className="subtle" style={{ fontSize: "var(--fs-2xs)", flexShrink: 0 }}>
                  {formatSnapshotSize(entry.sizeBytes)}
                </span>
                <button
                  type="button"
                  className="btn sm"
                  style={{ fontSize: "var(--fs-2xs)", height: "auto", padding: "2px 6px" }}
                  onClick={() => void restoreDeleted(entry)}
                >
                  {t("profile.files.restore")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
          {dragOver ? t("profile.files.drop") : t("profile.files.drag")}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-6)" }}>
          <button
            className="btn sm"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Icons.Plus size={11} /> {uploading ? t("profile.files.uploading") : t("profile.files.upload")}
          </button>
          <button
            className="btn sm"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={createFile}
            disabled={uploading}
          >
            <Icons.Plus size={11} /> {t("profile.files.new")}
          </button>
        </div>
        <div className="subtle" style={{ fontSize: "var(--fs-2xs)", textAlign: "center", marginTop: "var(--sp-6)", lineHeight: 1.4 }}>
          {t("profile.files.formats")}
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
  const { t } = useT();
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-6)",
        marginInlineStart: 8,
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
          padding: "5px 10px 5px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          color: active ? "var(--accent-deep)" : hovered ? "var(--text)" : "var(--text-muted)",
          textAlign: "start",
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
          title={t("profile.files.deleteTitle", { name })}
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            marginInlineEnd: 4,
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

function KnowledgeFileHistory({
  employeeId,
  name,
  currentBody,
  refreshKey,
  dirty,
  onRestored,
}: {
  employeeId: string;
  name: string;
  currentBody: string;
  refreshKey: number;
  dirty: boolean;
  onRestored: () => Promise<void>;
}) {
  const { t, locale } = useT();
  const [versions, setVersions] = useState<KnowledgeVersionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [picked, setPicked] = useState<{ ts: string; body: string } | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/employees/${employeeId}/knowledge/${encodeURIComponent(name)}/versions`,
          { cache: "no-store" },
        );
        const data = (await r.json()) as { versions?: KnowledgeVersionRow[]; error?: string };
        if (!r.ok) throw new Error(data.error ?? "Could not load history");
        if (!cancelled) {
          setVersions(data.versions ?? []);
          setListError("");
        }
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : "Could not load history");
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, name, refreshKey]);

  const changeLines = useMemo(() => {
    if (!showChanges || !picked) return null;
    return diffLines(picked.body, currentBody);
  }, [showChanges, picked, currentBody]);

  async function selectVersion(ts: string) {
    setBusy(`open:${ts}`);
    setListError("");
    try {
      const r = await fetch(
        `/api/employees/${employeeId}/knowledge/${encodeURIComponent(name)}/versions/${encodeURIComponent(ts)}`,
        { cache: "no-store" },
      );
      const data = (await r.json()) as { body?: string; error?: string };
      if (!r.ok || typeof data.body !== "string") {
        throw new Error(data.error ?? "Could not load this version");
      }
      setPicked({ ts, body: data.body });
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load this version");
    } finally {
      setBusy(null);
    }
  }

  async function restore(ts: string) {
    const unsaved = dirty ? " Unsaved edits in the editor will be discarded." : "";
    if (
      !window.confirm(
        `Restore ${name} to this version? The current file will be saved as a new version first.${unsaved}`,
      )
    ) {
      return;
    }
    setBusy(`restore:${ts}`);
    setListError("");
    try {
      const r = await fetch(
        `/api/employees/${employeeId}/knowledge/${encodeURIComponent(name)}/versions/${encodeURIComponent(ts)}/restore`,
        { method: "POST" },
      );
      const data = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? "Restore failed");
      setPicked(null);
      setShowChanges(false);
      await onRestored();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        borderBottom: "1px solid var(--hairline)",
        background: "var(--surface)",
        padding: "12px 16px",
      }}
    >
      {loadingList ? (
        <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
          {t("profile.files.historyLoading")}
        </p>
      ) : listError && versions.length === 0 ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--danger)", margin: 0 }}>{listError}</p>
      ) : versions.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0, lineHeight: 1.5 }}>
          {t("profile.files.historyEmpty")}
        </p>
      ) : (
        <div className="scrollbar" style={{ maxHeight: 180, overflow: "auto" }}>
          {versions.map((entry) => {
            const selectedRow = picked?.ts === entry.ts;
            return (
              <button
                key={entry.ts}
                type="button"
                onClick={() => void selectVersion(entry.ts)}
                disabled={busy === `open:${entry.ts}`}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--sp-8)",
                  width: "100%",
                  textAlign: "start",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "var(--text)",
                  borderRadius: 4,
                  padding: "6px 8px",
                  background: selectedRow
                    ? "color-mix(in oklch, var(--accent) 14%, transparent)"
                    : "transparent",
                }}
              >
                <span style={{ fontSize: "var(--fs-sm)", fontWeight: selectedRow ? 600 : 500 }}>
                  {formatSnapshotTime(entry.ts, locale)}
                </span>
                <span className="subtle" style={{ fontSize: "var(--fs-xs)" }}>
                  {formatSnapshotSize(entry.sizeBytes)}
                </span>
                <span className="subtle mono" style={{ fontSize: "var(--fs-xs)" }}>
                  {entry.source}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {picked && (
        <div style={{ marginTop: "var(--sp-10)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-6)", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              aria-pressed={showChanges}
              onClick={() => setShowChanges((on) => !on)}
              style={{
                fontSize: "var(--fs-xs)",
                height: "auto",
                padding: "3px 8px",
                ...(showChanges ? { background: "var(--bg-sunken)" } : {}),
              }}
            >
              {t("profile.files.changes")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void restore(picked.ts)}
              disabled={busy === `restore:${picked.ts}`}
              style={{ fontSize: "var(--fs-xs)", height: "auto", padding: "3px 8px" }}
            >
              <Icons.Refresh size={11} />{" "}
              {busy === `restore:${picked.ts}` ? t("profile.files.restoring") : t("profile.files.restoreVersion")}
            </button>
          </div>
          {showChanges && (
            <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "8px 0" }}>
              {t("profile.files.fromVersion")}
            </p>
          )}
          <div className="scrollbar" style={{ maxHeight: 280, overflow: "auto", marginTop: "var(--sp-8)" }}>
            {showChanges && changeLines ? (
              <VersionDiff lines={changeLines} />
            ) : (
              <div
                aria-label="Version text"
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "var(--fs-sm)",
                  lineHeight: 1.5,
                  border: "1px solid var(--hairline)",
                  borderRadius: 5,
                  padding: "8px 0",
                }}
              >
                {picked.body.split("\n").map((line, index) => (
                  <div
                    key={`${picked.ts}-${index}`}
                    dir="auto"
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      padding: "0 var(--sp-8)",
                    }}
                  >
                    {line.length === 0 ? "\u00a0" : line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {listError && versions.length > 0 && (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--danger)", margin: "8px 0 0" }}>
          {listError}
        </p>
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
  const { t } = useT();
  const [body, setBody] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const fileUrl = useCallback(
    (sel: SelectedFile) =>
      sel.group === "profile"
        ? `/api/employees/${employeeId}/file/${encodeURIComponent(sel.name)}`
        : `/api/employees/${employeeId}/knowledge/${encodeURIComponent(sel.name)}`,
    [employeeId]
  );

  // Enter the loading state as soon as a new file is selected. Done during
  // render — React's "adjust state when a prop changes" pattern — so the reset
  // isn't a synchronous setState inside the fetch effect below. Matches the
  // effect's original guard: a null selection leaves the prior state untouched.
  const [loadingSel, setLoadingSel] = useState<SelectedFile | null>(selected);
  if (loadingSel !== selected) {
    setLoadingSel(selected);
    setHistoryOpen(false);
    if (selected) {
      setLoading(true);
      setError("");
      setSavedAt(null);
    }
  }

  // Load the selected file's body. Both APIs return { body, ... }.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
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
            {t("profile.files.select")}
          </p>
        </div>
      </div>
    );
  }

  const dirty = body !== original;
  const knowledgeText =
    selected.group === "knowledge" && isKnowledgeTextName(selected.name);

  async function reloadFromDisk() {
    if (!selected) return;
    const r = await fetch(fileUrl(selected), { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { body?: string };
    const next = data.body ?? "";
    setBody(next);
    setOriginal(next);
    setSavedAt(Date.now());
    if (selected.group === "knowledge") await onKnowledgeChanged();
  }

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
        {knowledgeText && (
          <button
            type="button"
            className="btn sm"
            aria-pressed={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
            style={{
              height: 28,
              ...(historyOpen ? { background: "var(--bg-sunken)" } : {}),
            }}
          >
            {t("profile.files.history")}
          </button>
        )}
        {dirty && (
          <span
            aria-label={t("profile.files.unsaved")}
            title={t("profile.files.unsaved")}
            style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--warn)", flexShrink: 0 }}
          />
        )}
        {!dirty && savedAt && (
          <span style={{ fontSize: "var(--fs-meta)", color: "var(--success)" }}>{t("profile.common.saved")}</span>
        )}
        <button
          onClick={save}
          className="btn primary sm"
          style={{ height: 28 }}
          disabled={saving || !dirty || loading}
        >
          {saving ? t("profile.files.saving") : t("profile.files.save")}
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
            {t("profile.files.baseNote")}
          </>
        ) : (
          <>
            <Icons.Lock size={11} style={{ color: "var(--twin)", flexShrink: 0 }} />
            {t("profile.files.ownedNote")}
          </>
        )}
      </div>

      {historyOpen && knowledgeText && (
        <KnowledgeFileHistory
          employeeId={employeeId}
          name={selected.name}
          currentBody={original}
          refreshKey={savedAt ?? 0}
          dirty={dirty}
          onRestored={reloadFromDisk}
        />
      )}

      {error && (
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--danger)", padding: "10px 16px", borderBottom: "1px solid var(--hairline)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ fontSize: "var(--fs-ui)", padding: "24px 16px", margin: 0 }}>
          {t("profile.files.loading")}
        </p>
      ) : (
        <div style={{ padding: "var(--sp-8)" }}>
          <TwinEditor
            key={`${selected.group}:${selected.name}`}
            value={original}
            onChange={setBody}
            placeholder={t("profile.files.placeholder")}
          />
        </div>
      )}
    </div>
  );
}

// Live profile reads strip YAML frontmatter. Snapshots store the raw file,
// so comparisons use the same markdown body the file endpoint returns.
const PROFILE_FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;

function profileMarkdown(raw: string): string {
  const match = raw.match(PROFILE_FRONTMATTER_RE);
  return match ? raw.slice(match[0].length) : raw;
}

function VersionDiff({ lines }: { lines: ReturnType<typeof diffLines> }) {
  const { t } = useT();
  if (lines.length === 1 && lines[0].text === DIFF_TOO_LARGE_TEXT) {
    return (
      <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, lineHeight: 1.55 }}>
        {t("profile.diff.large")}
      </p>
    );
  }
  if (!lines.some((line) => line.type !== "same")) {
    return (
      <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, lineHeight: 1.55 }}>
        {t("profile.diff.none")}
      </p>
    );
  }
  return (
    <div
      aria-label={t("profile.diff.label")}
      style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "var(--fs-sm)",
        lineHeight: 1.5,
        border: "1px solid var(--hairline)",
        borderRadius: 5,
        overflow: "hidden",
      }}
    >
      {lines.map((line, index) => {
        const collapsed = line.type === "same" && isCollapsedUnchanged(line.text);
        const background =
          line.type === "add"
            ? "color-mix(in oklch, var(--success) 14%, transparent)"
            : line.type === "del"
              ? "color-mix(in oklch, var(--danger) 14%, transparent)"
              : "transparent";
        return (
          <div
            key={`${line.type}-${index}`}
            dir="auto"
            style={{
              display: "flex",
              alignItems: "baseline",
              background,
              color: collapsed ? "var(--text-muted)" : "var(--text)",
            }}
          >
            <span
              style={{
                flex: "0 0 auto",
                width: "1.75em",
                textAlign: "center",
                color: "var(--text-muted)",
                userSelect: "none",
                padding: "1px 0",
              }}
            >
              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                padding: "1px var(--sp-8) 1px 0",
              }}
            >
              {line.text.length === 0 ? "\u00a0" : line.text}
            </span>
          </div>
        );
      })}
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
  const { t, locale } = useT();
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
  const [showChanges, setShowChanges] = useState(false);
  const [diffBaseline, setDiffBaseline] = useState<"current" | "previous">("current");
  const [changeLoad, setChangeLoad] = useState<
    | { status: "idle" }
    | { status: "error"; key: string }
    | {
        status: "ready";
        key: string;
        currentBody: string;
        previousBody: string | null;
        previousTs: string | null;
      }
  >({ status: "idle" });

  // Callers that want the full-list loading state (the post-restore refreshes)
  // set `loading` themselves before awaiting; on mount it is already true via
  // the initial state, so this fetch has no synchronous setState of its own.
  const loadBuilds = useCallback(async () => {
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
    void (async () => {
      await loadBuilds();
    })();
  }, [loadBuilds]);

  useEffect(() => {
    if (!showChanges || !previewing) return;
    const filename = previewing.filename;
    const snapshotTs = previewing.snapshotTs;
    const key = `${filename}\0${snapshotTs}`;
    let cancelled = false;
    void (async () => {
      try {
        const [curRes, listRes] = await Promise.all([
          fetch(`/api/employees/${employeeId}/file/${encodeURIComponent(filename)}`, {
            cache: "no-store",
          }),
          fetch(
            `/api/employees/${employeeId}/versions/file/${encodeURIComponent(filename)}`,
            { cache: "no-store" },
          ),
        ]);
        let currentBody = "";
        if (curRes.ok) {
          const data = (await curRes.json()) as { body?: string };
          currentBody = data.body ?? "";
        } else if (curRes.status !== 404) {
          throw new Error("could not load current file");
        }
        let previousTs: string | null = null;
        let previousBody: string | null = null;
        if (listRes.ok) {
          const data = (await listRes.json()) as { versions?: Array<{ ts: string }> };
          const versions = [...(data.versions ?? [])].sort((a, b) =>
            b.ts.localeCompare(a.ts),
          );
          const idx = versions.findIndex((v) => v.ts === snapshotTs);
          if (idx >= 0 && idx + 1 < versions.length) previousTs = versions[idx + 1].ts;
        }
        if (previousTs) {
          const prevRes = await fetch(
            `/api/employees/${employeeId}/versions/file/${encodeURIComponent(filename)}/${encodeURIComponent(previousTs)}`,
            { cache: "no-store" },
          );
          if (prevRes.ok) {
            const data = (await prevRes.json()) as { body?: string };
            if (typeof data.body === "string") previousBody = data.body;
          }
        }
        if (!cancelled) {
          setChangeLoad({ status: "ready", key, currentBody, previousBody, previousTs });
        }
      } catch {
        if (!cancelled) setChangeLoad({ status: "error", key });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showChanges, employeeId, previewing]);

  const previewKey = previewing
    ? `${previewing.filename}\0${previewing.snapshotTs}`
    : "";
  const matchedLoad =
    changeLoad.status !== "idle" && changeLoad.key === previewKey ? changeLoad : null;

  const changeLines = useMemo(() => {
    if (!showChanges || !previewing || matchedLoad?.status !== "ready") return null;
    if (diffBaseline === "previous") {
      if (matchedLoad.previousBody === null) return null;
      return diffLines(
        profileMarkdown(matchedLoad.previousBody),
        profileMarkdown(previewing.body),
      );
    }
    return diffLines(profileMarkdown(previewing.body), matchedLoad.currentBody);
  }, [showChanges, previewing, matchedLoad, diffBaseline]);

  const previousReady =
    matchedLoad?.status === "ready" && matchedLoad.previousBody !== null;

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
      setDiffBaseline("current");
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
      setLoading(true);
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
      setLoading(true);
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
        {t("profile.versions.loading")}
      </div>
    );
  }

  if (builds.length === 0) {
    return (
      <div className="card" style={{ padding: "var(--sp-24)", maxWidth: 720 }}>
        <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, margin: "0 0 6px" }}>
          {t("profile.versions.empty")}
        </h2>
        <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: "0 0 14px", lineHeight: 1.55 }}>
          {t("profile.versions.emptyDesc")}
        </p>
        <Link
          href={`/twin-build?employee=${employeeId}`}
          className="btn primary"
          style={{ textDecoration: "none" }}
        >
          <Icons.Spark size={12} /> {t("profile.versions.first")}
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
            insetInlineEnd: 24,
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
        {t("profile.versions.desc")}
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
                textAlign: "start",
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
                    <bdi>{formatDateTime(finished, locale)}</bdi>
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
                  {t("profile.versions.files", { count: writtenCount })} · {t("profile.versions.turns", { count: b.turns })} · <bdi>${b.costUsd.toFixed(3)} · {Math.round(b.durationMs / 1000)}s</bdi>
                  {b.activeToolkits.length > 0 ? (
                    <> · {t("profile.versions.sources", { sources: b.activeToolkits.join(", ") })}</>
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
                      ? t("profile.versions.restoring")
                      : t("profile.versions.restoreAll", { version: b.version })}
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
                            {t("profile.versions.new")}
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
                          <Icons.Eye size={10} /> {t("profile.versions.preview")}
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: "var(--fs-xs)", padding: "3px 8px" }}
                          onClick={() => restoreOneFile(f.filename, f.snapshotTs)}
                          disabled={busy === `restore:${f.filename}:${f.snapshotTs}`}
                        >
                          <Icons.Refresh size={10} /> {t("profile.versions.restoreFile")}
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
                flexWrap: "wrap",
              }}
            >
              <span className="mono" style={{ fontSize: "var(--fs-ui)", fontWeight: 700 }}>
                {previewing.filename}
              </span>
              <span
                className="subtle mono"
                style={{ fontSize: "var(--fs-xs)" }}
              >
                {t("profile.versions.snapshot", { value: previewing.snapshotTs })}
              </span>
              <button
                type="button"
                className="btn"
                aria-pressed={showChanges}
                onClick={() => setShowChanges((on) => !on)}
                style={{
                  fontSize: "var(--fs-xs)",
                  height: "auto",
                  padding: "3px 8px",
                  ...(showChanges ? { background: "var(--bg-sunken)" } : {}),
                }}
              >
                {t("profile.files.changes")}
              </button>
              <div className="spacer" />
              <button
                className="btn"
                onClick={() =>
                  restoreOneFile(previewing.filename, previewing.snapshotTs)
                }
              >
                <Icons.Refresh size={11} /> {t("profile.files.restoreVersion")}
              </button>
              <button className="btn" onClick={() => setPreviewing(null)}>
                <Icons.X size={11} /> {t("profile.versions.close")}
              </button>
            </div>
            {showChanges && (
              <div
                style={{
                  padding: "8px 18px",
                  borderBottom: "1px solid var(--hairline)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-6)",
                  flexWrap: "wrap",
                }}
              >
                <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                  {diffBaseline === "previous"
                    ? t("profile.versions.fromPrevious")
                    : t("profile.files.fromVersion")}
                </span>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={diffBaseline === "current"}
                  onClick={() => setDiffBaseline("current")}
                  style={{
                    fontSize: "var(--fs-xs)",
                    height: "auto",
                    padding: "3px 8px",
                    ...(diffBaseline === "current" ? { background: "var(--bg-sunken)" } : {}),
                  }}
                >
                  {t("profile.versions.current")}
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={diffBaseline === "previous"}
                  disabled={!previousReady}
                  title={
                    matchedLoad?.status === "ready" && !previousReady
                      ? t("profile.versions.noPrevious")
                      : undefined
                  }
                  onClick={() => setDiffBaseline("previous")}
                  style={{
                    fontSize: "var(--fs-xs)",
                    height: "auto",
                    padding: "3px 8px",
                    ...(diffBaseline === "previous" ? { background: "var(--bg-sunken)" } : {}),
                    ...(!previousReady ? { color: "var(--text-muted)" } : {}),
                  }}
                >
                  {t("profile.versions.previous")}
                </button>
              </div>
            )}
            <div
              className="scrollbar"
              style={{ overflow: "auto", padding: "20px 24px" }}
            >
              {showChanges ? (
                matchedLoad?.status === "error" ? (
                  <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, lineHeight: 1.55 }}>
                    {t("profile.versions.comparisonError")}
                  </p>
                ) : matchedLoad?.status !== "ready" || changeLines === null ? (
                  <p className="muted" style={{ fontSize: "var(--fs-ui)", margin: 0, lineHeight: 1.55 }}>
                    {diffBaseline === "previous" && matchedLoad?.status === "ready"
                      ? t("profile.versions.noPrevious")
                      : t("profile.versions.loadingChanges")}
                  </p>
                ) : (
                  <VersionDiff lines={changeLines} />
                )
              ) : (
                <Markdown>{previewing.body}</Markdown>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
