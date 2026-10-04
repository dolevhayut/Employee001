"use client";

import Link from "next/link";
import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Star } from "iconoir-react";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { Topbar } from "@/components/ex/shell";
import { useT } from "@/components/ex/i18n-context";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/messages";
import { INTEGRATIONS as INTEGRATION_META } from "@/lib/demo";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { OrgChart } from "@/components/ex/org-chart";
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

// Favorites live in localStorage and are shared as an external store so the
// client can hydrate from them without a mount-time setState. getSnapshot
// caches by the raw string, so the returned Set keeps a stable identity until
// the stored value actually changes (required by useSyncExternalStore).
const favoritesListeners = new Set<() => void>();
let favoritesCache: { raw: string; set: Set<string> } | null = null;
const FAVORITES_SERVER_SNAPSHOT: Set<string> = new Set();

function favoritesSubscribe(cb: () => void): () => void {
  favoritesListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    favoritesListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function favoritesSnapshot(): Set<string> {
  let raw = "";
  try {
    raw = localStorage.getItem(FAVORITES_KEY) ?? "";
  } catch {
    raw = "";
  }
  if (!favoritesCache || favoritesCache.raw !== raw) {
    let set: Set<string>;
    try {
      set = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      set = new Set();
    }
    favoritesCache = { raw, set };
  }
  return favoritesCache.set;
}

function favoritesServerSnapshot(): Set<string> {
  return FAVORITES_SERVER_SNAPSHOT;
}

function writeFavorites(next: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
  } catch {
    // ignore
  }
  favoritesListeners.forEach((cb) => cb());
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
  const { t } = useT();
  return (
    <button
      onClick={onToggle}
      title={active ? t("twins.fav.remove") : t("twins.fav.add")}
      aria-label={active ? t("twins.fav.removeAria") : t("twins.fav.addAria")}
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
        borderInlineStart: border ? "1px solid var(--hairline)" : "none",
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
        <bdi>{value}</bdi>
      </div>
      <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
        {hint}
      </div>
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const { t } = useT();
  const pct = Math.round(value * 100);
  const tone = value >= 0.85 ? "success" : value >= 0.7 ? "warn" : "danger";
  return (
    <span className={"badge " + tone} style={{ fontSize: "var(--fs-xs)" }}>
      <span className={"dot " + tone} style={{ boxShadow: "none" }} />
      <bdi>{t("twins.confidence", { pct })}</bdi>
    </span>
  );
}

// ─── Twin Quality ────────────────────────────────────────────────────────────
//
// One headline number per twin so the CEO can scan the grid and instantly
// see which twins are mature, half-baked, or untrained. Combines four
// existing signals; deliberately simple and explainable rather than ML-y.

const TWIN_PROFILE_FILE_TARGET = 9;

type QualityBreakdown = { labelKey: MessageKey; weight: number; value01: number };

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
    { labelKey: "twins.quality.model", weight: 50, value01: emp.twinConfidence },
    {
      labelKey: "twins.quality.profile",
      weight: 30,
      value01: Math.min(emp.profileFilesComplete, TWIN_PROFILE_FILE_TARGET) / TWIN_PROFILE_FILE_TARGET,
    },
    { labelKey: "twins.quality.consent", weight: 10, value01: emp.consent ? 1 : 0 },
    { labelKey: "twins.quality.activity", weight: 10, value01: recencyTo01(emp.lastActiveAt) },
  ];

  const score = Math.round(
    breakdown.reduce((acc, b) => acc + b.value01 * b.weight, 0)
  );
  const grade = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
  return { score, grade, breakdown };
}

const QUALITY_THEME: Record<
  "high" | "medium" | "low" | "empty",
  { labelKey: MessageKey; fg: string; bgSoft: string; track: string }
