"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icons } from "@/components/ex/icons";
import { ToolkitIcon } from "@/components/ex/toolkit-icon";
import { INTEGRATIONS, type Integration } from "@/lib/ex-data";
import {
  CONSENT_SCOPES,
  CURRENT_CONSENT_VERSION,
  EMPLOYEES,
  type ConsentScope,
} from "@/lib/employees";
import {
  clearPersistedKeys,
  setCodec,
  usePersistedState,
} from "@/lib/use-persisted-state";

type ViewMode = "ceo" | "employee";

type Boundaries = {
  comp: boolean;
  hr: boolean;
  legal: boolean;
  customers: boolean;
  roadmap: boolean;
};

const STEPS = ["Consent", "Profile", "Sources", "Boundaries", "Review"] as const;

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: "var(--sp-3)",
        background: "var(--bg-sunken)",
        border: "1px solid var(--hairline)",
        borderRadius: 999,
        padding: "var(--sp-3)",
      }}
    >
      {(["ceo", "employee"] as ViewMode[]).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            style={{
              padding: "5px 14px",
              borderRadius: 999,
              fontSize: "var(--fs-sm)",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-subtle)",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,.08)" : "none",
              transition: "all .15s",
              letterSpacing: "-0.01em",
            }}
          >
            {m === "ceo" ? "CEO View" : "Employee View"}
          </button>
        );
      })}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageInner />
    </Suspense>
  );
}

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const empId = searchParams.get("employee") ?? "";
  const inviteToken = searchParams.get("invite") ?? "";
  const emp = EMPLOYEES.find((e) => e.id === empId);
  // If we arrived via an invite, the CEO may have given us a name/role hint.
  // Fetched lazily below so the initial render still has values.
  const [inviteHint, setInviteHint] = useState<{ name?: string; role?: string }>({});
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    fetch(`/api/invites/${encodeURIComponent(inviteToken)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.status === "redeemable" && d.invite) {
          setInviteHint({ name: d.invite.name, role: d.invite.role });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const defaultName = emp?.name ?? inviteHint.name ?? "Sarah Chen";
  const defaultRole = emp?.role ?? inviteHint.role ?? "Head of Engineering";

  // When arriving via an invite link the viewer is always the employee —
  // lock the mode so they can't flip to CEO view.
  const viewerIsEmployee = !!inviteToken;
  const [viewMode, setViewMode] = useState<ViewMode>("employee");
  // Persistence: scope all wizard state to the invite token so a mid-flow
  // refresh (or the Composio OAuth redirect) doesn't drop the user's
  // progress. Falsy `storageKey` opts out for the legacy CEO-self path.
  const storageKey = inviteToken
    ? `employee001:onboarding:${inviteToken}`
    : null;
  const k = (suffix: string) => (storageKey ? `${storageKey}:${suffix}` : null);

  // Honor `?step=` from the URL on first mount — the employee-side OAuth
  // callback returns to /onboarding?invite=…&step=2 so the user lands back
  // on the Sources step after authorizing on Composio's domain. Without
  // an explicit ?step, fall back to whatever localStorage remembers.
  const urlStep = (() => {
    const raw = searchParams.get("step");
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n >= 0 && n < STEPS.length) return n;
    return null;
  })();
  const [step, setStep] = usePersistedState<number>(k("step"), urlStep ?? 0);
  useEffect(() => {
    if (urlStep != null) setStep(urlStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStep]);
  const [acceptedScopes, setAcceptedScopes] = usePersistedState<Set<ConsentScope>>(
    k("acceptedScopes"),
    () => new Set(CONSENT_SCOPES.filter((s) => s.required).map((s) => s.id)),
    setCodec<ConsentScope>(),
  );
  const requiredScopesAccepted = CONSENT_SCOPES.filter(
    (s) => s.required
  ).every((s) => acceptedScopes.has(s.id));
  const [name, setName] = usePersistedState<string>(k("name"), defaultName);
  const [role, setRole] = usePersistedState<string>(k("role"), defaultRole);
  const [domain, setDomain] = usePersistedState<string>(
    k("domain"),
    "Distributed systems & platform",
  );
  // `chosen` is now only an ephemeral UI hint ("which rows did the employee
  // touch in this session"). The source of truth for "is this actually
  // connected" lives in the per-invite /connections endpoint and is fetched
  // by StepSources directly. Start empty for invite-bound flows.
  const [chosen, setChosen] = usePersistedState<Set<string>>(
    k("chosen"),
    () => new Set<string>(),
    setCodec<string>(),
  );
  const [extraToolkits, setExtraToolkits] = usePersistedState<
    Record<string, { slug: string; name: string; iconUrl?: string; description?: string }>
  >(k("extraToolkits"), {});
  // Count of ACTIVE Composio connections for this invite. Polled in parallel
  // with StepSources so the Continue gate stays correct even when the user
  // hasn't opened the Sources step yet.
  const [activeConnections, setActiveConnections] = useState(0);
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/invites/${encodeURIComponent(inviteToken)}/connections`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const data = (await r.json()) as {
          connections?: Record<string, { status?: string }>;
        };
        if (cancelled) return;
        const n = Object.values(data.connections ?? {}).filter(
          (c) => String(c.status ?? "").toUpperCase() === "ACTIVE",
        ).length;
        setActiveConnections(n);
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [inviteToken]);

  const [boundaries, setBoundaries] = usePersistedState<Boundaries>(
    k("boundaries"),
    {
      comp: true,
      hr: true,
      legal: true,
      customers: false,
      roadmap: false,
    },
  );

  // Once the form is hydrated, populate from the invite hint so the employee
  // sees their CEO-provided name/role pre-filled rather than the placeholder.
  // Only overwrite when the field is still at the literal placeholder —
  // otherwise a refreshed/persisted edit would silently revert.
  useEffect(() => {
    if (inviteHint.name && name === "Sarah Chen") setName(inviteHint.name);
    if (inviteHint.role && role === "Head of Engineering") setRole(inviteHint.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteHint.name, inviteHint.role]);

  const onFinish = async () => {
    // No invite → legacy path (CEO running it themselves for an internal
    // demo). Just route forward.
    if (!inviteToken) {
      router.push("/generation");
      return;
    }
    // Invite-bearing finish → call the complete API. This writes the
    // employee record to data/employees/ and marks the invite as used.
    try {
      await fetch(
        `/api/invites/${encodeURIComponent(inviteToken)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            role,
            domain,
            integrations: Array.from(chosen),
            boundaries,
          }),
        },
      );
      // Persisted wizard state is no longer useful after the invite has
      // been completed — wipe it so a stale draft doesn't haunt the next
      // employee on a shared device.
      if (storageKey) clearPersistedKeys(storageKey);
      // Route the *employee* back to /join with a done flag. They don't
      // hold the workspace token, so /employees would 401 for them anyway.
      router.push(`/join?invite=${encodeURIComponent(inviteToken)}&done=1`);
    } catch {
      router.push(
        `/join?invite=${encodeURIComponent(inviteToken)}&done=1`,
      );
    }
  };
  const firstName = name.split(" ")[0] || "the employee";

  const sidebarNote =
    viewMode === "ceo"
      ? <>We study the lookback window you chose (default 90 days) across the sources you connect, then Claude writes 9 profile markdown files describing how {firstName} thinks and works. You review and edit. Then their twin goes live.</>
      : <>Claude reads the lookback window your manager chose of your activity from the tools you connect, then writes 9 profile markdown files. Your manager reviews and approves before your twin goes live. You stay in control any time at <span className="mono">/profile</span>.</>;

  const isEmployeeView = viewMode === "employee";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "grid",
        gridTemplateColumns: isEmployeeView
          ? "minmax(0, 1fr)"
          : "minmax(0, 1fr) minmax(560px, 720px) minmax(0, 1fr)",
        justifyItems: isEmployeeView ? "center" : "stretch",
      }}
    >
      {/* Left step nav hidden in employee view (public unprotected link) */}
      {!isEmployeeView ? (
      <div style={{ borderRight: "1px solid var(--hairline)" }}>
        <div style={{ padding: "var(--sp-24)" }}>
          <div className="row" style={{ gap: "var(--sp-9)", alignItems: "center" }}>
            <div
              style={{
                width: 22,
                height: 22,
                background: "var(--text)",
                display: "grid",
                placeItems: "center",
                color: "var(--bg-elevated)",
                fontWeight: 700,
                fontSize: "var(--fs-sm)",
                letterSpacing: "-0.02em",
                borderRadius: 3,
              }}
            >
              E<span style={{ opacity: 0.45 }}>01</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: "var(--fs-base)", letterSpacing: "-0.015em" }}>
              Employee001
            </div>
          </div>
        </div>
        <div style={{ padding: "8px 24px" }}>
          {STEPS.map((s, i) => (
            <button
              key={s}
              className="row"
              onClick={() => setStep(i)}
              style={{
                padding: "10px 12px",
                width: "100%",
                textAlign: "left",
                borderRadius: 4,
                background: i === step ? "var(--surface)" : "transparent",
                border:
                  i === step
                    ? "1px solid var(--hairline)"
                    : "1px solid transparent",
                color: i <= step ? "var(--text)" : "var(--text-subtle)",
                gap: "var(--sp-12)",
                fontWeight: i === step ? 600 : 500,
                cursor: "pointer",
              }}
            >
              <span
                className="mono"
                style={{
                  width: 22,
                  height: 22,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 11,
                  background:
                    i < step
                      ? "var(--text)"
                      : i === step
                      ? "var(--accent-soft)"
                      : "var(--bg-sunken)",
                  color:
                    i < step
                      ? "var(--bg)"
                      : i === step
                      ? "var(--accent-deep)"
                      : "var(--text-subtle)",
                  fontSize: "var(--fs-meta)",
                  fontWeight: 600,
                }}
              >
                {i < step ? <Icons.Check size={11} /> : i + 1}
              </span>
              <span style={{ fontSize: "var(--fs-ui)" }}>{s}</span>
            </button>
          ))}
        </div>
        <div
          style={{
            padding: "32px 24px",
            color: "var(--text-subtle)",
            fontSize: "var(--fs-meta)",
            lineHeight: 1.6,
          }}
        >
          <div className="section-title" style={{ marginBottom: "var(--sp-8)" }}>
            What happens next
          </div>
          {sidebarNote}
        </div>
      </div>
      ) : null}

      {/* Center: form */}
      <div style={{ padding: "56px 64px 32px", maxWidth: 720, width: "100%" }}>
        {/* View toggle — hidden when the page is opened via an invite link */}
        {!viewerIsEmployee && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--sp-32)" }}>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        )}

        <div
          style={{
            fontSize: "var(--fs-meta)",
            fontWeight: 600,
            letterSpacing: ".08em",
            color: "var(--accent-deep)",
            textTransform: "uppercase",
            marginBottom: "var(--sp-12)",
          }}
        >
          Step {step + 1} of {STEPS.length}
        </div>

        {step === 0 && (
          <StepConsent
            employeeName={emp?.name ?? defaultName}
            viewMode={viewMode}
            acceptedScopes={acceptedScopes}
            setAcceptedScopes={setAcceptedScopes}
          />
        )}
        {step === 1 && (
          <StepYou
            viewMode={viewMode}
            name={name}
            setName={setName}
            role={role}
            setRole={setRole}
            domain={domain}
            setDomain={setDomain}
          />
        )}
        {step === 2 && (
          <StepSources
            viewMode={viewMode}
            chosen={chosen}
            setChosen={setChosen}
            extraToolkits={extraToolkits}
            setExtraToolkits={setExtraToolkits}
            inviteToken={inviteToken}
          />
        )}
        {step === 3 && (
          <StepBoundaries
            viewMode={viewMode}
            boundaries={boundaries}
            setBoundaries={setBoundaries}
          />
        )}
        {step === 4 && (
          <StepReview
            viewMode={viewMode}
            name={name}
            role={role}
            domain={domain}
            chosen={chosen}
            boundaries={boundaries}
          />
        )}

        <div className="row" style={{ marginTop: "var(--sp-40)", gap: "var(--sp-8)" }}>
          <button
            className="btn"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            style={{ opacity: step === 0 ? 0.4 : 1 }}
          >
            Back
          </button>
          <div className="spacer" />
          <span className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
            You can change everything later
          </span>
          {step < STEPS.length - 1 ? (
            (() => {
              const sourcesBlocked =
                step === 2 && Boolean(inviteToken) && activeConnections === 0;
              const consentBlocked = step === 0 && !requiredScopesAccepted;
              const disabled = consentBlocked || sourcesBlocked;
              return (
            <button
              className="btn primary"
              onClick={() => setStep(step + 1)}
              disabled={disabled}
              title={sourcesBlocked ? "Connect at least one tool to continue." : undefined}
              style={{
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {step === 0 ? "I consent — continue" : "Continue"}{" "}
              <Icons.Chevron size={12} />
            </button>
              );
            })()
          ) : viewMode === "ceo" ? (
            <button className="btn accent" onClick={onFinish}>
              <Icons.Spark size={13} /> Generate profile
            </button>
          ) : (
            <button className="btn primary" onClick={onFinish}>
              <Icons.Check size={13} /> Submit for review
            </button>
          )}
        </div>
      </div>

      {/* Right live preview hidden in employee view */}
      {!isEmployeeView ? (
      <div
        style={{
          borderLeft: "1px solid var(--hairline)",
          background: "var(--bg-elevated)",
          padding: "var(--sp-32)",
        }}
      >
        <div className="section-title" style={{ marginBottom: "var(--sp-16)" }}>
          Live preview
        </div>
        <PreviewCard
          step={step}
          name={name}
          role={role}
          domain={domain}
          chosen={chosen}
          viewMode={viewMode}
        />
      </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label style={{ display: "block", marginBottom: "var(--sp-18)" }}>
      <div style={{ fontSize: "var(--fs-sm)", fontWeight: 500, marginBottom: "var(--sp-6)" }}>{label}</div>
      {children}
      {hint && (
        <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-4)" }}>
          {hint}
        </div>
      )}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  style,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  readOnly?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      style={{
        width: "100%",
        padding: "8px 10px",
        fontSize: "var(--fs-ui)",
        border: "1px solid var(--hairline-strong)",
        borderRadius: 4,
        background: readOnly ? "var(--bg-sunken)" : "var(--surface)",
        color: readOnly ? "var(--text-muted)" : "var(--text)",
        outline: "none",
        cursor: readOnly ? "default" : "text",
        ...style,
      }}
    />
  );
}

function StepConsent({
  employeeName,
  viewMode,
  acceptedScopes,
  setAcceptedScopes,
}: {
  employeeName: string;
  viewMode: ViewMode;
  acceptedScopes: Set<ConsentScope>;
  setAcceptedScopes: (s: Set<ConsentScope>) => void;
}) {
  const firstName = employeeName.split(" ")[0] || "the employee";
  const isCeo = viewMode === "ceo";

  function toggle(id: ConsentScope) {
    const next = new Set(acceptedScopes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAcceptedScopes(next);
  }

  return (
    <div>
      <h1
        style={{
          fontSize: "var(--fs-h2)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        {isCeo ? `${firstName}, before we begin.` : "Before we begin."}
      </h1>
      <p
        className="muted"
        style={{ fontSize: "var(--fs-base)", lineHeight: 1.55, marginBottom: "var(--sp-28)" }}
      >
        {isCeo
          ? `Building a digital twin means modeling how ${firstName} thinks, writes, and decides. We need ${firstName}'s explicit consent before any data is collected.`
          : "Building your digital twin means modeling how you think, write, and decide. We need your explicit consent before any data is collected."}
      </p>

      <div
        style={{
          padding: "var(--sp-14)",
          borderRadius: 8,
          background: "var(--bg-sunken)",
          border: "1px solid var(--hairline)",
          fontSize: "var(--fs-sm)",
          lineHeight: 1.55,
          color: "var(--text-muted)",
          marginBottom: "var(--sp-24)",
        }}
      >
        <strong style={{ color: "var(--text)" }}>
          {isCeo ? "Employee rights." : "Your rights."}
        </strong>{" "}
        {isCeo
          ? <>{firstName} can revoke consent at any time from <span className="mono">/profile</span>. On revocation, their twin is paused immediately and all indexed data is queued for deletion within 30 days.</>
          : <>You can revoke consent at any time from <span className="mono">/profile</span>. On revocation, your twin is paused immediately and all indexed data is queued for deletion within 30 days.</>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)" }}>
        {CONSENT_SCOPES.map((scope) => {
          const checked = acceptedScopes.has(scope.id);
          return (
            <label
              key={scope.id}
              style={{
                display: "flex",
                gap: "var(--sp-12)",
                padding: "var(--sp-14)",
                background: checked ? "var(--surface)" : "var(--bg-elevated)",
                border: `1px solid ${checked ? "var(--accent-soft)" : "var(--hairline)"}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(scope.id)}
                style={{ marginTop: "var(--sp-2)", flexShrink: 0, accentColor: "var(--accent-deep)" }}
              />
              <div style={{ flex: 1 }}>
                <div
                  className="row"
                  style={{ gap: "var(--sp-8)", alignItems: "center", marginBottom: "var(--sp-2)" }}
                >
                  <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)" }}>
                    {scope.label}
                  </span>
                  {scope.required ? (
                    <span
                      className="badge"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent-deep)",
                        fontSize: "var(--fs-2xs)",
                      }}
                    >
                      Required
                    </span>
                  ) : (
                    <span
                      className="badge"
                      style={{
                        background: "var(--bg-sunken)",
                        color: "var(--text-subtle)",
                        fontSize: "var(--fs-2xs)",
                      }}
                    >
                      Optional
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {scope.desc}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div
        style={{
          marginTop: "var(--sp-24)",
          fontSize: "var(--fs-meta)",
          color: "var(--text-subtle)",
          lineHeight: 1.55,
        }}
      >
        {isCeo
          ? <>By continuing, {firstName} agrees to terms version <span className="mono">v{CURRENT_CONSENT_VERSION}</span>. The acceptance timestamp and the scopes below will be recorded on {firstName}&apos;s profile.</>
          : <>By continuing, you agree to terms version <span className="mono">v{CURRENT_CONSENT_VERSION}</span>. The acceptance timestamp and the scopes below will be recorded on your profile.</>}
      </div>
    </div>
  );
}

function StepYou({
  viewMode,
  name,
  setName,
  role,
  setRole,
  domain,
  setDomain,
}: {
  viewMode: ViewMode;
  name: string;
  setName: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  domain: string;
  setDomain: (v: string) => void;
}) {
  const firstName = name.split(" ")[0] || "the employee";
  const isCeo = viewMode === "ceo";
  return (
    <div>
      <h1
        style={{
          fontSize: "var(--fs-h2)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        {isCeo ? "Tell us who the twin is for." : "Tell us about yourself."}
      </h1>
      <p
        className="muted"
        style={{ fontSize: "var(--fs-base)", lineHeight: 1.5, marginBottom: "var(--sp-32)" }}
      >
        {isCeo
          ? <>{firstName}&apos;s twin will answer questions in their voice on the topics they own. We start with the basics.</>
          : "Your twin will answer questions in your voice on the topics you own. We start with the basics."}
      </p>
      <Field label={isCeo ? "Display name" : "Your name"}>
        <TextInput value={name} onChange={setName} />
      </Field>
      <Field label={isCeo ? "Role" : "Your role"}>
        <TextInput value={role} onChange={setRole} />
      </Field>
      <Field
        label={isCeo ? `What domain is ${firstName} authoritative on?` : "What domain are you authoritative on?"}
        hint="A short phrase. The twin will defer outside this domain."
      >
        <TextInput value={domain} onChange={setDomain} />
      </Field>
    </div>
  );
}

type CatalogToolkit = {
  slug: string;
  name: string;
  description?: string;
  iconUrl?: string;
  authSchemes?: string[];
  toolsCount?: number;
  noAuth?: boolean;
};

type InviteConnectionRecord = {
  toolkit: string;
  status: string;
  redirectUrl?: string;
};

type InviteConnectionsResponse = {
  employeeId: string | null;
  connections: Record<string, InviteConnectionRecord>;
  pendingEmployee: boolean;
};

function statusBucket(status: string | undefined): "active" | "pending" | "broken" | "disconnected" {
  const v = String(status || "").toUpperCase();
  if (v === "ACTIVE") return "active";
  if (v === "INITIALIZING" || v === "INITIATED") return "pending";
  if (v === "EXPIRED" || v === "FAILED") return "broken";
  return "disconnected";
}

function StepSources({
  viewMode,
  chosen,
  setChosen,
  extraToolkits,
  setExtraToolkits,
  inviteToken,
}: {
  viewMode: ViewMode;
  chosen: Set<string>;
  setChosen: (s: Set<string>) => void;
  extraToolkits: Record<string, { slug: string; name: string; iconUrl?: string; description?: string }>;
  setExtraToolkits: (
    v: Record<string, { slug: string; name: string; iconUrl?: string; description?: string }>
  ) => void;
  inviteToken: string;
}) {
  const isCeo = viewMode === "ceo";

  // ─── Live connection state (employee-side OAuth) ────────────────────────
  const [connections, setConnections] = useState<Record<string, InviteConnectionRecord>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/invites/${encodeURIComponent(inviteToken)}/connections`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const data = (await r.json()) as InviteConnectionsResponse;
        if (!cancelled) setConnections(data.connections ?? {});
      } catch {
        /* keep last good state */
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [inviteToken]);

  // Toolkit slug used by Composio (falls back to the built-in id when no override).
  const composioSlugFor = (it: Integration): string =>
    (it.composioSlug ?? it.id).toLowerCase();

  async function connectToolkit(slug: string) {
    if (!inviteToken) {
      // CEO-self mode — no invite token, so just toggle the slug into `chosen`.
      const next = new Set(chosen);
      next.add(slug);
      setChosen(next);
      return;
    }
    setBusy(slug);
    setConnError(null);
    try {
      const callbackUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/onboarding?invite=${encodeURIComponent(inviteToken)}&step=2`
          : undefined;
      const r = await fetch(
        `/api/invites/${encodeURIComponent(inviteToken)}/connections/initiate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolkit: slug, callbackUrl }),
        },
      );
      const body = (await r.json()) as { redirectUrl?: string; error?: string };
      if (!r.ok || !body.redirectUrl) {
        throw new Error(body.error || "Failed to start authorization");
      }
      // Track in UI-side state too so the row immediately reflects pending.
      const next = new Set(chosen);
      next.add(slug);
      setChosen(next);
      window.location.href = body.redirectUrl;
    } catch (err) {
      setConnError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(null);
    }
  }

  async function disconnectSlug(slug: string) {
    if (!inviteToken) {
      const next = new Set(chosen);
      next.delete(slug);
      setChosen(next);
      return;
    }
    setBusy(slug);
    try {
      await fetch(
        `/api/invites/${encodeURIComponent(inviteToken)}/connections/${encodeURIComponent(slug)}/disconnect`,
        { method: "POST" },
      );
      setConnections((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });
    } finally {
      setBusy(null);
    }
  }

  const grouped: Record<string, Integration[]> = {};
  INTEGRATIONS.forEach((s) => {
    (grouped[s.category] ||= []).push(s);
  });

  const [catalog, setCatalog] = useState<CatalogToolkit[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);

  useEffect(() => {
    if (!browseOpen || catalog || catalogLoading) return;
    setCatalogLoading(true);
    fetch("/api/connections/toolkits")
      .then((r) => r.json())
      .then((data: { toolkits?: CatalogToolkit[]; error?: string }) => {
        if (data.error) setCatalogError(data.error);
        setCatalog(data.toolkits ?? []);
      })
      .catch((e: Error) => setCatalogError(e.message))
      .finally(() => setCatalogLoading(false));
  }, [browseOpen, catalog, catalogLoading]);

  const builtInSlugs = useMemo(() => {
    const s = new Set<string>();
    INTEGRATIONS.forEach((i) => {
      s.add(i.id.toLowerCase());
      if (i.composioSlug) s.add(i.composioSlug.toLowerCase());
    });
    return s;
  }, []);

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog
      .filter((t) => !builtInSlugs.has(t.slug.toLowerCase()))
      .filter((t) => {
        if (!q) return true;
        return (
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.description?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, 40);
  }, [catalog, query, builtInSlugs]);

  const addFromCatalog = (t: CatalogToolkit) => {
    setExtraToolkits({
      ...extraToolkits,
      [t.slug]: { slug: t.slug, name: t.name, iconUrl: t.iconUrl, description: t.description },
    });
    // The actual Connect happens via connectToolkit — the catalog "+" just
    // surfaces the row in the visible list.
  };

  const removeExtra = (slug: string) => {
    const nextExtras = { ...extraToolkits };
    delete nextExtras[slug];
    setExtraToolkits(nextExtras);
    const next = new Set(chosen);
    next.delete(slug);
    setChosen(next);
  };

  // Active connection count (source of truth for the Continue button rule).
  const activeCount = Object.values(connections).filter(
    (c) => statusBucket(c.status) === "active",
  ).length;
  return (
    <div>
      <h1
        style={{
          fontSize: "var(--fs-h2)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        {isCeo ? "What should the twin learn from?" : "What should your twin learn from?"}
      </h1>
      <p
        className="muted"
        style={{ fontSize: "var(--fs-base)", lineHeight: 1.5, marginBottom: "var(--sp-24)" }}
      >
        {isCeo
          ? "We pull read-only data across the lookback window you chose through Composio. Tokens never touch our servers."
          : "Connect the tools you actually use. You'll authorize each one on its own site — Composio holds the tokens, not us, not your manager. Connect at least one to start building your twin."}
      </p>
      {connError && (
        <div
          style={{
            marginBottom: "var(--sp-12)",
            padding: "8px 12px",
            border: "1px solid var(--danger)",
            borderRadius: 6,
            fontSize: "var(--fs-sm)",
            color: "var(--danger)",
          }}
        >
          {connError}
        </div>
      )}
      {Object.keys(extraToolkits).length > 0 && (
        <div style={{ marginBottom: "var(--sp-18)" }}>
          <div className="section-title" style={{ marginBottom: "var(--sp-8)" }}>
            Added from catalog
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "var(--sp-8)",
            }}
          >
            {Object.values(extraToolkits).map((t) => {
              const slug = t.slug.toLowerCase();
              const conn = connections[slug];
              const bucket = statusBucket(conn?.status);
              const isBusy = busy === slug;
              const active = bucket === "active";
              const pending = bucket === "pending";
              return (
                <div
                  key={t.slug}
                  className="row"
                  style={{
                    padding: "var(--sp-12)",
                    gap: "var(--sp-12)",
                    border: `1px solid ${active ? "var(--success, #2c9e6e)" : pending ? "var(--accent-deep)" : "var(--hairline)"}`,
                    background: active ? "var(--surface)" : "var(--bg-elevated)",
                    borderRadius: 6,
                  }}
                >
                  {t.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.iconUrl} alt="" width={28} height={28} style={{ borderRadius: 4 }} />
                  ) : (
                    <ToolkitIcon slug={t.slug} size={28} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{t.name}</div>
                    <div
                      className="subtle"
                      style={{
                        fontSize: "var(--fs-meta)",
                        marginTop: "var(--sp-2)",
                        lineHeight: 1.4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {pending
                        ? "Complete the connection on the Composio screen, then return here."
                        : t.description ?? t.slug}
                    </div>
                  </div>
                  {active ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", flexShrink: 0 }}>
                      <span className="row" style={{ gap: 4, fontSize: "var(--fs-meta)", color: "var(--success, #2c9e6e)", fontWeight: 600 }}>
                        <Icons.Check size={12} /> Connected
                      </span>
                      <button
                        type="button"
                        onClick={() => disconnectSlug(slug)}
                        disabled={isBusy}
                        className="btn ghost sm"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : pending ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", flexShrink: 0 }}>
                      <button type="button" disabled className="btn sm" style={{ opacity: 0.7, cursor: "default" }}>
                        Waiting for authorization…
                      </button>
                      <button type="button" onClick={() => disconnectSlug(slug)} disabled={isBusy} className="btn ghost sm">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => connectToolkit(slug)}
                        disabled={isBusy || !inviteToken}
                        className="btn accent sm"
                      >
                        {isBusy ? "Starting…" : "Connect"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeExtra(t.slug)}
                        className="btn ghost sm"
                        aria-label={`Remove ${t.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: "var(--sp-18)" }}>
          <div className="section-title" style={{ marginBottom: "var(--sp-8)" }}>
            {cat}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "var(--sp-8)",
            }}
          >
            {items.map((it) => {
              const slug = composioSlugFor(it);
              const conn = connections[slug];
              const bucket = statusBucket(conn?.status);
              const isBusy = busy === slug;
              const active = bucket === "active";
              const pending = bucket === "pending";
              return (
                <div
                  key={it.id}
                  className="row"
                  style={{
                    padding: "var(--sp-12)",
                    gap: "var(--sp-12)",
                    textAlign: "left",
                    border:
                      "1px solid " +
                      (active ? "var(--success, #2c9e6e)" : pending ? "var(--accent-deep)" : "var(--hairline)"),
                    background: active ? "var(--surface)" : "var(--bg-elevated)",
                    borderRadius: 6,
                    position: "relative",
                  }}
                >
                  <ToolkitIcon slug={slug} size={32} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
                      {it.name}
                    </div>
                    <div
                      className="subtle"
                      style={{
                        fontSize: "var(--fs-meta)",
                        marginTop: "var(--sp-2)",
                        lineHeight: 1.4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {pending
                        ? "Complete the connection on the Composio screen, then return here."
                        : it.desc}
                    </div>
                  </div>
                  {active ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", flexShrink: 0 }}>
                      <span
                        className="row"
                        style={{
                          gap: 4,
                          fontSize: "var(--fs-meta)",
                          color: "var(--success, #2c9e6e)",
                          fontWeight: 600,
                        }}
                      >
                        <Icons.Check size={12} /> Connected
                      </span>
                      <button
                        type="button"
                        onClick={() => disconnectSlug(slug)}
                        disabled={isBusy}
                        className="btn ghost sm"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : pending ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", flexShrink: 0 }}>
                      <button
                        type="button"
                        disabled
                        className="btn sm"
                        style={{ opacity: 0.7, cursor: "default" }}
                      >
                        Waiting for authorization…
                      </button>
                      <button
                        type="button"
                        onClick={() => disconnectSlug(slug)}
                        disabled={isBusy}
                        className="btn ghost sm"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectToolkit(slug)}
                      disabled={isBusy || !inviteToken}
                      className="btn accent sm"
                      style={{ flexShrink: 0 }}
                    >
                      {isBusy ? "Starting…" : "Connect"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Browse full Composio catalog */}
      <div
        style={{
          marginTop: "var(--sp-24)",
          padding: "var(--sp-16)",
          border: "1px dashed var(--hairline-strong)",
          borderRadius: 8,
          background: "var(--bg-elevated)",
        }}
      >
        {!browseOpen ? (
          <button
            type="button"
            onClick={() => setBrowseOpen(true)}
            className="row"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              gap: "var(--sp-8)",
              cursor: "pointer",
              color: "var(--text)",
              fontWeight: 600,
              fontSize: "var(--fs-ui)",
            }}
          >
            <Icons.Plus size={14} />
            Connect more tools from the Composio catalog
          </button>
        ) : (
          <div>
            <div className="row" style={{ marginBottom: "var(--sp-12)", gap: "var(--sp-8)" }}>
              <div style={{ fontWeight: 600, fontSize: "var(--fs-ui)" }}>Composio catalog</div>
              <span className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
                {catalogLoading
                  ? "Loading…"
                  : catalog
                  ? `${catalog.length} toolkits`
                  : ""}
              </span>
              <div className="spacer" />
              <button
                type="button"
                onClick={() => {
                  setBrowseOpen(false);
                  setQuery("");
                }}
                className="btn ghost sm"
              >
                Close
              </button>
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Notion, HubSpot, Stripe, Asana…"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--hairline)",
                borderRadius: 6,
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: "var(--fs-base)",
                outline: "none",
                marginBottom: "var(--sp-12)",
              }}
            />
            {catalogError && (
              <div
                style={{
                  fontSize: "var(--fs-sm)",
                  color: "var(--danger)",
                  marginBottom: "var(--sp-8)",
                }}
              >
                {catalogError}
              </div>
            )}
            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "var(--sp-8)",
              }}
              className="scrollbar"
            >
              {filteredCatalog.map((t) => {
                const already = Boolean(extraToolkits[t.slug]) || Boolean(connections[t.slug.toLowerCase()]);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => addFromCatalog(t)}
                    disabled={Boolean(already)}
                    className="row"
                    style={{
                      padding: "var(--sp-10)",
                      gap: "var(--sp-10)",
                      textAlign: "left",
                      border: `1px solid ${already ? "var(--text)" : "var(--hairline)"}`,
                      background: already ? "var(--surface)" : "var(--bg-elevated)",
                      borderRadius: 6,
                      cursor: already ? "default" : "pointer",
                      opacity: already ? 0.7 : 1,
                    }}
                  >
                    {t.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.iconUrl} alt="" width={24} height={24} style={{ borderRadius: 4 }} />
                    ) : (
                      <ToolkitIcon slug={t.slug} size={24} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: "var(--fs-sm)",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        className="subtle"
                        style={{
                          fontSize: "var(--fs-meta)",
                          marginTop: "var(--sp-2)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {t.description ?? t.slug}
                      </div>
                    </div>
                    <span
                      className="subtle"
                      style={{ fontSize: "var(--fs-meta)", flexShrink: 0 }}
                    >
                      {already ? "Added" : "+ Add"}
                    </span>
                  </button>
                );
              })}
              {!catalogLoading && catalog && filteredCatalog.length === 0 && (
                <div
                  className="subtle"
                  style={{
                    gridColumn: "1 / -1",
                    fontSize: "var(--fs-sm)",
                    padding: "var(--sp-12)",
                    textAlign: "center",
                  }}
                >
                  No matches.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {inviteToken && (
        <div
          style={{
            marginTop: "var(--sp-20)",
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--bg-sunken)",
            border: "1px solid var(--hairline)",
            fontSize: "var(--fs-sm)",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-8)",
            flexWrap: "wrap",
          }}
        >
          {activeCount === 0 ? (
            <span>Connect at least one tool so we can start building your twin.</span>
          ) : activeCount < 3 ? (
            <span>You can connect more later from <span className="mono">/profile</span>.</span>
          ) : null}
          {activeCount > 0 ? (
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              {activeCount} connected · {Object.values(connections).filter((c) => statusBucket(c.status) === "pending").length} pending
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StepBoundaries({
  viewMode,
  boundaries,
  setBoundaries,
}: {
  viewMode: ViewMode;
  boundaries: Boundaries;
  setBoundaries: (b: Boundaries) => void;
}) {
  const isCeo = viewMode === "ceo";
  const items: { k: keyof Boundaries; label: string; desc: string }[] = [
    { k: "comp", label: "Compensation, equity, salary", desc: isCeo ? "Always escalate to employee" : "Always route back to you" },
    { k: "hr", label: "HR & people complaints", desc: isCeo ? "Always escalate to employee" : "Always route back to you" },
    { k: "legal", label: "Legal, contracts, NDAs", desc: isCeo ? "Always escalate to employee" : "Always route back to you" },
    { k: "customers", label: "Specific customer conversations", desc: isCeo ? "Escalate by default" : "Route back to you by default" },
    { k: "roadmap", label: "Unannounced roadmap", desc: isCeo ? "Escalate by default" : "Route back to you by default" },
  ];
  return (
    <div>
      <h1
        style={{
          fontSize: "var(--fs-h2)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        {isCeo
          ? "What should the twin never answer alone?"
          : "What should your twin never answer on your behalf?"}
      </h1>
      <p
        className="muted"
        style={{ fontSize: "var(--fs-base)", lineHeight: 1.5, marginBottom: "var(--sp-24)" }}
      >
        {isCeo
          ? <>These topics route directly to the employee, regardless of confidence. Stored in{" "}
              <span className="mono" style={{ background: "var(--bg-sunken)", padding: "1px 5px", borderRadius: 3 }}>BOUNDARIES.md</span>.</>
          : <>These topics will route directly back to you, regardless of how confident the twin is. Stored in{" "}
              <span className="mono" style={{ background: "var(--bg-sunken)", padding: "1px 5px", borderRadius: 3 }}>BOUNDARIES.md</span>
              {" "}— you can always update this from your profile.</>}
      </p>
      <div className="card" style={{ overflow: "hidden" }}>
        {items.map((it, i) => (
          <label
            key={it.k}
            className="row"
            style={{
              padding: "14px 16px",
              gap: "var(--sp-14)",
              borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={!!boundaries[it.k]}
              onChange={(e) =>
                setBoundaries({ ...boundaries, [it.k]: e.target.checked })
              }
              style={{ accentColor: "var(--text)", width: 16, height: 16 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "var(--fs-ui)", fontWeight: 500 }}>{it.label}</div>
              <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-2)" }}>
                {it.desc}
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function StepReview({
  viewMode,
  name,
  role,
  domain,
  chosen,
  boundaries,
}: {
  viewMode: ViewMode;
  name: string;
  role: string;
  domain: string;
  chosen: Set<string>;
  boundaries: Boundaries;
}) {
  const isCeo = viewMode === "ceo";
  const sources = INTEGRATIONS.filter((i) => chosen.has(i.id));
  const blocked = Object.values(boundaries).filter(Boolean).length;
  return (
    <div>
      <h1
        style={{
          fontSize: "var(--fs-h2)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        {isCeo ? "Ready to generate." : "You're all set."}
      </h1>
      <p
        className="muted"
        style={{ fontSize: "var(--fs-base)", lineHeight: 1.5, marginBottom: "var(--sp-24)" }}
      >
        {isCeo
          ? "Profile generation starts now and runs autonomously. Watch live progress on the next screen — usually a few minutes."
          : "Your responses are recorded. The twin starts building now — you'll see live progress on the next screen. You can close this and come back to the same link any time to check status."}
      </p>
      <div className="card" style={{ padding: "var(--sp-20)" }}>
        <ReviewRow label={isCeo ? "Twin for" : "Your profile"} value={`${name} — ${role}`} />
        <ReviewRow label="Domain" value={domain} />
        <ReviewRow
          label="Sources"
          value={`${sources.length} connected · ${sources.map((s) => s.name).join(", ")}`}
        />
        <ReviewRow
          label="Boundaries"
          value={`${blocked} topics always escalate`}
        />

        {/* Cost estimate — CEO only */}
        {isCeo && (
          <div
            className="row"
            style={{
              borderTop: "1px solid var(--hairline)",
              paddingTop: "var(--sp-14)",
              marginTop: "var(--sp-4)",
              gap: "var(--sp-12)",
            }}
          >
            <Icons.Spark size={14} style={{ color: "var(--accent)" }} />
            <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
              Estimated cost:{" "}
              <span className="mono" style={{ color: "var(--text)" }}>
                $32–47
              </span>{" "}
              using Claude Opus 4.7 across 9 profile files.
            </div>
          </div>
        )}

        {/* Employee — consent reminder */}
        {!isCeo && (
          <div
            className="row"
            style={{
              borderTop: "1px solid var(--hairline)",
              paddingTop: "var(--sp-14)",
              marginTop: "var(--sp-4)",
              gap: "var(--sp-12)",
            }}
          >
            <Icons.Lock size={14} style={{ color: "var(--text-subtle)" }} />
            <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>
              Your consent is recorded and timestamped. You can revoke at any time from{" "}
              <span className="mono">/profile</span>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="row"
      style={{ alignItems: "flex-start", padding: "10px 0", gap: "var(--sp-16)" }}
    >
      <div
        className="subtle"
        style={{
          width: 110,
          fontSize: "var(--fs-meta)",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: ".06em",
          paddingTop: "var(--sp-1)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "var(--fs-ui)", flex: 1, lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function PreviewCard({
  step,
  name,
  role,
  domain,
  chosen,
  viewMode,
}: {
  step: number;
  name: string;
  role: string;
  domain: string;
  chosen: Set<string>;
  viewMode: ViewMode;
}) {
  const isCeo = viewMode === "ceo";
  const initials = (name || "  ")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return (
    <div>
      {step === 0 && (
        <div className="card" style={{ padding: "var(--sp-16)", marginBottom: "var(--sp-12)" }}>
          <div className="section-title" style={{ marginBottom: "var(--sp-10)" }}>
            Consent record
          </div>
          <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.55, color: "var(--text-muted)" }}>
            {isCeo
              ? "We'll write a signed record on the employee profile:"
              : "We'll write a signed record on your profile:"}
            <div
              style={{
                marginTop: "var(--sp-10)",
                padding: "var(--sp-10)",
                background: "var(--bg-sunken)",
                borderRadius: 4,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "var(--fs-meta)",
                color: "var(--text)",
                lineHeight: 1.6,
              }}
            >
              version: {CURRENT_CONSENT_VERSION}
              <br />
              grantedAt: {new Date().toISOString().slice(0, 16)}Z
              <br />
              scopes: [&hellip;]
            </div>
          </div>
        </div>
      )}
      {step >= 1 && step <= 2 && (
        <div className="card" style={{ padding: "var(--sp-16)", marginBottom: "var(--sp-12)" }}>
          <div className="row" style={{ gap: "var(--sp-10)" }}>
            <div
              style={{
                width: 32,
                height: 32,
                background: "var(--accent-soft)",
                color: "var(--accent-deep)",
                display: "grid",
                placeItems: "center",
                fontWeight: 600,
                fontSize: "var(--fs-sm)",
                borderRadius: "50%",
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div>
              <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{name || "—"}</div>
              <div className="subtle" style={{ fontSize: "var(--fs-meta)" }}>{role || "—"}</div>
            </div>
            <div className="spacer" />
            <span className="badge twin">
              <Icons.Bot size={11} /> twin
            </span>
          </div>
          <div style={{ marginTop: "var(--sp-12)", fontSize: "var(--fs-sm)", lineHeight: 1.5, color: "var(--text-muted)" }}>
            Authoritative on{" "}
            <span style={{ color: "var(--text)", fontWeight: 500 }}>{domain || "—"}</span>.
          </div>
        </div>
      )}
      {step >= 2 && (
        <div className="card" style={{ padding: "var(--sp-14)", marginBottom: "var(--sp-12)" }}>
          <div className="section-title" style={{ marginBottom: "var(--sp-10)" }}>
            Sources · {chosen.size}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: "var(--sp-6)" }}>
            {[...chosen].map((id) => {
              const it = INTEGRATIONS.find((s) => s.id === id);
              return (
                <div
                  key={id}
                  className="row"
                  style={{
                    gap: "var(--sp-6)",
                    padding: "4px 8px 4px 4px",
                    background: "var(--surface)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 4,
                  }}
                >
                  <ToolkitIcon slug={INTEGRATIONS.find(i => i.id === id)?.composioSlug ?? id} size={20} />
                  <span style={{ fontSize: "var(--fs-meta)", fontWeight: 500 }}>{it?.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {step >= 3 && (
        <div className="card" style={{ padding: "var(--sp-14)" }}>
          <div className="section-title" style={{ marginBottom: "var(--sp-10)" }}>Sample twin reply</div>
          <div
            style={{
              background: "var(--surface-soft)",
              padding: "var(--sp-12)",
              borderRadius: 4,
              fontSize: "var(--fs-sm)",
              lineHeight: 1.55,
            }}
          >
            <div className="row" style={{ marginBottom: "var(--sp-6)", gap: "var(--sp-6)" }}>
              <strong>{name || "Sarah"}</strong>
              <span className="badge twin" style={{ padding: "1px 5px", fontSize: "var(--fs-xs)" }}>
                twin · 0.84
              </span>
            </div>
            <div style={{ color: "var(--text-muted)" }}>
              For platform reliability we usually look at p99 tail latency as the leading indicator.{" "}
              <span className="subtle">— answered from EXPERTISE.md, DECISIONS.md</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
