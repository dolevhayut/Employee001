"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";
import { ErrorLine, Field, postJson } from "@/components/auth/auth-form";

type Me = {
  accounts: boolean;
  user: { id: string; name: string; email?: string; role: string; mfaEnabled?: boolean; sso?: boolean } | null;
};

const section = { marginBottom: "var(--sp-24)" } as const;
const sectionTitle = { fontSize: "var(--fs-base)", fontWeight: 600, margin: "0 0 var(--sp-4)" } as const;
const sectionDesc = { fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: "0 0 var(--sp-12)", lineHeight: 1.5 } as const;

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const reload = () => fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then(setMe).catch(() => {});
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then(setMe).catch(() => {});
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <>
      <Topbar crumbs={["Account"]} />
      <div className="scrollbar" style={{ flex: 1, overflowY: "auto", padding: "32px 40px 64px" }}>
        <div style={{ maxWidth: 560 }}>
          <PageHead icon="Settings" title="Your account" subtitle={me?.user ? `${me.user.name} · ${me.user.role}` : ""} style={{ marginBottom: "var(--sp-20)" }} />
          {me && !me.accounts ? (
            <div className="card" style={{ padding: "var(--sp-20)", fontSize: "var(--fs-ui)", lineHeight: 1.5 }}>
              This workspace runs without sign-in (single user on this machine). To add people, roles and two-factor sign-in, <a href="/auth/setup">create the owner account</a>.
            </div>
          ) : me?.user ? (
            <>
              <MfaSection enabled={Boolean(me.user.mfaEnabled)} onChange={reload} onSignedOut={() => router.replace("/login")} />
              {!me.user.sso && <PasswordSection />}
              <section style={section}>
                <h2 style={sectionTitle}>Sign out</h2>
                <p style={sectionDesc}>Ends this session. Sessions also end on their own after 12 hours.</p>
                <button className="btn" onClick={signOut}>Sign out</button>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function MfaSection({ enabled, onChange, onSignedOut }: { enabled: boolean; onChange: () => void; onSignedOut: () => void }) {
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    const { ok, data } = await postJson<{ secret: string; uri: string }>("/api/auth/mfa/enroll", {});
    if (!ok) return setError(data.error ?? "Could not start.");
    setEnroll({ secret: data.secret, uri: data.uri });
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    const { ok, data } = await postJson("/api/auth/mfa/confirm", { code });
    if (!ok) return setError(data.error ?? "That code didn't match.");
    setEnroll(null);
    setCode("");
    onChange();
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    const { ok, data } = await postJson("/api/auth/mfa/disable", { code });
    if (!ok) return setError(data.error ?? "Could not turn it off.");
    onSignedOut();
  }

  return (
    <section style={section}>
      <h2 style={sectionTitle}>Two-factor sign-in</h2>
      <p style={sectionDesc}>
        {enabled
          ? "On. Signing in asks for a code from your authenticator app."
          : "Adds a 6-digit code from an authenticator app (1Password, Google Authenticator, Authy…) to every sign-in."}
      </p>
      {enabled ? (
        <form onSubmit={disable} className="card" style={{ padding: "var(--sp-16)" }}>
          <Field id="mfa-off" label="Current code, to turn it off" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
          <ErrorLine>{error}</ErrorLine>
          <button className="btn" disabled={code.length !== 6}>Turn off</button>
        </form>
      ) : enroll ? (
        <form onSubmit={confirm} className="card" style={{ padding: "var(--sp-16)" }}>
          <p style={{ ...sectionDesc, margin: "0 0 var(--sp-8)" }}>In your authenticator, add an account with this setup key (or open the link on your phone):</p>
          <code style={{ display: "block", fontSize: "var(--fs-ui)", letterSpacing: "0.08em", padding: "var(--sp-8)", background: "var(--bg-sunken)", borderRadius: 4, marginBottom: "var(--sp-8)", wordBreak: "break-all" }}>{enroll.secret}</code>
          <a href={enroll.uri} style={{ fontSize: "var(--fs-sm)", display: "inline-block", marginBottom: "var(--sp-12)" }}>Open in authenticator app</a>
          <Field id="mfa-code" label="Code from the app" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
          <ErrorLine>{error}</ErrorLine>
          <button className="btn primary" disabled={code.length !== 6}>Turn on</button>
        </form>
      ) : (
        <>
          <ErrorLine>{error}</ErrorLine>
          <button className="btn primary" onClick={start}>Set up two-factor sign-in</button>
        </>
      )}
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { ok, data } = await postJson("/api/auth/password", { current, next });
    setMsg(ok ? { ok: true, text: "Password changed. Other sessions were signed out." } : { ok: false, text: data.error ?? "Could not change it." });
    if (ok) {
      setCurrent("");
      setNext("");
    }
  }

  return (
    <section style={section}>
      <h2 style={sectionTitle}>Password</h2>
      <form onSubmit={submit} className="card" style={{ padding: "var(--sp-16)" }}>
        <Field id="pw-current" label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <Field id="pw-next" label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint="At least 12 characters." />
        {msg && (msg.ok ? <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginBottom: "var(--sp-12)" }}>{msg.text}</div> : <ErrorLine>{msg.text}</ErrorLine>)}
        <button className="btn" disabled={!next}>Change password</button>
      </form>
    </section>
  );
}