> = {
  high: {
    labelKey: "twins.quality.human",
    fg: "var(--success)",
    bgSoft: "color-mix(in oklch, var(--success) 12%, transparent)",
    track: "color-mix(in oklch, var(--success) 20%, transparent)",
  },
  medium: {
    labelKey: "twins.quality.developing",
    fg: "var(--warn)",
    bgSoft: "color-mix(in oklch, var(--warn) 12%, transparent)",
    track: "color-mix(in oklch, var(--warn) 20%, transparent)",
  },
  low: {
    labelKey: "twins.quality.low",
    fg: "var(--danger)",
    bgSoft: "color-mix(in oklch, var(--danger) 12%, transparent)",
    track: "color-mix(in oklch, var(--danger) 20%, transparent)",
  },
  empty: {
    labelKey: "twins.quality.empty",
    fg: "var(--text-subtle)",
    bgSoft: "var(--bg-sunken)",
    track: "var(--hairline)",
  },
};

function TwinQualityBar({ emp }: { emp: EmployeeWithTwin }) {
  const { t } = useT();
  const { score, grade, breakdown } = computeTwinQuality(emp);
  const theme = QUALITY_THEME[grade];
  const gradeLabel = t(theme.labelKey);

  // Compact tooltip listing each component's contribution.
  const tooltip =
    breakdown.length > 0
      ? `${t("twins.quality.tooltip", { name: emp.name.split(" ")[0] })}\n\n` +
        breakdown
          .map((b) =>
            t("twins.quality.part", {
              label: t(b.labelKey),
              pct: Math.round(b.value01 * 100),
              weight: b.weight,
            }),
          )
          .join("\n")
      : t("twins.quality.unbuilt");

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
        <bdi>{score === null ? "—" : score}</bdi>
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
          {t("twins.quality.heading", { grade: gradeLabel })}
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
  const { t } = useT();
  if (consented) {
    return (
      <span
        className="badge"
        style={{ fontSize: "var(--fs-xs)" }}
        title={t("twins.consent.yesTitle")}
      >
        <Icons.Check size={9} /> {t("twins.consent.yes")}
      </span>
    );
  }
  return (
    <span
      className="badge warn"
      style={{ fontSize: "var(--fs-xs)" }}
      title={t("twins.consent.noTitle")}
    >
      <span className="dot warn" style={{ boxShadow: "none" }} />
      {t("twins.consent.no")}
    </span>
  );
}

function ProfileBar({ complete }: { complete: number }) {
  const { t } = useT();
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
        <bdi>{clamped} / {total}</bdi> {t("twins.profile.files")}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TwinStatus }) {
  const { t } = useT();
  if (status === "ready") {
    return (
      <span className="badge success">
        <span className="dot success" style={{ boxShadow: "none" }} /> {t("twins.status.ready")}
      </span>
    );
  }
  if (status === "building") {
    return (
      <span className="badge warn">
        <Icons.Refresh size={10} className="spin" /> {t("twins.status.building")}
      </span>
    );
  }
  return (
    <span className="badge">
      <span className="dot idle" /> {t("twins.status.notStarted")}
    </span>
  );
}

const ORG_SKILL_MAP = Object.fromEntries(ORG_SKILLS.map((s) => [s.id, s.label]));

