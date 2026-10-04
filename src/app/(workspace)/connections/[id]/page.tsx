"use client";

import { useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check } from "iconoir-react";
import { Topbar } from "@/components/ex/shell";
import { useT } from "@/components/ex/i18n-context";
import { useRoster } from "@/components/ex/roster-context";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";

// ─── Types from the API ──────────────────────────────────────────────────────

type ConnectionRecord = {
  toolkit: string;
  status: string; // INITIALIZING / INITIATED / ACTIVE / EXPIRED / FAILED / INACTIVE
  authConfigId?: string;
  connectedAccountId?: string;
  redirectUrl?: string;
  initiatedAt: string;
  activatedAt?: string;
};

type ConnectionsResponse = {
  composioUserId: string;
  connections: Record<string, ConnectionRecord>;
  configured: boolean;
  allowedToolkits: string[];
};

type ToolkitSummary = {
  slug: string;
  name: string;
  description?: string;
  iconUrl?: string;
  authSchemes?: string[];
  toolsCount?: number;
  triggersCount?: number;
  noAuth?: boolean;
};

function bucket(status: string | undefined) {
  const v = String(status || "").toUpperCase();
  if (v === "ACTIVE") return "active";
  if (v === "INITIALIZING" || v === "INITIATED") return "pending";
  if (v === "EXPIRED" || v === "FAILED") return "broken";
  return "disconnected";
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ConnectionsForEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t } = useT();
  const roster = useRoster();
  const employee = useMemo(
    () => roster.find((e) => e.id === id),
    [id, roster]
  );

  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [catalog, setCatalog] = useState<ToolkitSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [busyToolkit, setBusyToolkit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Written as promise chains (rather than async/await bodies) so no setState is
  // reachable on a synchronous code path from the mount effect — the state
  // updates only run inside the async continuations. Still returns a promise, so
  // `await refreshConnections()` in connect/disconnect keeps waiting for it.
  function refreshConnections() {
    return fetch(`/api/connections/${id}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        setData(json as ConnectionsResponse);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("connections.notFound"));
      });
  }

  function loadCatalog() {
    return fetch(`/api/connections/toolkits`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json()) as { error?: string };
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        const data = (await r.json()) as { toolkits: ToolkitSummary[] };
        setCatalog(data.toolkits || []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load catalog");
      })
      .finally(() => {
        setCatalogLoading(false);
      });
  }

  useEffect(() => {
    refreshConnections();
    loadCatalog();
    const t = setInterval(refreshConnections, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function connect(slug: string) {
    setBusyToolkit(slug);
    setError(null);
    try {
      const callbackUrl = `${window.location.origin}/connections/${id}?connected=${slug}`;
      const r = await fetch(`/api/connections/${id}/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit: slug, callbackUrl }),
      });
      const body = (await r.json()) as { redirectUrl?: string; error?: string };
      if (!r.ok || !body.redirectUrl) {
        throw new Error(body.error || "Failed to initiate connection");
      }
      window.open(body.redirectUrl, "_blank", "noopener,noreferrer");
      await refreshConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyToolkit(null);
    }
  }

  async function disconnect(slug: string) {
    if (!confirm(t("connections.disconnectConfirm", { name: slug }))) return;
    setBusyToolkit(slug);
    try {
      await fetch(`/api/connections/${id}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit: slug }),
      });
      await refreshConnections();
    } finally {
      setBusyToolkit(null);
    }
  }

  const allowed = useMemo(() => data?.allowedToolkits ?? [], [data]);
  const connBySlug = useMemo(() => data?.connections ?? {}, [data]);

  const recommended = useMemo(() => {
    if (catalog.length === 0) return [];
    const lookup = new Map(catalog.map((t) => [t.slug, t]));
    return allowed
      .map((slug) => lookup.get(slug))
      .filter(Boolean) as ToolkitSummary[];
  }, [catalog, allowed]);

  const filteredCatalog = useMemo(() => {
    if (!search.trim()) return catalog;
    const q = search.trim().toLowerCase();
    return catalog.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
    );
  }, [catalog, search]);

  const myConnections = useMemo(() => {
    const slugs = Object.keys(connBySlug);
    if (slugs.length === 0 || catalog.length === 0) return [];
    const lookup = new Map(catalog.map((t) => [t.slug, t]));
    return slugs
      .map((slug) => ({ slug, toolkit: lookup.get(slug), conn: connBySlug[slug] }))
      .filter((x) => x.toolkit) as Array<{
      slug: string;
      toolkit: ToolkitSummary;
      conn: ConnectionRecord;
    }>;
  }, [connBySlug, catalog]);

  if (!employee) {
    return (
      <>
        <Topbar
          crumbs={[
            { label: t("crumb.workspace"), href: "/employees" },
            t("nav.tools"),
          ]}
        />
        <div style={{ padding: "var(--sp-32)", color: "var(--text-muted)" }}>
          {t("connections.notFound")}
        </div>
      </>
    );
  }

  // Active count (top stat)
  const activeCount = Object.values(connBySlug).filter(
    (c) => bucket(c.status) === "active"
  ).length;
  const pendingCount = Object.values(connBySlug).filter(
    (c) => bucket(c.status) === "pending"
  ).length;

  return (
    <>
      <Topbar
        crumbs={[
          { label: t("crumb.workspace"), href: "/employees" },
          t("nav.tools"),
          employee.name,
        ]}
        actions={
          <Link
            href="/settings#custom-mcp"
            style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            {t("connections.orgMcp")}
          </Link>
        }
      />

      <EmployeePickerBar activeId={id} />

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 48px" }}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-14)",
            marginBottom: "var(--sp-4)",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: employee.avatarColor,
              display: "grid",
              placeItems: "center",
              fontSize: "var(--fs-base)",
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            {employee.initials}
          </div>
          <div>
            <h1
              style={{
                fontSize: "var(--fs-h3)",
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              {employee.firstName}&apos;s connections
            </h1>
            <div
              style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginTop: "var(--sp-2)" }}
            >
              {employee.role} · Connect tools so the twin can take real action
            </div>
          </div>
        </motion.div>

        {/* Context banner — behavior differs for real employees vs marketplace agents */}
        {employee.placement ? (
          <div
            style={{
              marginTop: "var(--sp-20)",
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid var(--hairline-strong)",
              background: "var(--bg-sunken)",
              fontSize: "var(--fs-sm)",
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: "var(--text)" }}>Marketplace agent.</strong>{" "}
            Connect buttons authenticate as <em>you</em> (the workspace admin). The agent will
            act on your behalf using the tools you connect here.
          </div>
        ) : (
          <div
            style={{
              marginTop: "var(--sp-20)",
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid var(--hairline-strong)",
              background: "var(--bg-sunken)",
              fontSize: "var(--fs-sm)",
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: "var(--text)" }}>This page shows {employee.firstName}&apos;s active connections.</strong>{" "}
            To connect additional tools, {employee.firstName} must do it themselves via their personal
            invite link at <span className="mono">/onboarding</span> — that way each tool is
            authorized under <em>their</em> identity, not yours.
          </div>
        )}
        {/* Status banners */}
        {data && !data.configured && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              marginTop: "var(--sp-20)",
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid var(--warn)",
              background: "rgba(180,140,60,0.08)",
              fontSize: "var(--fs-ui)",
            }}
          >
            <strong>COMPOSIO_API_KEY is not set.</strong> Connect buttons will
            error until configured.
          </motion.div>
        )}
        {error && (
          <div
            style={{
              marginTop: "var(--sp-16)",
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--danger)",
              background: "rgba(180,80,60,0.08)",
              fontSize: "var(--fs-sm)",
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        )}

        {/* Stats */}
        {data && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            style={{
              display: "flex",
              gap: "var(--sp-24)",
              marginTop: "var(--sp-18)",
              padding: "12px 16px",
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 10,
            }}
          >
            <Stat label={t("connections.active")} value={activeCount} color="var(--success)" />
            <Stat label={t("connections.pending")} value={pendingCount} color="var(--warn)" />
            <Stat
              label={t("connections.recommended")}
              value={recommended.length}
              color="var(--accent-deep)"
            />
            <Stat
              label={t("connections.catalog")}
              value={catalog.length}
              color="var(--text-muted)"
            />
          </motion.div>
        )}

        {/* Active connections */}
        {myConnections.length > 0 && (
          <Section
            title={t("connections.activeTitle")}
            subtitle={t("connections.activeSubtitle")}
          >
            <Grid>
              {myConnections.map(({ slug, toolkit, conn }, i) => (
                <ToolkitCard
                  key={slug}
                  toolkit={toolkit}
                  conn={conn}
                  busy={busyToolkit === slug}
                  configured={data?.configured ?? false}
                  canConnect={!!employee.placement}
                  delay={i * 0.03}
                  isRecommended={allowed.includes(slug)}
                  onConnect={() => connect(slug)}
                  onDisconnect={() => disconnect(slug)}
                />
              ))}
            </Grid>
          </Section>
        )}

        {/* Recommended + catalog — only for marketplace agents */}
        {employee.placement && recommended.length > 0 && (
          <Section
            title={t("connections.recommendedFor", { name: employee.firstName })}
            subtitle={t("connections.recommendedSubtitle")}
          >
            <Grid>
              {recommended.map((toolkit, i) => (
                <ToolkitCard
                  key={toolkit.slug}
                  toolkit={toolkit}
                  conn={connBySlug[toolkit.slug]}
                  busy={busyToolkit === toolkit.slug}
                  configured={data?.configured ?? false}
                  canConnect
                  delay={i * 0.03}
                  isRecommended
                  onConnect={() => connect(toolkit.slug)}
                  onDisconnect={() => disconnect(toolkit.slug)}
                />
              ))}
            </Grid>
          </Section>
        )}

        {/* Full catalog with search — only for marketplace agents */}
        {employee.placement && <div style={{ marginTop: "var(--sp-36)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-12)",
              marginBottom: "var(--sp-4)",
            }}
          >
            <h2
              style={{
                fontSize: "var(--fs-base)",
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.005em",
              }}
            >
              {t("connections.all")}
            </h2>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
              {t("connections.available", { count: catalog.length.toLocaleString() })}
            </span>
            <button
              onClick={() => setShowAll((v) => !v)}
              style={{
                marginInlineStart: "auto",
                padding: "5px 10px",
                fontSize: "var(--fs-meta)",
                fontWeight: 600,
                background: "var(--surface)",
                border: "1px solid var(--hairline)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {showAll ? t("connections.hide") : t("connections.browse")}
            </button>
          </div>

          {showAll && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div style={{ marginTop: "var(--sp-14)", marginBottom: "var(--sp-14)" }}>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("connections.search")}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "var(--surface)",
                    border: "1px solid var(--hairline-strong)",
                    borderRadius: 10,
                    fontSize: "var(--fs-ui)",
                    color: "var(--text)",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>

              {catalogLoading && (
                <div
                  style={{
                    padding: "var(--sp-32)",
                    textAlign: "center",
                    color: "var(--text-subtle)",
                    fontSize: "var(--fs-ui)",
                  }}
                >
                  {t("connections.loading")}
                </div>
              )}

              {!catalogLoading && (
                <>
                  <div
                    style={{
                      fontSize: "var(--fs-meta)",
                      color: "var(--text-subtle)",
                      marginBottom: "var(--sp-10)",
                    }}
                  >
                    {filteredCatalog.length === catalog.length
                      ? t("connections.showingAll", { count: catalog.length })
                      : t("connections.matching", { count: filteredCatalog.length, query: search })}
                  </div>
                  <Grid>
                    {filteredCatalog.slice(0, 200).map((toolkit, i) => (
                      <ToolkitCard
                        key={toolkit.slug}
                        toolkit={toolkit}
                        conn={connBySlug[toolkit.slug]}
                        busy={busyToolkit === toolkit.slug}
                        configured={data?.configured ?? false}
                        canConnect
                        delay={Math.min(i * 0.012, 0.4)}
                        isRecommended={allowed.includes(toolkit.slug)}
                        onConnect={() => connect(toolkit.slug)}
                        onDisconnect={() => disconnect(toolkit.slug)}
                      />
                    ))}
                  </Grid>
                  {filteredCatalog.length > 200 && (
                    <div
                      style={{
                        marginTop: "var(--sp-14)",
                        textAlign: "center",
                        fontSize: "var(--fs-meta)",
                        color: "var(--text-subtle)",
                      }}
                    >
                      {t("connections.showingLimit", { count: filteredCatalog.length })}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </div>}

        {/* Footer */}
        <div
          style={{
            marginTop: "var(--sp-28)",
            padding: "12px 14px",
            borderRadius: 8,
            background: "var(--bg-sunken)",
            border: "1px solid var(--hairline)",
            fontSize: "var(--fs-sm)",
            color: "var(--text-muted)",
            lineHeight: 1.6,
          }}
        >
          {t("connections.footer", { name: employee.firstName })}
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ marginBottom: "var(--sp-12)" }}>
        <h2
          style={{
            fontSize: "var(--fs-base)",
            fontWeight: 600,
            margin: 0,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <div
            style={{
              fontSize: "var(--fs-meta)",
              color: "var(--text-subtle)",
              marginTop: "var(--sp-2)",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: "var(--sp-10)",
      }}
    >
      {children}
    </div>
  );
}

function ToolkitCard({
  toolkit,
  conn,
  busy,
  configured,
  canConnect = false,
  isRecommended,
  delay = 0,
  onConnect,
  onDisconnect,
}: {
  toolkit: ToolkitSummary;
  conn?: ConnectionRecord;
  busy: boolean;
  configured: boolean;
  canConnect?: boolean;
  isRecommended: boolean;
  delay?: number;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useT();
  const statusBucket = bucket(conn?.status);
  const isActive = statusBucket === "active";
  const isPending = statusBucket === "pending";
  const isBroken = statusBucket === "broken";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      whileHover={{ y: -1 }}
      style={{
        padding: "var(--sp-12)",
        background: "var(--surface)",
        border: `1px solid ${
          isActive
            ? "var(--accent-soft)"
            : isPending
            ? "var(--warn)"
            : "var(--hairline)"
        }`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-8)",
        position: "relative",
      }}
    >
      {/* Recommended star */}
      {isRecommended && (
        <div
          title={t("connections.recommendedTitle")}
          style={{
            position: "absolute",
            top: 8,
            insetInlineEnd: 8,
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            color: "var(--accent-deep)",
            background: "var(--accent-soft)",
            padding: "1px 6px",
            borderRadius: 8,
          }}
        >
          ★
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-10)",
        }}
      >
        <ToolkitIcon slug={toolkit.slug} iconUrl={toolkit.iconUrl} size={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              color: "var(--text)",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {toolkit.name}
          </div>
          <div
            style={{
              fontSize: "var(--fs-xs)",
              color: "var(--text-subtle)",
              marginTop: "var(--sp-1)",
              display: "flex",
              gap: "var(--sp-8)",
            }}
          >
            {typeof toolkit.toolsCount === "number" && (
              <span>{t("connections.tools", { count: toolkit.toolsCount })}</span>
            )}
            {toolkit.authSchemes && toolkit.authSchemes.length > 0 && (
              <span>{toolkit.authSchemes[0]}</span>
            )}
          </div>
        </div>
      </div>

      {toolkit.description && (
        <div
          style={{
            fontSize: "var(--fs-meta)",
            color: "var(--text-muted)",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {toolkit.description}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-6)",
          marginTop: "auto",
        }}
      >
        {canConnect && !isActive && !isPending && (
          <button
            onClick={onConnect}
            disabled={busy || !configured}
            style={{
              flex: 1,
              padding: "6px 10px",
              background: configured ? "var(--text)" : "var(--bg-sunken)",
              color: configured ? "var(--bg)" : "var(--text-subtle)",
              border: "none",
              borderRadius: 6,
              fontSize: "var(--fs-meta)",
              fontWeight: 600,
              cursor: configured && !busy ? "pointer" : "default",
              fontFamily: "inherit",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Opening…" : isBroken ? "Reconnect" : "Connect"}
          </button>
        )}
        {canConnect && isPending && (
          <>
            <a
              href={conn?.redirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1,
                padding: "6px 10px",
                background: "var(--warn)",
                color: "white",
                borderRadius: 6,
                fontSize: "var(--fs-meta)",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Continue OAuth →
            </a>
            <button
              onClick={onDisconnect}
              disabled={busy}
              style={{
                padding: "6px 9px",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--hairline)",
                borderRadius: 6,
                fontSize: "var(--fs-xs)",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
          </>
        )}
        {isActive && (
          <>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-5)",
                padding: "6px 9px",
                background: "rgba(46,140,80,0.08)",
                color: "var(--success)",
                borderRadius: 6,
                fontSize: "var(--fs-meta)",
                fontWeight: 600,
              }}
            >
              <Check width={11} height={11} strokeWidth={1.8} />
              Connected
            </div>
            {canConnect && <button
              onClick={onDisconnect}
              disabled={busy}
              style={{
                padding: "6px 9px",
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--hairline)",
                borderRadius: 6,
                fontSize: "var(--fs-xs)",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Disconnect
            </button>}
          </>
        )}
      </div>
    </motion.div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--fs-2xs)",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-subtle)",
          marginBottom: "var(--sp-2)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "var(--fs-h3)", fontWeight: 700, color, lineHeight: 1 }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}


// ─── Employee picker (top of page) ───────────────────────────────────────────

function EmployeePickerBar({ activeId }: { activeId: string }) {
  const ready = useRoster().filter((e) => e.twinStatus === "ready");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-8)",
        padding: "10px 28px",
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
        Configure connections for
      </span>
      {ready.map((emp) => {
        const isActive = emp.id === activeId;
        return (
          <Link
            key={emp.id}
            href={`/connections/${emp.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-8)",
              paddingTop: 5,
              paddingBottom: 5,
              paddingInlineStart: 5,
              paddingInlineEnd: 12,
              background: isActive ? "var(--surface)" : "transparent",
              border: `1px solid ${
                isActive ? "var(--accent-soft)" : "transparent"
              }`,
              borderRadius: 22,
              opacity: isActive ? 1 : 0.55,
              transition: "opacity .15s",
              fontFamily: "inherit",
              textDecoration: "none",
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: emp.avatarColor,
                display: "grid",
                placeItems: "center",
                fontSize: "var(--fs-xs)",
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {emp.initials}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                textAlign: "start",
              }}
            >
              <span
                style={{
                  fontSize: "var(--fs-sm)",
                  fontWeight: 600,
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  lineHeight: 1.2,
                }}
              >
                {emp.firstName}
              </span>
              <span
                style={{
                  fontSize: "var(--fs-xs)",
                  color: "var(--text-subtle)",
                  lineHeight: 1.2,
                }}
              >
                {emp.role}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
