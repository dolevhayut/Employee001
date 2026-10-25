"use client";

// Relay: when someone leaves, their twin can stay. An admin opens a handover,
// the departing employee does a short interview and chooses whether their
// twin stays, an admin reviews and approves the notes, then retires the twin.
// A retired twin keeps answering colleagues from what that person knew, with
// no tools, no actions and no new memory. The notes can be downloaded.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/ex/shell";
import { PackageReview, itemCount, type HandoverState } from "@/components/relay/package-review";

type Twin = { id: string; name: string; role: string; initials: string; avatarColor: string; twinStatus: string; lifecycle: "active" | "handover" | "retired"; retiredAt: string | null };

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, padding: "var(--sp-16)" };
const btn: React.CSSProperties = { background: "transparent", color: "var(--text)", border: "1px solid var(--hairline)", borderRadius: 8, padding: "6px 12px", fontSize: "var(--fs-ui)", cursor: "pointer", textDecoration: "none", display: "inline-block" };
const primary: React.CSSProperties = { ...btn, background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)" };
const h2: React.CSSProperties = { fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 600, margin: "var(--sp-24) 0 var(--sp-8)" };

function Avatar({ t }: { t: Twin }) {
  return (
    <div style={{ width: 32, height: 32, borderRadius: "50%", background: t.avatarColor, display: "grid", placeItems: "center", fontSize: "var(--fs-sm)", fontWeight: 600, color: "#2b2b2b", flexShrink: 0 }}>
      {t.initials}
    </div>
  );
}

async function fetchHandover(url: string): Promise<HandoverState | null> {
  const res = await fetch(url, { cache: "no-store" });
  return res.ok ? ((await res.json()) as HandoverState) : null;
}

async function fetchTwins(): Promise<Twin[]> {
  const res = await fetch("/api/relay", { cache: "no-store" });
  return res.ok ? ((await res.json()) as Twin[]) : [];
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string; message?: string }).error ?? "Something went wrong.";
}