function SkillsRow({ emp }: { emp: EmployeeWithTwin }) {
  const { t } = useT();
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
        {t("twins.skills.title")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)" }}>
        {visible.map((pill) =>
          pill.isOrg ? (
            <span
              key={"org-" + pill.id}
              title={t("twins.skills.orgTitle")}
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
              <bdi>{pill.label}</bdi>
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
              <bdi>{pill.label}</bdi>
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
            <bdi>+{overflow}</bdi> {t("twins.skills.more")}
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
  const { t, locale } = useT();
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
            <bdi>{emp.name}</bdi>
          </div>
          <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
            <bdi>{emp.role}</bdi> · <bdi>{emp.department}</bdi>
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
            <Icons.Store size={9} /> {t("twins.action.marketplace")}
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
          <span className="mono"><bdi>{emp.questionsThisWeek}</bdi></span> {t("twins.card.questions")}
        </span>
        <div className="spacer" />
        <span>
          {t("twins.card.lastActive")} <span className="mono"><bdi>{formatRelativeTime(emp.lastActiveAt, locale)}</bdi></span>
        </span>
      </div>

      {/* Actions */}
      <div className="row" style={{ gap: "var(--sp-8)" }}>
        {emp.twinStatus === "building" ? (
          <button
            className="btn primary sm"
            disabled
            title={t("twins.card.notReady")}
            style={{
              flex: 1,
              justifyContent: "center",
              opacity: 0.55,
              cursor: "not-allowed",
            }}
          >
            {t("twins.card.chat")}
          </button>
        ) : (
          <Link
            href={`/flow?employee=${emp.id}`}
            className="btn primary sm"
            style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}
          >
            {t("twins.card.chat")}
          </Link>
        )}
        <Link
          href={`/profile?employee=${emp.id}`}
          className="btn ghost sm"
          style={{ justifyContent: "center", textDecoration: "none" }}
        >
          {t("twins.card.configure")}
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
            <Icons.Plus size={13} /> {t("twins.card.onboarding")}
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

/**
 * Renders the "you're missing keys to invite anyone" banner with inline
 * inputs so the CEO can paste the missing key + save without leaving the
 * page. PATCHes /api/system/config which writes .env AND updates
 * process.env — both the Anthropic invite gate and the Composio client
 * re-read on every request, so no restart needed.
 */
function MissingKeysCard({
  config,
  onSaved,
}: {
  config: SystemConfig;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [anthropicVal, setAnthropicVal] = useState("");
  const [composioVal, setComposioVal] = useState("");
  const [saving, setSaving] = useState<null | "anthropic" | "composio">(null);
  const [error, setError] = useState<string | null>(null);

  async function save(key: "ANTHROPIC_API_KEY" | "COMPOSIO_API_KEY", value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(key === "ANTHROPIC_API_KEY" ? "anthropic" : "composio");
    setError(null);
    try {
      const res = await fetch("/api/system/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? t("twins.keys.saveFailed", { status: res.status }));
      }
      if (key === "ANTHROPIC_API_KEY") setAnthropicVal("");
      else setComposioVal("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.status.saveFailed"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div
      style={{
        padding: "14px 16px",
        marginBottom: "var(--sp-14)",
        background: "rgba(160, 75, 61, 0.08)",
        border: "1px solid rgba(160, 75, 61, 0.32)",
        borderRadius: 8,
        fontSize: "var(--fs-meta)",
        color: "var(--text)",
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: "var(--fs-sm)" }}>
        {t("twins.keys.title")}
      </div>
      <div style={{ color: "var(--text-subtle)", marginBottom: 12 }}>
        {t("twins.keys.bodyBefore")}{" "}
        <span className="mono"><bdi>.env</bdi></span>
        {t("twins.keys.bodyAfter")}
      </div>

      {!config.anthropic && (
        <KeyRow
          label={t("twins.keys.anthropic")}
          hint={
            <>
              <bdi>https://console.anthropic.com</bdi>
              {" — "}
              {t("twins.keys.anthropicRest")}
              <bdi>sk-ant-</bdi>
            </>
          }
          placeholder="sk-ant-…"
          value={anthropicVal}
          onChange={setAnthropicVal}
          onSave={() => save("ANTHROPIC_API_KEY", anthropicVal)}
          saving={saving === "anthropic"}
          disabled={!!saving}
        />
      )}

      {!config.composio && (
        <KeyRow
          label={t("twins.keys.composio")}
          hint={
            <>
              <bdi>https://app.composio.dev</bdi>
              {" — "}
              {t("twins.keys.composioRest")}
            </>
          }
          placeholder={t("twins.keys.composioPh")}
          value={composioVal}
          onChange={setComposioVal}
          onSave={() => save("COMPOSIO_API_KEY", composioVal)}
          saving={saving === "composio"}
          disabled={!!saving}
        />
      )}

      {error && (
        <div style={{ marginTop: 8, color: "var(--danger)", fontSize: "var(--fs-meta)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function KeyRow({
  label,
  hint,
  placeholder,
  value,
  onChange,
  onSave,
  saving,
  disabled,
}: {
  label: string;
  hint: ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
}) {
  const { t } = useT();
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-subtle)" }}>{hint}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSave();
          }}
          style={{
            flex: 1,
            height: 32,
            padding: "0 10px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: "var(--fs-meta)",
            color: "var(--text)",
          }}
        />
        <button
          onClick={onSave}
          disabled={disabled || !value.trim()}
          className="btn sm"
          style={{
            height: 32,
            opacity: !value.trim() ? 0.5 : 1,
            cursor: !value.trim() ? "not-allowed" : "pointer",
          }}
        >
          {saving ? t("settings.action.saving") : t("settings.action.save")}
        </button>
      </div>
    </div>
  );
}

function InvitePanel({
  invites,
  onInvitesChanged,
}: {
  invites: Invite[];
  onInvitesChanged: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [lookbackDays, setLookbackDays] = useState(90);
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
  // Snapshot "now" once for this panel's lifetime — expiry is measured in
  // days, so a per-render clock read would be needless (and impure in render).
  const [now] = useState(() => Date.now());

  async function createInvite() {
    setCreating(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim(),
          lookbackDays,
        }),
      });
      if (!res.ok) throw new Error("create_failed");
      setName("");
      setRole("");
      setLookbackDays(90);
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

  async function bulkRevoke(scope: "expired" | "unused", count: number) {
    if (count === 0) return;
    const ok = window.confirm(
      t(
        scope === "expired"
          ? count === 1
            ? "twins.invite.confirmExpiredOne"
            : "twins.invite.confirmExpiredMany"
          : count === 1
            ? "twins.invite.confirmUnusedOne"
            : "twins.invite.confirmUnusedMany",
        { count },
      ),
    );
    if (!ok) return;
    try {
      await fetch("/api/invites/bulk-revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      onInvitesChanged();
    } catch {
      /* next refresh fixes UI */
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
      window.prompt(t("twins.invite.copyPrompt"), url);
    }
  }

  const ready = !!config?.ready;
  const inputStyle = {
    height: 40,
    padding: "0 12px",
    border: "1px solid var(--hairline-strong)",
    borderRadius: "var(--radius-lg)",
    background: "var(--surface)",
    fontSize: "var(--fs-ui)",
    color: "var(--text)",
    fontFamily: "inherit",
    width: "100%",
    opacity: ready ? 1 : 0.55,
  };

  // Human label for the lookback window so the raw number has meaning.
  const tier =
    lookbackDays <= 30
      ? t("twins.invite.tier.light")
      : lookbackDays <= 90
        ? t("twins.invite.tier.standard")
        : lookbackDays <= 180
          ? t("twins.invite.tier.deep")
          : t("twins.invite.tier.full");
  const cost = (0.005 * lookbackDays).toFixed(2);
  const totalSec = 2 * lookbackDays;
  const estMins = Math.floor(totalSec / 60);
  const estSecs = totalSec % 60;
  const timeStr =
    estMins > 0
      ? estSecs > 0
        ? t("twins.invite.timeMinSec", { min: estMins, sec: estSecs })
        : t("twins.invite.timeMin", { min: estMins })
      : t("twins.invite.timeSec", { sec: estSecs });

  return (
    <div style={{ display: "grid", gap: "var(--sp-20)" }}>
      {/* ── Composer ──────────────────────────────────────────── */}
      <div className="card" style={{ padding: "var(--sp-24)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--sp-14)",
            marginBottom: "var(--sp-20)",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--radius-lg)",
              background: "var(--accent-soft)",
              border: "1px solid var(--hairline)",
            }}
          >
            <Icons.UserPlus size={18} style={{ color: "var(--text)" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: "var(--fs-lg)",
                fontWeight: 600,
                letterSpacing: "var(--ls-snug)",
              }}
            >
              {t("twins.invite.title")}
            </h2>
            <p
              style={{
                margin: "var(--sp-6) 0 0",
                fontSize: "var(--fs-sm)",
                color: "var(--text-muted)",
                lineHeight: 1.6,
                maxWidth: 640,
              }}
            >
              {t("twins.invite.leadBefore")} <bdi>Slack</bdi>, <bdi>WhatsApp</bdi>{t("twins.invite.leadAfter")}
            </p>
          </div>
        </div>

        {config && !config.ready && (
          <MissingKeysCard
            config={config}
            onSaved={() => {
              // Re-fetch the gate state so the form unlocks immediately.
              fetch("/api/system/config")
                .then((r) => r.json() as Promise<SystemConfig>)
                .then(setConfig)
                .catch(() => {});
            }}
          />
        )}

        {/* Name + role */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "var(--sp-14)",
            marginBottom: "var(--sp-18)",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-6)",
            }}
          >
            <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>
              {t("twins.invite.name")}{" "}
              <span
                style={{
                  fontWeight: 500,
                  color: "var(--text-subtle)",
                  fontSize: "var(--fs-xs)",
                }}
              >
                {t("twins.invite.optional")}
              </span>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("twins.invite.namePh")}
              disabled={!ready}
              style={inputStyle}
            />
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-6)",
            }}
          >
            <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>
              {t("twins.invite.role")}{" "}
              <span
                style={{
                  fontWeight: 500,
                  color: "var(--text-subtle)",
                  fontSize: "var(--fs-xs)",
                }}
              >
                {t("twins.invite.optional")}
              </span>
            </span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t("twins.invite.rolePh")}
              disabled={!ready}
              style={inputStyle}
            />
          </label>
        </div>

        {/* Lookback */}
        <div
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-lg)",
            background: "var(--surface-soft)",
            padding: "var(--sp-16) var(--sp-18)",
            marginBottom: "var(--sp-20)",
            opacity: ready ? 1 : 0.55,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "var(--sp-12)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>
                {t("twins.invite.lookback")}
              </div>
              <div
                style={{
                  fontSize: "var(--fs-xs)",
                  color: "var(--text-subtle)",
                  marginTop: 2,
                  maxWidth: 360,
                  lineHeight: 1.5,
                }}
              >
                {t("twins.invite.lookbackHint")}
              </div>
            </div>
            <div style={{ textAlign: "end", flexShrink: 0 }}>
              <div
                style={{
                  fontSize: "var(--fs-h3)",
                  fontWeight: 600,
                  lineHeight: 1.1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <bdi>{lookbackDays}</bdi>
                <span
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--text-subtle)",
                    fontWeight: 500,
                  }}
                >
                  {" "}
                  {t("twins.invite.days")}
                </span>
              </div>
              <div
                style={{
                  fontSize: "var(--fs-2xs)",
                  color: "var(--accent-deep)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "var(--ls-wide)",
                }}
              >
                {tier}
              </div>
            </div>
          </div>

          {/* Presets */}
          <div
            style={{
              display: "flex",
              gap: "var(--sp-6)",
              marginTop: "var(--sp-12)",
            }}
          >
            {([
              [30, "twins.invite.preset30"],
              [90, "twins.invite.preset90"],
              [180, "twins.invite.preset180"],
              [360, "twins.invite.presetYear"],
            ] as [number, MessageKey][]).map(([val, lbl]) => {
              const on = lookbackDays === val;
              return (
                <button
                  key={val}
                  type="button"
                  disabled={!ready}
                  onClick={() => setLookbackDays(val)}
                  style={{
                    flex: 1,
                    padding: "7px 8px",
                    borderRadius: "var(--radius)",
                    border: `1px solid ${on ? "var(--text)" : "var(--hairline-strong)"}`,
                    background: on ? "var(--text)" : "var(--surface)",
                    color: on ? "var(--bg)" : "var(--text-muted)",
                    fontSize: "var(--fs-sm)",
                    fontWeight: on ? 600 : 500,
                    fontFamily: "inherit",
                    cursor: ready ? "pointer" : "not-allowed",
                  }}
                >
                  <bdi>{t(lbl)}</bdi>
                </button>
              );
            })}
          </div>

          <input
            id="lookback-days"
            type="range"
            min={30}
            max={360}
            step={30}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
            disabled={!ready}
            style={{
              width: "100%",
              marginTop: "var(--sp-12)",
              accentColor: "var(--text)",
              cursor: ready ? "pointer" : "not-allowed",
            }}
          />

          {/* Cost + time estimates */}
          <div
            style={{
              display: "flex",
              gap: "var(--sp-8)",
              marginTop: "var(--sp-14)",
            }}
          >
            {[
              {
                icon: <Icons.DollarSign size={14} />,
                label: t("twins.invite.cost"),
                val: <bdi>{`~ $${cost}`}</bdi>,
              },
              {
                icon: <Icons.Clock size={14} />,
                label: t("twins.invite.time"),
                val: <bdi>{timeStr}</bdi>,
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-8)",
                  padding: "8px 12px",
                  background: "var(--surface)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                }}
              >
                <span style={{ color: "var(--text-subtle)", display: "grid" }}>
                  {s.icon}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--fs-2xs)",
                      color: "var(--text-subtle)",
                      textTransform: "uppercase",
                      letterSpacing: "var(--ls-wide)",
                      fontWeight: 600,
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--fs-sm)",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {s.val}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              fontSize: "var(--fs-2xs)",
              color: "var(--text-subtle)",
              marginTop: "var(--sp-8)",
            }}
          >
            {t("twins.invite.estimateNote")}
          </div>
        </div>

        <button
          type="button"
          onClick={createInvite}
          disabled={creating || !ready}
          className="btn primary lg"
          style={{ width: "100%", justifyContent: "center" }}
          title={
            !ready
              ? t("twins.invite.needKeys")
              : undefined
          }
        >
          {creating ? (
            <>
              <Icons.Loader size={14} /> {t("twins.invite.creating")}
            </>
          ) : (
            <>
              <Icons.Plus size={14} /> {t("twins.invite.create")}
            </>
          )}
        </button>
      </div>

      {/* ── Pending invites ───────────────────────────────────── */}
      {pending.length > 0 ? (
        <div className="card" style={{ padding: "var(--sp-20)" }}>
          {(() => {
            const expiredCount = pending.filter(
              (i) => new Date(i.expiresAt).getTime() < now,
            ).length;
            const unusedCount = pending.filter((i) => !i.employeeId).length;
            const showBulk = expiredCount > 0 || unusedCount > 0;
            return (
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--sp-12)",
                  marginBottom: "var(--sp-14)",
                  flexWrap: "wrap",
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: "var(--fs-ui)",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--sp-8)",
                  }}
                >
                  {t("twins.invite.pending")}
                  <span
                    className="mono"
                    style={{
                      fontSize: "var(--fs-xs)",
                      padding: "1px 7px",
                      borderRadius: 8,
                      background: "var(--bg-sunken)",
                      color: "var(--text-subtle)",
                    }}
                  >
                    <bdi>{pending.length}</bdi>
                  </span>
                </h3>
                {showBulk && (
                  <div
                    style={{
                      display: "flex",
                      gap: "var(--sp-6)",
                      alignItems: "center",
                    }}
                  >
                    {expiredCount > 0 && (
                      <button
                        type="button"
                        onClick={() => bulkRevoke("expired", expiredCount)}
                        className="btn ghost sm"
                        style={{ color: "var(--danger)" }}
                        title={t(
                          expiredCount === 1
                            ? "twins.invite.clearExpiredTitleOne"
                            : "twins.invite.clearExpiredTitleMany",
                          { count: expiredCount },
                        )}
                      >
                        {t("twins.invite.clearExpired")} (<bdi>{expiredCount}</bdi>)
                      </button>
                    )}
                    {unusedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => bulkRevoke("unused", unusedCount)}
                        className="btn ghost sm"
                        style={{ color: "var(--danger)" }}
                        title={t(
                          unusedCount === 1
                            ? "twins.invite.clearUnusedTitleOne"
                            : "twins.invite.clearUnusedTitleMany",
                          { count: unusedCount },
                        )}
                      >
                        {t("twins.invite.clearUnused")} (<bdi>{unusedCount}</bdi>)
                      </button>
                    )}
                  </div>
                )}
              </header>
            );
          })()}

          <div style={{ display: "grid", gap: "var(--sp-8)" }}>
            {pending.map((inv) => {
              const url = inviteUrl(inv.token);
              const copied = copiedToken === inv.token;
              const started = !!inv.employeeId;
              const expired = new Date(inv.expiresAt).getTime() < now;
              const status = started
                ? { cls: "success", label: t("twins.invite.inProgress"), color: "var(--success)" }
                : expired
                  ? { cls: "danger", label: t("twins.invite.expired"), color: "var(--danger)" }
                  : { cls: "idle", label: t("twins.invite.waiting"), color: "var(--text-subtle)" };
              return (
                <div
                  key={inv.token}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-12)",
                    padding: "var(--sp-12) var(--sp-14)",
                    background: "var(--bg-sunken)",
                    borderRadius: "var(--radius-lg)",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    title={
                      started
                        ? t("twins.invite.startedTitle")
                        : expired
                          ? t("twins.invite.expiredTitle")
                          : t("twins.invite.waitingTitle")
                    }
                    style={{ flexShrink: 0, display: "grid" }}
                  >
                    <span
                      className={`dot ${status.cls}`}
                      style={{ boxShadow: "none" }}
                    />
                  </span>

                  <div
                    style={{
                      minWidth: 0,
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--sp-8)",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "var(--fs-sm)",
                          color: "var(--text)",
                        }}
                      >
                        <bdi>{inv.name || t("twins.invite.unnamed")}</bdi>
                        {inv.role ? (
                          <span
                            style={{
                              fontWeight: 500,
                              color: "var(--text-subtle)",
                            }}
                          >
                            {" "}
                            · <bdi>{inv.role}</bdi>
                          </span>
                        ) : null}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--fs-2xs)",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "var(--ls-wide)",
                          color: status.color,
                          padding: "1px 6px",
                          borderRadius: 6,
                          background: "var(--surface)",
                          border: "1px solid var(--hairline)",
                        }}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        color: "var(--text-subtle)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: "var(--fs-xs)",
                      }}
                    >
                      <bdi>{url}</bdi>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => copy(inv.token)}
                    className="btn sm"
                    style={{ flexShrink: 0 }}
                    title={t("twins.invite.shareTitle")}
                  >
                    {copied ? (
                      <Icons.Check size={12} />
                    ) : (
                      <Icons.Send size={12} />
                    )}
                    {copied ? t("twins.invite.copied") : t("twins.invite.share")}
                  </button>

                  {started && (
                    <a
                      href={`/join?invite=${encodeURIComponent(inv.token)}&done=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn ghost sm"
                      style={{ textDecoration: "none", flexShrink: 0 }}
                      title={t("twins.invite.watchTitle")}
                    >
                      <Icons.Eye size={12} /> {t("twins.invite.watch")}
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => revoke(inv.token)}
                    className="btn ghost sm"
                    style={{ color: "var(--danger)", flexShrink: 0 }}
                    title={t("twins.invite.revokeTitle")}
                  >
                    <Icons.Trash size={12} /> {t("twins.invite.revoke")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        ready && (
          <div
            className="card"
            style={{
              padding: "var(--sp-28) var(--sp-24)",
              textAlign: "center",
              color: "var(--text-subtle)",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                margin: "0 auto var(--sp-10)",
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                background: "var(--bg-sunken)",
              }}
            >
              <Icons.Send size={16} style={{ color: "var(--text-subtle)" }} />
            </div>
            <div
              style={{
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                color: "var(--text-muted)",
              }}
            >
              {t("twins.invite.none")}
            </div>
            <div style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>
              {t("twins.invite.noneHint")}
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default function EmployeesPage() {
  const { t } = useT();
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
  const favorites = useSyncExternalStore(
    favoritesSubscribe,
    favoritesSnapshot,
    favoritesServerSnapshot,
  );
  const [allEmployees, setAllEmployees] = useState<EmployeeWithTwin[]>(EMPLOYEES_WITH_TWIN);
  const [tab, setTab] = useState<"people" | "org" | "invites">("people");

  const pendingInvites = useMemo(
    () => invites.filter((i) => !i.completedAt).length,
    [invites],
  );

  // Fetch all employees (static + hired marketplace agents)
  useEffect(() => {
    fetch("/api/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: EmployeeWithTwin[]) => setAllEmployees(data))
      .catch(() => {/* fallback to static */});
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    const next = new Set(favoritesSnapshot());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeFavorites(next);
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
        crumbs={[t("nav.twins")]}
        actions={
          <div style={{ display: "flex", gap: "var(--sp-8)" }}>
            <Link href="/marketplace" className="btn ghost" style={{ textDecoration: "none" }}>
              <Icons.Store size={13} /> {t("twins.action.marketplace")}
            </Link>
            <button
              type="button"
              className="btn primary"
              style={{ textDecoration: "none" }}
              onClick={() => setTab("invites")}
            >
              <Icons.Plus size={13} /> {t("twins.action.invite")}
            </button>
          </div>
        }
      />
      <div
        className="scrollbar"
        style={{ flex: 1, overflow: "auto", padding: "32px 40px 80px" }}
      >
        <PageHead
          icon="Home"
          title={t("twins.page.title")}
          subtitle={t("twins.page.subtitle")}
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
            label={t("twins.stat.total")}
            value={stats.total}
            hint={t("twins.stat.totalHint")}
            tone="idle"
          />
          <Stat
            label={t("twins.stat.ready")}
            value={stats.ready}
            hint={t("twins.stat.readyHint")}
            tone="success"
            border
          />
          <Stat
            label={t("twins.stat.building")}
            value={stats.building}
            hint={t("twins.stat.buildingHint")}
            tone="warn"
            border
          />
          <Stat
            label={t("twins.stat.questions")}
            value={stats.questions}
            hint={t("twins.stat.questionsHint")}
            tone="idle"
            border
          />
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label={t("twins.tabs.aria")}
          style={{
            display: "flex",
            gap: "var(--sp-2)",
            borderBottom: "1px solid var(--hairline)",
            marginBottom: "var(--sp-20)",
          }}
        >
          {(
            [
              ["people", t("twins.tab.people"), allEmployees.length],
              ["org", t("twins.tab.org"), null],
              ["invites", t("twins.tab.invites"), pendingInvites || null],
            ] as [typeof tab, string, number | null][]
          ).map(([key, label, count]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${active ? "var(--text)" : "transparent"}`,
                  padding: "10px 14px",
                  marginBottom: -1,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "var(--fs-ui)",
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text)" : "var(--text-subtle)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--sp-6)",
                }}
              >
                {label}
                {count !== null && count !== undefined && (
                  <span
                    className="mono"
                    style={{
                      fontSize: "var(--fs-xs)",
                      padding: "1px 6px",
                      borderRadius: 8,
                      background: "var(--bg-sunken)",
                      color: "var(--text-subtle)",
                    }}
                  >
                    <bdi>{count}</bdi>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "org" && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <OrgChart employees={allEmployees} />
          </div>
        )}

        {tab === "invites" && (
          <InvitePanel invites={invites} onInvitesChanged={refreshInvites} />
        )}

        {tab === "people" && (
        <>
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
              placeholder={t("twins.search.placeholder")}
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
                title={t("twins.search.clear")}
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
                ["all", t("twins.filter.all")],
                ["favorites", t("twins.filter.favorites")],
                ["ready", t("twins.filter.ready")],
                ["building", t("twins.filter.building")],
                ["pending", t("twins.filter.pending")],
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
                        marginInlineStart: "var(--sp-4)",
                        opacity: 0.7,
                      }}
                    >
                      <bdi>{favorites.size}</bdi>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="spacer" />
          <span className="subtle mono" style={{ fontSize: "var(--fs-meta)" }}>
            <bdi>{visible.length}</bdi>{" "}
            {t(visible.length === 1 ? "twins.countOne" : "twins.countMany")}
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
                ? t("twins.empty.none")
                : query
                  ? <>{t("twins.empty.noMatchBefore")} <bdi>&quot;{query}&quot;</bdi>.</>
                  : t("twins.empty.noMatchFilter")}
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
        </>
        )}
      </div>
    </>
  );
}
