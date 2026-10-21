"use client";

import { useEffect, useState, type FormEvent } from "react";
import { cardStyle, ErrorLine, Field, Heading, postJson } from "@/components/auth/auth-form";

// Creates the first owner account. From then on every visit needs sign-in,
// loopback included, and roles apply (Settings → Users).
export default function SetupPage() {
  const [state, setState] = useState<{ needed: boolean; allowed: boolean } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup", { cache: "no-store" })
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState({ needed: true, allowed: false }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson("/api/auth/setup", { name, email, password });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Could not create the account.");
    // Full reload: the new session cookie must reach the proxy.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/account");
  }

  if (state && !state.needed) {
    return (
      <div style={cardStyle}>
        <Heading title="Already set up" sub="An owner account exists. Sign in instead." />
        <a href="/login" className="btn primary lg" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>Sign in</a>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <Heading
        title="Create the owner account"
        sub="After this, everyone signs in, on this machine too. You can add people and roles, and turn on two-factor sign-in, from your account."
      />
      {state && !state.allowed ? (
        <ErrorLine>Open the access URL the server printed (it ends in ?token=…) to continue.</ErrorLine>
      ) : (
        <form onSubmit={submit}>
          <Field id="name" label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
          <Field id="email" label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
          <Field id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="At least 12 characters." />
          <ErrorLine>{error}</ErrorLine>
          <button type="submit" disabled={busy || !email || password.length < 12} className="btn primary lg" style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Creating…" : "Create owner account"}
          </button>
        </form>
      )}
    </div>
  );
}
