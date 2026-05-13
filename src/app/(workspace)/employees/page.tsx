"use client";

import Link from "next/link";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Star } from "iconoir-react";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { Topbar } from "@/components/ex/shell";
import { INTEGRATIONS as INTEGRATION_META } from "@/lib/demo";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import {
  EMPLOYEES_WITH_TWIN,
  ORG_SKILLS,
  type EmployeeWithTwin,
  type TwinStatus,
} from "@/lib/employees";
import type { Invite } from "@/lib/invites";

const MARKETPLACE_ID_PREFIX = "marketplace-";

type FilterKey = "all" | TwinStatus | "favorites";

const FAVORITES_KEY = "employee001.favorites.v1";

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function SourceLogo({ id, size = 16 }: { id: string; size?: number }) {
  const meta = INTEGRATION_META[id];
  const slug = meta?.simpleIconSlug ?? id;
  const label = meta?.name ?? id;
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        width: 26,
        height: 26,
        borderRadius: 5,
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <ToolkitIcon slug={slug} size={size} />
    </span>
  );
}

function StarButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={active ? "Remove from favorites" : "Add to favorites"}
      aria-label={active ? "Remove favorite" : "Add favorite"}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: active ? "var(--accent-soft)" : "transparent",
        border: "1px solid " + (active ? "var(--accent-soft)" : "var(--hairline)"),
        color: active ? "var(--accent-deep)" : "var(--text-subtle)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        transition: "background .12s, color .12s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = "var(--text-subtle)";
      }}
    >
      <Star width={14} height={14} strokeWidth={1.5} fill={active ? "currentColor" : "none"} />
    </button>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  border,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "success" | "warn" | "danger" | "idle";
  border?: boolean;
}) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderLeft: border ? "1px solid var(--hairline)" : "none",
      }}
    >
      <div className="row" style={{ gap: "var(--sp-8)", marginBottom: "var(--sp-4)" }}>
        <span className={"dot " + tone} />
        <div className="section-title" style={{ fontSize: "var(--fs-xs)" }}>
          {label}
        </div>
      </div>
      <div
        className="mono"
        style={{
          fontSize: "var(--fs-h2)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
        {hint}
      </div>
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.85 ? "success" : value >= 0.7 ? "warn" : "danger";
  return (
    <span className={"badge " + tone} style={{ fontSize: "var(--fs-xs)" }}>
      <span className={"dot " + tone} style={{ boxShadow: "none" }} />
      {pct}% confidence
    </span>
  );
}

// ─── Twin Quality ────────────────────────────────────────────────────────────
//
// One headline number per twin so the CEO can scan the grid and instantly
// see which twins are mature, half-baked, or untrained. Combines four
// existing signals; deliberately simple and explainable rather than ML-y.

const TWIN_PROFILE_FILE_TARGET = 9;

type QualityBreakdown = { label: string; weight: number; value01: number };

function recencyTo01(iso?: string): number {
  if (!iso) return 0.5;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days <= 7) return 1;
  if (days >= 60) return 0;
  return 1 - (days - 7) / 53;
}

function computeTwinQuality(emp: EmployeeWithTwin): {
  /** 0–100. Always rounded. `null` for twins that aren't built yet. */
  score: number | null;
  /** Bucket for color/label. */
  grade: "high" | "medium" | "low" | "empty";
  breakdown: QualityBreakdown[];
} {
  if (emp.twinStatus !== "ready") {
    return { score: null, grade: "empty", breakdown: [] };
  }

  const breakdown: QualityBreakdown[] = [
    { label: "Model confidence", weight: 50, value01: emp.twinConfidence },
    {
      label: "Profile coverage",
      weight: 30,
      value01: Math.min(emp.profileFilesComplete, TWIN_PROFILE_FILE_TARGET) / TWIN_PROFILE_FILE_TARGET,
    },
    { label: "Consent on file", weight: 10, value01: emp.consent ? 1 : 0 },
    { label: "Recent activity", weight: 10, value01: recencyTo01(emp.lastActiveAt) },
  ];

  const score = Math.round(
    breakdown.reduce((acc, b) => acc + b.value01 * b.weight, 0)
  );
  const grade = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
  return { score, grade, breakdown };
}

