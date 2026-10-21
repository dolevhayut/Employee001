"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cardStyle, ErrorLine, Field, Heading, postJson } from "@/components/auth/auth-form";

type Me = { accounts: boolean; sso: boolean; mfaPending: boolean };

const SSO_ERRORS: Record<string, string> = {
  sso: "Single sign-on didn't complete. Try again.",
  no_account: "Your identity provider signed you in, but there's no Employee001 account for you. Ask an admin to add you.",
};

/** Only same-site paths, never a full URL (open redirect). */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function LoginInner() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [me, setMe] = useState<Me | null>(null);
  const [step, setStep] = useState<"password" | "mfa">(params.get("step") === "mfa" ? "mfa" : "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(SSO_ERRORS[params.get("error") ?? ""] ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<Me>)
      .then((value) => {
        setMe(value);
        if (value.mfaPending) setStep("mfa");
      })
      .catch(() => {});
  }, []);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson<{ status?: string }>("/api/auth/login", { email, password });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Sign-in failed.");
    if (data.status === "mfa_required") return setStep("mfa");
    window.location.assign(next);
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson("/api/auth/mfa/verify", { code });
    setBusy(false);
    if (!ok) return setError(data.error ?? "That code didn't work.");
    window.location.assign(next);
  }

  if (me && !me.accounts) {
    return (
      <div style={cardStyle}>
        <Heading title="No accounts yet" sub="This workspace runs without sign-in until the first owner account is created." />
        <Link href="/auth/setup" className="btn primary lg" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>
          Create the owner account
        </Link>
      </div>
    );
  }

  if (step === "mfa") {
    return (
      <div style={cardStyle}>
        <Heading title="Two-factor sign-in" sub="Enter the 6-digit code from your authenticator app." />
        <form onSubmit={submitCode}>
          <Field id="code" label="Code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" autoComplete="one-time-code" inputMode="numeric" autoFocus />
          <ErrorLine>{error}</ErrorLine>
          <button type="submit" disabled={busy || code.length !== 6} className="btn primary lg" style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Checking…" : "Verify"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <Heading title="Sign in to Employee001" />
      <form onSubmit={submitPassword}>
        <Field id="email" label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" inputMode="email" autoFocus />
        <Field id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <ErrorLine>{error}</ErrorLine>
        <button type="submit" disabled={busy || !email || !password} className="btn primary lg" style={{ width: "100%", justifyContent: "center", marginTop: "var(--sp-8)" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {me?.sso && (
        <a href={`/api/auth/oidc/start?next=${encodeURIComponent(next)}`} className="btn lg" style={{ width: "100%", justifyContent: "center", marginTop: "var(--sp-12)", textDecoration: "none" }}>
          Sign in with single sign-on
        </a>
      )}
      <p style={{ marginTop: "var(--sp-24)", fontSize: "var(--fs-sm)", textAlign: "center", color: "var(--text-muted)" }}>
        No account or forgot your password? Ask an admin of this workspace.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
