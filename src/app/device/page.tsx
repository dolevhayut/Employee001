"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { cardStyle, ErrorLine, Field, Heading } from "@/components/auth/auth-form";

type Me = { user: { id: string; name?: string; email?: string; role?: string } | null };
type Stage = "enter" | "confirm" | "approved" | "denied";

const buttonStyle = {
  padding: "10px 16px",
  fontSize: "var(--fs-ui)",
  fontWeight: 600,
  borderRadius: 4,
  cursor: "pointer",
} as const;

/** Shown form: ABCD-1234. The server accepts any case and separators. */
function formatCodeInput(value: string): string {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function DeviceInner() {
  const params = useSearchParams();
  const [code, setCode] = useState(formatCodeInput(params.get("code") ?? ""));
  const [stage, setStage] = useState<Stage>("enter");
  const [me, setMe] = useState<Me["user"] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<Me>)
      .then((value) => setMe(value.user))
      .catch(() => setMe(null));
  }, []);

  const who = me ? me.name || me.email || me.id : null;

  function review(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (formatCodeInput(code).length < 9) return setError("Enter the 8-character code shown in your terminal.");
    setStage("confirm");
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: code }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) return setStage("approved");
      setError(data.message ?? "Could not approve that code.");
      setStage("enter");
    } catch {
      setError("Could not reach Employee001. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={cardStyle}>
      {stage === "enter" && (
        <form onSubmit={review}>
          <Heading title="Approve a sign-in" sub="Enter the code your terminal printed after you ran employee001 login." />
          <ErrorLine>{error}</ErrorLine>
          <Field
            id="user-code"
            label="Code"
            value={code}
            onChange={(e) => setCode(formatCodeInput(e.target.value))}
            placeholder="ABCD-1234"
            autoComplete="off"
            autoFocus
          />
          <button type="submit" style={{ ...buttonStyle, width: "100%", background: "var(--text)", color: "var(--bg)", border: "1px solid var(--text)" }}>
            Continue
          </button>
        </form>
      )}

      {stage === "confirm" && (
        <div>
          <Heading
            title="Allow this sign-in?"
            sub="A command-line MCP client wants to use Employee001."
          />
          <ErrorLine>{error}</ErrorLine>
          <div style={{ fontSize: "var(--fs-ui)", lineHeight: 1.6, marginBottom: "var(--sp-16)" }}>
            <div>Code: <strong data-testid="device-code">{code}</strong></div>
            <div>You are approving as: <strong data-testid="device-person">{who ?? "…"}</strong></div>
          </div>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 var(--sp-16)" }}>
            The client will act as you and can be revoked later. Only approve if you just started this
            sign-in yourself.
          </p>
          <div style={{ display: "flex", gap: "var(--sp-8)" }}>
            <button
              type="button"
              onClick={approve}
              disabled={busy || !me}
              style={{ ...buttonStyle, flex: 1, background: "var(--text)", color: "var(--bg)", border: "1px solid var(--text)", opacity: busy || !me ? 0.6 : 1 }}
            >
              {busy ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => setStage("denied")}
              disabled={busy}
              style={{ ...buttonStyle, flex: 1, background: "transparent", color: "var(--text)", border: "1px solid var(--hairline-strong)" }}
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {stage === "approved" && (
        <Heading
          title="Approved"
          sub={`The client is now signed in${who ? ` as ${who}` : ""}. You can close this tab.`}
        />
      )}

      {stage === "denied" && (
        <Heading
          title="Not approved"
          sub="Nothing was signed in. The code expires on its own in a few minutes. You can close this tab."
        />
      )}
    </div>
  );
}

export default function DevicePage() {
  return (
    <Suspense fallback={null}>
      <DeviceInner />
    </Suspense>
  );
}