const QUALITY_THEME: Record<
  "high" | "medium" | "low" | "empty",
  { label: string; fg: string; bgSoft: string; track: string }
> = {
  high: {
    label: "human-grade",
    fg: "#15803d",
    bgSoft: "rgba(40, 160, 90, 0.12)",
    track: "rgba(40, 160, 90, 0.18)",
  },
  medium: {
    label: "developing",
    fg: "#a16207",
    bgSoft: "rgba(180, 130, 30, 0.12)",
    track: "rgba(180, 130, 30, 0.20)",
  },
  low: {
    label: "needs work",
    fg: "#b45309",
    bgSoft: "rgba(180, 90, 40, 0.12)",
    track: "rgba(180, 90, 40, 0.22)",
  },
  empty: {
    label: "not built",
    fg: "var(--text-subtle)",
    bgSoft: "var(--bg-sunken)",
    track: "var(--hairline)",
  },
};

function TwinQualityBar({ emp }: { emp: EmployeeWithTwin }) {
  const { score, grade, breakdown } = computeTwinQuality(emp);
  const theme = QUALITY_THEME[grade];

  // Compact tooltip listing each component's contribution.
  const tooltip =
    breakdown.length > 0
      ? `Twin quality — proximity to the human ${emp.name.split(" ")[0]}.\n\n` +
        breakdown
          .map(
            (b) =>
              `${b.label}: ${Math.round(b.value01 * 100)}% (weight ${b.weight}%)`
          )
          .join("\n")
      : "Twin not built yet — run Build twin to score.";

  return (
    <div
      title={tooltip}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-10)",
        padding: "8px 12px",
        borderRadius: 8,
        background: theme.bgSoft,
        border: `1px solid ${theme.track}`,
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono, ui-monospace)",
          fontSize: "var(--fs-h3)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: theme.fg,
          minWidth: 32,
          lineHeight: 1,
        }}
      >
        {score === null ? "—" : score}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-2xs)",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: theme.fg,
            marginBottom: "var(--sp-4)",
          }}
        >
          Twin quality · {theme.label}
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: theme.track,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${score ?? 0}%`,
              height: "100%",
              background: theme.fg,
              transition: "width .3s ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ConsentPill({ consented }: { consented: boolean }) {
  if (consented) {
    return (
      <span
        className="badge"
        style={{ fontSize: "var(--fs-xs)" }}
        title="Employee consent on file"
      >
        <Icons.Check size={9} /> Consented
      </span>
    );
  }
  return (
    <span
      className="badge warn"
      style={{ fontSize: "var(--fs-xs)" }}
      title="No consent on file — twin cannot ingest data until granted"
    >
      <span className="dot warn" style={{ boxShadow: "none" }} />
      No consent
    </span>
  );
}

function ProfileBar({ complete }: { complete: number }) {
  // Matches the canonical TWIN_FILE_NAMES count in twin-builder-types.ts.
  // The earlier 12 was a placeholder from the original mockup.
  const total = TWIN_PROFILE_FILE_TARGET;
  const clamped = Math.min(complete, total);
  return (
    <div>
      <div style={{ display: "flex", gap: "var(--sp-3)", marginBottom: "var(--sp-6)" }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 2,
              background: i < clamped ? "var(--accent)" : "var(--bg-sunken)",
            }}
          />
        ))}
      </div>
      <div className="subtle mono" style={{ fontSize: "var(--fs-xs)" }}>
        {clamped} / {total} files
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TwinStatus }) {
  if (status === "ready") {
    return (
      <span className="badge success">
        <span className="dot success" style={{ boxShadow: "none" }} /> Twin ready
      </span>
    );
  }
  if (status === "building") {
    return (
      <span className="badge warn">
        <Icons.Refresh size={10} className="spin" /> Building twin
      </span>
    );
  }
  return (
    <span className="badge">
      <span className="dot idle" /> Not started
    </span>
  );
}

const ORG_SKILL_MAP = Object.fromEntries(ORG_SKILLS.map((s) => [s.id, s.label]));

function SkillsRow({ emp }: { emp: EmployeeWithTwin }) {
  // Build combined list: org skills first (tagged), then personal skills
  const orgPills = emp.orgSkillIds.map((id) => ({
    id,
    label: ORG_SKILL_MAP[id] ?? id,
    isOrg: true,
  }));
  const personalPills = emp.skills.map((s) => ({ ...s, isOrg: false }));

  const combined = [...orgPills, ...personalPills];
  const visible = combined.slice(0, 3);
  const overflow = combined.length - visible.length;

  return (
    <div>
      <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-6)" }}>
        Skills
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)" }}>
        {visible.map((pill) =>
          pill.isOrg ? (
            <span
              key={"org-" + pill.id}
              title="Org-authoritative skill"
              style={{
                fontSize: "var(--fs-xs)",
                padding: "2px 7px",
                borderRadius: 10,
                background: "var(--accent-soft)",
                color: "var(--accent-deep)",
                border: "1px solid transparent",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
              }}
            >
              <span aria-hidden style={{ fontSize: "var(--fs-2xs)", lineHeight: 1 }}>○</span>
              {pill.label}
            </span>
          ) : (
            <span
              key={"skill-" + pill.id}
              style={{
                fontSize: "var(--fs-xs)",
                padding: "2px 7px",
                borderRadius: 10,
                background: "var(--surface)",
                border: "1px solid var(--hairline)",
                color: "var(--text-muted)",
                display: "inline-flex",
                alignItems: "center",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
              }}
            >
              {pill.label}
            </span>
          )
        )}
        {overflow > 0 && (
          <span
            className="subtle mono"
            style={{
              fontSize: "var(--fs-xs)",
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 4px",
              color: "var(--text-subtle)",
            }}
          >
            +{overflow} more
          </span>
        )}
      </div>
    </div>
  );
}

function EmployeeCard({
  emp,
  isFavorite,
  onToggleFavorite,
}: {
  emp: EmployeeWithTwin;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const dimmed = emp.twinStatus === "pending";
  const visibleIntegrations = emp.integrations.slice(0, 5);
  const overflow = emp.integrations.length - visibleIntegrations.length;

  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-18)",
        position: "relative",
        opacity: dimmed ? 0.7 : 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-14)",
      }}
    >
      {/* Header: avatar + name + favorite */}
      <div className="row" style={{ gap: "var(--sp-12)", alignItems: "flex-start" }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: emp.avatarColor,
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: "var(--fs-ui)",
            color: "var(--text)",
            flexShrink: 0,
          }}
        >
          {emp.initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, letterSpacing: "-0.01em" }}>
            {emp.name}
          </div>
          <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
            {emp.role} · {emp.department}
          </div>
        </div>
        <StarButton active={isFavorite} onToggle={onToggleFavorite} />
      </div>

      {/* Headline quality gauge — proximity to the human employee. */}
      <TwinQualityBar emp={emp} />

      <div className="row" style={{ gap: "var(--sp-6)", flexWrap: "wrap" }}>
        <StatusBadge status={emp.twinStatus} />
        <ConsentPill consented={!!emp.consent} />
        {emp.id.startsWith(MARKETPLACE_ID_PREFIX) && (
          <span
            style={{
              fontSize: "var(--fs-xs)",
              padding: "2px 7px",
              borderRadius: 10,
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
            }}
          >
            <Icons.Store size={9} /> Marketplace
          </span>
        )}
      </div>

      {/* Profile completion */}
      <ProfileBar complete={emp.profileFilesComplete} />

      {/* Skills */}
      <SkillsRow emp={emp} />

      {/* Footer stats */}
      <div
        className="row"
        style={{
          gap: "var(--sp-10)",
          fontSize: "var(--fs-meta)",
          color: "var(--text-subtle)",
          paddingTop: "var(--sp-10)",
          borderTop: "1px solid var(--hairline)",
        }}
      >
        <span>
          <span className="mono">{emp.questionsThisWeek}</span> questions this week
        </span>
        <div className="spacer" />
        <span>
          Last active <span className="mono">{relativeTime(emp.lastActiveAt)}</span>
        </span>
      </div>

      {/* Actions */}
      <div className="row" style={{ gap: "var(--sp-8)" }}>
        {emp.twinStatus === "building" ? (
          <button
            className="btn primary sm"
            disabled
            title="Twin not ready yet"
            style={{
              flex: 1,
              justifyContent: "center",
              opacity: 0.55,
              cursor: "not-allowed",
            }}
          >
            Open chat
          </button>
        ) : (
          <Link
            href={`/flow?employee=${emp.id}`}
            className="btn primary sm"
            style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}
          >
            Open chat
          </Link>
        )}
        <Link
          href={`/profile?employee=${emp.id}`}
          className="btn ghost sm"
          style={{ justifyContent: "center", textDecoration: "none" }}
        >
          Configure
        </Link>
      </div>

      {/* Pending overlay */}
      {dimmed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.0), rgba(255,255,255,0.55))",
            borderRadius: "inherit",
            pointerEvents: "none",
          }}
        >
          <Link
            href={`/onboarding?employee=${emp.id}`}
            className="btn primary"
            style={{
              pointerEvents: "auto",
              textDecoration: "none",
            }}
          >
            <Icons.Plus size={13} /> Start onboarding
          </Link>
        </div>
      )}
    </div>
  );
}

function inviteUrl(token: string): string {
  if (typeof window === "undefined") return `/join?invite=${token}`;
  return `${window.location.origin}/join?invite=${token}`;
}

type SystemConfig = {
  anthropic: boolean;
  composio: boolean;
  ready: boolean;
};

function InvitePanel({
  invites,
  onInvitesChanged,
}: {
  invites: Invite[];
  onInvitesChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  // Block invite creation until both API keys are present. Fetched once
  // on mount; the user has to restart the server after editing .env, so
  // there's no point in polling.
  const [config, setConfig] = useState<SystemConfig | null>(null);
  useEffect(() => {
    fetch("/api/system/config")
      .then((r) => r.json() as Promise<SystemConfig>)
      .then(setConfig)
      .catch(() =>
        setConfig({ anthropic: false, composio: false, ready: false }),
      );
  }, []);

  const pending = invites.filter((i) => !i.completedAt);

  async function createInvite() {
    setCreating(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role: role.trim() }),
      });
      if (!res.ok) throw new Error("create_failed");
      setName("");
      setRole("");
      onInvitesChanged();
    } catch {
      // No-op: a follow-up call to onInvitesChanged() refreshes from the
      // server. Surfacing a toast here would need a toast system this page
      // doesn't have today.
    } finally {
      setCreating(false);
    }
  }

  async function revoke(token: string) {
    try {
      await fetch(`/api/invites/${token}`, { method: "DELETE" });
      onInvitesChanged();
    } catch {
      // ignore — the next refresh will reflect reality
    }
  }

  async function copy(token: string) {
    const url = inviteUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(
        () => setCopiedToken((t) => (t === token ? null : t)),
        1800,
      );
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-16)",
        marginBottom: "var(--sp-20)",
      }}
    >
      <div
        style={{
          fontSize: "var(--fs-sm)",
          fontWeight: 600,
          marginBottom: "var(--sp-10)",
        }}
      >
        Invite an employee
      </div>
      <div
        style={{
          fontSize: "var(--fs-meta)",
          color: "var(--text-subtle)",
          marginBottom: "var(--sp-14)",
        }}
      >
        Generate a one-time link. Share it on Slack, WhatsApp, or however you
        normally reach the person. The link works on this local network only.
      </div>

      {config && !config.ready && (
        <div
          style={{
            padding: "12px 14px",
            marginBottom: "var(--sp-14)",
            background: "rgba(160, 75, 61, 0.08)",
            border: "1px solid rgba(160, 75, 61, 0.32)",
            borderRadius: 6,
            fontSize: "var(--fs-meta)",
            color: "var(--text)",
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Configure API keys before inviting anyone
          </div>
          <div style={{ color: "var(--text-subtle)" }}>
            Missing:{" "}
            <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
              {[
                !config.anthropic && "ANTHROPIC_API_KEY",
                !config.composio && "COMPOSIO_API_KEY",
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
            . Without them the twin can&apos;t think (Anthropic) or use tools
            (Composio) — the employee would fill out a profile that goes
            nowhere. Edit <span className="mono">.env</span> or re-run{" "}
            <span className="mono">npx employee001 setup</span>, then restart
            the server.
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--sp-8)",
          alignItems: "center",
          marginBottom: pending.length ? "var(--sp-14)" : 0,
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          disabled={!config?.ready}
          style={{
            flex: "1 1 200px",
            height: 32,
            padding: "0 10px",
            border: "1px solid var(--hairline-strong)",
            borderRadius: 6,
            background: "var(--surface)",
            fontSize: "var(--fs-sm)",
            opacity: config?.ready ? 1 : 0.55,
          }}
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role (optional)"
          disabled={!config?.ready}
          style={{
            flex: "1 1 200px",
            height: 32,
            padding: "0 10px",
            border: "1px solid var(--hairline-strong)",
            borderRadius: 6,
            background: "var(--surface)",
            fontSize: "var(--fs-sm)",
            opacity: config?.ready ? 1 : 0.55,
          }}
        />
        <button
          type="button"
          onClick={createInvite}
          disabled={creating || !config?.ready}
          className="btn primary"
          style={{ height: 32 }}
          title={
            !config?.ready
              ? "Configure ANTHROPIC_API_KEY and COMPOSIO_API_KEY first"
              : undefined
          }
        >
          <Icons.Plus size={13} /> {creating ? "Creating…" : "Create invite"}
        </button>
      </div>

      {pending.length > 0 && (
        <div style={{ display: "grid", gap: "var(--sp-6)" }}>
          {pending.map((inv) => {
            const url = inviteUrl(inv.token);
            const copied = copiedToken === inv.token;
            return (
              <div
                key={inv.token}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-8)",
                  padding: "8px 10px",
                  background: "var(--bg-sunken)",
                  borderRadius: 6,
                  fontSize: "var(--fs-meta)",
                }}
              >
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--text)" }}>
                    {inv.name || "Unnamed invite"}
                    {inv.role ? ` · ${inv.role}` : ""}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono, ui-monospace, monospace)",
                      color: "var(--text-subtle)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {url}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copy(inv.token)}
                  className="btn ghost"
                  style={{ height: 28, fontSize: "var(--fs-meta)" }}
                >
                  {copied ? <Icons.Check size={12} /> : null}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => revoke(inv.token)}
                  className="btn ghost"
                  style={{
                    height: 28,
                    fontSize: "var(--fs-meta)",
                    color: "var(--danger, #A04B3D)",
                  }}
                  title="Revoke this invite — link stops working immediately"
                >
                  Revoke
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EmployeesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const refreshInvites = useCallback(() => {
    fetch("/api/invites")
      .then((r) => r.json())
      .then((data: { invites?: Invite[] }) => setInvites(data.invites ?? []))
      .catch(() => setInvites([]));
  }, []);
  useEffect(refreshInvites, [refreshInvites]);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [allEmployees, setAllEmployees] = useState<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);

  // Fetch all employees (static + hired marketplace agents)
  useEffect(() => {
    fetch("/api/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: EmployeeWithTwin[]) => setAllEmployees(data))
      .catch(() => {/* fallback to static */});
  }, []);

  // Hydrate favorites from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setFavorites(new Set(arr));
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const stats = useMemo(() => {
    const total = allEmployees.length;
    const ready = allEmployees.filter((e) => e.twinStatus === "ready").length;
    const building = allEmployees.filter((e) => e.twinStatus === "building").length;
    const questions = allEmployees.reduce((s, e) => s + e.questionsThisWeek, 0);
    return { total, ready, building, questions };
  }, [allEmployees]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = allEmployees;

    if (filter === "favorites") {
      list = list.filter((e) => favorites.has(e.id));
    } else if (filter !== "all") {
      list = list.filter((e) => e.twinStatus === filter);
    }

    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.role.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
      );
    }

    // Favorites first, preserving original order otherwise
    return [...list].sort((a, b) => {
      const af = favorites.has(a.id) ? 0 : 1;
      const bf = favorites.has(b.id) ? 0 : 1;
      return af - bf;
    });
  }, [filter, query, favorites, allEmployees]);

  return (
    <>
      <Topbar
        crumbs={["Employees"]}
        actions={
          <div style={{ display: "flex", gap: "var(--sp-8)" }}>
            <Link href="/marketplace" className="btn ghost" style={{ textDecoration: "none" }}>
              <Icons.Store size={13} /> Marketplace
            </Link>
            <a
              href="#invite"
              className="btn primary"
              style={{ textDecoration: "none" }}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById("invite")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Icons.Plus size={13} /> Invite employee
            </a>
          </div>
        }
      />
      <div
        className="scrollbar"
        style={{ flex: 1, overflow: "auto", padding: "32px 40px 80px" }}
      >
        <PageHead
          icon="Home"
          title="Employees"
          subtitle="Browse twins in the workspace, check readiness, and jump into chat, profile, or onboarding."
          style={{ marginBottom: "var(--sp-28)" }}
        />

        {/* Stat strip */}
        <div
          className="card"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            marginBottom: "var(--sp-28)",
          }}
        >
          <Stat
            label="Total employees"
            value={stats.total}
            hint="In workspace"
            tone="idle"
          />
          <Stat
            label="Twins ready"
            value={stats.ready}
            hint="Answering live"
            tone="success"
            border
          />
          <Stat
            label="Twins building"
            value={stats.building}
            hint="Profile in progress"
            tone="warn"
            border
          />
          <Stat
            label="Questions this week"
            value={stats.questions}
            hint="Across all twins"
            tone="idle"
            border
          />
        </div>

        {/* Invite panel — anchored so the topbar CTA can scroll to it */}
        <div id="invite">
          <InvitePanel invites={invites} onInvitesChanged={refreshInvites} />
        </div>

        {/* Search + filter row */}
        <div
          className="row"
          style={{ marginBottom: "var(--sp-18)", gap: "var(--sp-10)", flexWrap: "wrap" }}
        >
          {/* Search */}
          <div
            className="row"
            style={{
              gap: "var(--sp-8)",
              padding: "0 12px",
              height: 32,
              border: "1px solid var(--hairline-strong)",
              borderRadius: 6,
              background: "var(--surface)",
              minWidth: 260,
              flex: "1 0 260px",
              maxWidth: 360,
            }}
          >
            <Icons.Search size={13} style={{ color: "var(--text-subtle)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, role, or department"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: "var(--fs-ui)",
                color: "var(--text)",
                fontFamily: "inherit",
                minWidth: 0,
              }}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                title="Clear"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-subtle)",
                  display: "grid",
                  placeItems: "center",
                  padding: 0,
                }}
              >
                <Icons.X size={12} />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="row" style={{ gap: "var(--sp-6)" }}>
            {(
              [
                ["all", "All"],
                ["favorites", "★ Favorites"],
                ["ready", "Ready"],
                ["building", "Building"],
                ["pending", "Pending"],
              ] as [FilterKey, string][]
            ).map(([k, l]) => {
              const isFav = k === "favorites";
              const active = filter === k;
              return (
                <button
                  key={k}
                  className="btn sm"
                  onClick={() => setFilter(k)}
                  style={{
                    background: active ? "var(--text)" : "var(--surface)",
                    color: active
                      ? "var(--bg)"
                      : isFav
                        ? "var(--accent-deep)"
                        : "var(--text-muted)",
                    borderColor: active ? "var(--text)" : "var(--hairline-strong)",
                  }}
                >
                  {l}
                  {isFav && favorites.size > 0 && !active && (
                    <span
                      className="mono"
                      style={{
                        fontSize: "var(--fs-xs)",
                        marginLeft: "var(--sp-4)",
                        opacity: 0.7,
                      }}
                    >
                      {favorites.size}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="spacer" />
          <span className="subtle mono" style={{ fontSize: "var(--fs-meta)" }}>
            {visible.length} employees
          </span>
        </div>

        {/* Employees grid */}
        {visible.length === 0 ? (
          <div
            className="card"
            style={{
              padding: 60,
              textAlign: "center",
              color: "var(--text-subtle)",
            }}
          >
            <Icons.Search size={20} style={{ marginBottom: "var(--sp-10)", opacity: 0.5 }} />
            <div style={{ fontSize: "var(--fs-ui)" }}>
              {allEmployees.length === 0
                ? "No employees onboarded yet. Create an invite above and share the link with the first person you want a twin of."
                : `No employees match ${query ? `"${query}"` : "this filter"}.`}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "var(--sp-16)",
            }}
          >
            {visible.map((emp) => (
              <EmployeeCard
                key={emp.id}
                emp={emp}
                isFavorite={favorites.has(emp.id)}
                onToggleFavorite={() => toggleFavorite(emp.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
