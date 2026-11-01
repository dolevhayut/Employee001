"use client";

// Consent to use a cloned or custom voice for a person's twin. Shown under the
// voice list on the profile: a stock voice needs none; any other voice speaks
// only after the person (or, on their behalf, an admin) has agreed to the
// wording below. The server records who, when, the wording's SHA-256, IP and
// browser, and answers with the status only.

import { useCallback, useEffect, useState } from "react";
import { isStockVoice } from "@/lib/employees";
import { clearStoredVoice } from "@/components/ex/voice/voice-storage";

type Status = {
  text: string;
  consent: { grantedAt: string; onBehalf?: boolean } | null;
  covers: boolean;
};

export function VoiceConsentCard({ employeeId, voiceId, onWithdrawn }: { employeeId: string; voiceId: string; onWithdrawn?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tts/consent/${encodeURIComponent(employeeId)}?voiceId=${encodeURIComponent(voiceId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
    } catch {
      setStatus(null);
    }
  }, [employeeId, voiceId]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  async function send(agree: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tts/consent/${encodeURIComponent(employeeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agree, ...(agree ? { voiceId } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setAgreed(false);
      if (!agree && !isStockVoice(voiceId)) {
        // Withdrawn: forget the locally chosen non-stock voice too, so it isn't offered or sent again.
        clearStoredVoice(employeeId);
        onWithdrawn?.();
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const stock = isStockVoice(voiceId);
  if (!status || (stock && !status.consent)) return null;

  const box = { padding: "12px 18px", borderTop: "1px solid var(--hairline)", fontSize: "var(--fs-meta)" } as const;

  return (
    <div style={box}>
      {!stock && !status.covers && (
        <>
          <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: "var(--sp-4)" }}>Consent needed for this voice</div>
          <div className="subtle" style={{ marginBottom: "var(--sp-8)" }}>
            Until it is recorded, this twin speaks in the default voice. Record it only for a voice that is the
            person&apos;s own: the app cannot check whose voice a voice id is.
          </div>
          <div
            style={{ whiteSpace: "pre-line", padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: 6, background: "var(--surface)", color: "var(--text)", marginBottom: "var(--sp-8)" }}
          >
            {status.text}
          </div>
          <label style={{ display: "flex", gap: "var(--sp-8)", alignItems: "flex-start", marginBottom: "var(--sp-8)", cursor: "pointer" }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
            <span>I have read this and agree. If you are recording it for someone else, it is saved as given on their behalf.</span>
          </label>
          <button className="btn primary sm" disabled={!agreed || busy} onClick={() => void send(true)}>
            {busy ? "Saving…" : "Record consent"}
          </button>
        </>
      )}
      {status.consent && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-12)", marginTop: !stock && !status.covers ? "var(--sp-12)" : 0 }}>
          <div className="subtle" style={{ flex: 1 }}>
            Voice consent recorded {new Date(status.consent.grantedAt).toLocaleDateString()}
            {status.consent.onBehalf ? " (on behalf of the person)" : ""}.
            {!stock && !status.covers ? " It covers a different voice." : ""}
          </div>
          <button className="btn sm" disabled={busy} onClick={() => void send(false)}>
            Withdraw consent
          </button>
        </div>
      )}
      {error && <div style={{ color: "var(--danger)", marginTop: "var(--sp-8)" }}>{error}</div>}
    </div>
  );
}