function HandoverCard({ twin, onChanged, setError }: { twin: Twin; onChanged: () => void; setError: (e: string | null) => void }) {
  const [state, setState] = useState<HandoverState | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [copied, setCopied] = useState(false);
  const base = `/api/relay/${encodeURIComponent(twin.id)}`;

  const load = useCallback(async () => {
    const s = await fetchHandover(base);
    if (s) setState(s);
  }, [base]);
  useEffect(() => {
    let alive = true;
    fetchHandover(base).then((s) => {
      if (alive && s) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [base]);

  if (!state) return <div style={card}>Loading…</div>;
  const pkg = state.package;
  const answers = state.messages.filter((m) => m.role === "user").length;
  const consent = state.retention ? `agreed to keep their twin${state.retention.onBehalf ? " (recorded by an admin on their behalf)" : ""}` : state.retentionDeclinedAt ? "declined: delete the twin when they leave" : "hasn't chosen yet whether their twin stays";
  const link = `/handover/interview?employee=${encodeURIComponent(twin.id)}`;

  async function act(method: string, url: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(await send(url, method, body));
    await load();
    onChanged();
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Avatar t={twin} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 600 }}>{twin.name}</div>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>{twin.role}</div>
        </div>
      </div>
      <ul style={{ margin: "var(--sp-12) 0", paddingInlineStart: 18, fontSize: "var(--fs-ui)", color: "var(--text-muted)", lineHeight: 1.7 }}>
        <li>Interview: {answers ? `${answers} answers` : "not started"}</li>
        <li>Notes: {pkg ? `${itemCount(pkg)} items, ${pkg.review ? "approved" : "waiting for your approval"}` : "not built yet"}</li>
        <li>{twin.name.split(" ")[0]} {consent}</li>
      </ul>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Link href={link} style={btn}>Open the interview</Link>
        <button
          style={btn}
          onClick={async () => {
            await navigator.clipboard?.writeText(`${window.location.origin}${link}`).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy link for the employee"}
        </button>
        {pkg && <button style={btn} onClick={() => setShowNotes((v) => !v)}>{showNotes ? "Hide the notes" : "Review the notes"}</button>}
        {pkg && !pkg.review && <button style={btn} onClick={() => act("PATCH", `${base}/package`, { op: "approve", digest: state.packageDigest })}>Approve the notes</button>}
        {state.retention ? (
          <button
            style={primary}
            onClick={() => act("POST", base, { action: "retire" }, `Retire ${twin.name}'s twin? It stays available to everyone as a former employee's twin, answering only from its profile${pkg?.review ? " and the approved notes" : ""}, with no tools and no new memory.`)}
          >
            Retire the twin
          </button>
        ) : state.retentionDeclinedAt ? (
          <button
            style={{ ...btn, color: "var(--danger)", borderColor: "var(--danger)" }}
            onClick={() => act("DELETE", `/api/employees/${encodeURIComponent(twin.id)}?reason=consent_revoked`, undefined, `Delete ${twin.name}'s twin and all of its data? This can't be undone.`)}
          >
            Delete the twin
          </button>
        ) : null}
        <button style={btn} onClick={() => act("POST", base, { action: "cancel-handover" }, "Cancel this handover? The interview and notes are deleted, and the twin goes back to normal.")}>
          Cancel the handover
        </button>
      </div>
      {showNotes && pkg && (
        <div style={{ marginTop: "var(--sp-16)" }}>
          <PackageReview pkg={pkg} editable onEdit={async (edit) => { setError(await send(`${base}/package`, "PATCH", edit)); await load(); }} />
        </div>
      )}
    </div>
  );
}

function RetiredRow({ twin, onChanged, setError }: { twin: Twin; onChanged: () => void; setError: (e: string | null) => void }) {
  const dl = `/api/relay/${encodeURIComponent(twin.id)}/package`;
  return (
    <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Avatar t={twin} />
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: "var(--fs-base)", fontWeight: 600 }}>{twin.name}</div>
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
          Former {twin.role}{twin.retiredAt ? `, left ${twin.retiredAt.slice(0, 10)}` : ""}
        </div>
      </div>
      <Link href={`/ask?twin=${encodeURIComponent(twin.id)}`} style={btn}>Ask</Link>
      <a href={dl} style={btn}>Download notes</a>
      <a href={`${dl}?format=json`} style={btn}>rcp.json</a>
      <button
        style={{ ...btn, color: "var(--danger)" }}
        onClick={async () => {
          if (!window.confirm(`Delete ${twin.name}'s twin and all of its data? Do this when they ask, or when the company no longer needs it. This can't be undone.`)) return;
          setError(await send(`/api/employees/${encodeURIComponent(twin.id)}`, "DELETE"));
          onChanged();
        }}
      >
        Delete
      </button>
    </div>
  );
}

export default function RelayPage() {
  const [twins, setTwins] = useState<Twin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");

  const load = useCallback(async () => setTwins(await fetchTwins()), []);
  useEffect(() => {
    let alive = true;
    fetchTwins().then((t) => {
      if (alive) setTwins(t);
    });
    return () => {
      alive = false;
    };
  }, []);

  const active = (twins ?? []).filter((t) => t.lifecycle === "active" && t.twinStatus === "ready");
  const inHandover = (twins ?? []).filter((t) => t.lifecycle === "handover");
  const retired = (twins ?? []).filter((t) => t.lifecycle === "retired");

  return (
    <>
      <Topbar crumbs={["Relay"]} />
      <div className="scrollbar" style={{ flex: 1, overflowY: "auto", padding: "var(--sp-24)" }}>
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          <h1 style={{ fontSize: "var(--fs-h3)", margin: "0 0 6px" }}>Relay</h1>
          <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", lineHeight: 1.55, margin: 0, maxWidth: 640 }}>
            When someone leaves, their knowledge doesn&rsquo;t have to. They do a short handover interview and choose whether their twin stays. You approve the notes and retire the twin: everyone can keep asking it what they knew.
          </p>
          {error && <div style={{ ...card, marginTop: "var(--sp-16)", color: "var(--danger)", borderColor: "var(--danger)" }}>{error}</div>}

          <h2 style={h2}>Someone is leaving</h2>
          <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1, minWidth: 200, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface-soft)", color: "var(--text)", fontSize: "var(--fs-ui)" }}>
              <option value="">Choose a twin…</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}, {t.role}
                </option>
              ))}
            </select>
            <button
              style={{ ...primary, opacity: pick ? 1 : 0.5 }}
              disabled={!pick}
              onClick={async () => {
                setError(await send(`/api/relay/${encodeURIComponent(pick)}`, "POST", { action: "start-handover" }));
                setPick("");
                await load();
              }}
            >
              Start a handover
            </button>
          </div>

          {inHandover.length > 0 && (
            <>
              <h2 style={h2}>In handover</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {inHandover.map((t) => (
                  <HandoverCard key={t.id} twin={t} onChanged={load} setError={setError} />
                ))}
              </div>
            </>
          )}

          <h2 style={h2}>Former employees</h2>
          {retired.length === 0 ? (
            <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-subtle)" }}>No retired twins yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {retired.map((t) => (
                <RetiredRow key={t.id} twin={t} onChanged={load} setError={setError} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
