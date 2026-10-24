"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { useT } from "@/components/ex/i18n-context";

// "Build my twin": the person running Employee001 builds their own twin from
// what they write and upload. No invite and no connected tools: the builder
// reads this material (knowledge/) and writes the 9 profile files, live on
// /twin-build. Tools can be connected later to deepen it.

const MIN_NOTES = 200;

const PROMPTS = [
  "What you own, and what a good week looks like in your role.",
  "Decisions you make often, and how you make them.",
  "The questions people ask you most, with your usual answers.",
  "Who you work with, on what.",
  "How you write: paste three to five messages or emails you sent.",
  "What you wouldn't let a twin decide without you.",
];

const ACCEPT = ".md,.txt,.pdf,.docx,.csv,.json";

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--text)",
  borderRadius: 7,
  padding: "8px 10px",
  font: "inherit",
  fontSize: "var(--fs-ui)",
};

const labelStyle = { display: "block", color: "var(--text)", fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: "var(--sp-6)" };

type Stage = "idle" | "creating" | "uploading" | "starting";

export default function BuildMyTwinPage() {
  const router = useRouter();
  const { t } = useT();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Prefill the name from the signed-in account (not the loopback stand-in).
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((me: { user?: { id?: string; name?: string } }) => {
        const n = me.user?.id !== "local-owner" ? me.user?.name?.trim() : "";
        if (n) setName((cur) => cur || n);
      })
      .catch(() => {});
  }, []);

  const notesShort = notes.trim().length < MIN_NOTES;
  const ready = name.trim() && role.trim() && !notesShort && consent && stage === "idle";

  async function build() {
    if (!ready) return;
    setError(null);
    setStage("creating");
    try {
      const res = await fetch("/api/twins/self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, notes, consent, locale: document.documentElement.lang === "he" ? "he" : "en" }),
      });
      const body = (await res.json().catch(() => ({}))) as { employeeId?: string; error?: string };
      if (!res.ok || !body.employeeId) throw new Error(body.error ?? `Couldn't create the twin (${res.status}).`);
      const id = body.employeeId;

      if (files.length) {
        setStage("uploading");
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          const up = await fetch(`/api/employees/${encodeURIComponent(id)}/knowledge`, { method: "POST", body: form });
          if (!up.ok) {
            const why = (await up.json().catch(() => ({}))) as { error?: string };
            throw new Error(`${file.name}: ${why.error ?? `upload failed (${up.status})`}`);
          }
        }
      }

      setStage("starting");
      const start = await fetch(`/api/twin-builder/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!start.ok) {
        const why = (await start.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(why.message ?? why.error ?? `Couldn't start the build (${start.status}).`);
      }
      // The live view reattaches to the running build on load.
      router.push(`/twin-build?employee=${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  }

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((cur) => [...cur, ...Array.from(list).filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };

  return (
    <>
      <Topbar crumbs={["Build my twin"]} />
      <main className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <PageHead
          icon="UserPlus"
          title="Build your own twin"
          subtitle="Brief it the way you'd brief a new colleague. It learns from what you give it here, and nothing else. About five minutes; the build takes a few more."
          style={{ marginBottom: "var(--sp-16)", maxWidth: 880 }}
        />

        <div style={{ maxWidth: 880, display: "grid", gap: "var(--sp-18)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--sp-12)" }}>
            <label htmlFor="self-name">
              <span style={labelStyle}>Your name</span>
              <input id="self-name" style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label htmlFor="self-role">
              <span style={labelStyle}>Your role</span>
              <input id="self-role" style={fieldStyle} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Head of Customer Success" />
            </label>
          </div>

          <div>
            <label htmlFor="notes" style={labelStyle}>About your work</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--sp-12)", alignItems: "start" }}>
              <textarea
                id="notes"
                style={{ ...fieldStyle, minHeight: 320, resize: "vertical", lineHeight: 1.55 }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write freely, in any language. Bullet points are fine."
              />
              <div className="card" style={{ padding: "var(--sp-14)", fontSize: "var(--fs-sm)", background: "var(--surface-soft)" }}>
                <div style={{ fontWeight: 600, marginBottom: "var(--sp-8)" }}>Worth covering</div>
                <ul style={{ margin: 0, paddingInlineStart: "var(--sp-16)", lineHeight: 1.6, color: "var(--text-muted)" }}>
                  {PROMPTS.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </div>
            </div>
            <div className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-6)" }}>
              {notesShort ? `${notes.trim().length} / ${MIN_NOTES} characters minimum` : `${notes.trim().length.toLocaleString("en-US")} characters`}
            </div>
          </div>

          <div>
            <span style={labelStyle}>Documents (optional)</span>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              style={{ border: "1px dashed var(--hairline)", borderRadius: 10, padding: "var(--sp-16)", display: "flex", alignItems: "center", gap: "var(--sp-12)", flexWrap: "wrap" }}
            >
              <button type="button" className="btn ghost sm" onClick={() => fileInput.current?.click()}>
                <Icons.Plus size={12} /> Add files
              </button>
              <span className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
                Docs you wrote, playbooks, specs, FAQs: Markdown, text, PDF or Word. Drop them here.
              </span>
              <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {files.length > 0 && (
              <ul style={{ listStyle: "none", margin: "var(--sp-8) 0 0", padding: 0, display: "grid", gap: "var(--sp-4)" }}>
                {files.map((f) => (
                  <li key={`${f.name}-${f.size}`} style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", fontSize: "var(--fs-sm)" }}>
                    <Icons.Doc size={12} />
                    <span>{f.name}</span>
                    <span className="subtle">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    <button type="button" className="btn ghost sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((c) => c !== f))}>
                      <Icons.X size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label style={{ display: "flex", gap: "var(--sp-10)", alignItems: "flex-start", fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <strong>{t("onboarding.scopeData")}</strong>
              <br />
              <span className="subtle">
                {t("onboarding.scopeDataDesc")} Only what I write and upload here. I can edit the profile, or delete the twin and everything in it, any time.
              </span>
            </span>
          </label>

          {error && (
            <div role="alert" style={{ color: "var(--danger)", fontSize: "var(--fs-sm)" }}>{error}</div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-12)" }}>
            <button type="button" className="btn primary" disabled={!ready} onClick={build}>
              {stage === "creating" ? "Creating…" : stage === "uploading" ? "Uploading documents…" : stage === "starting" ? "Starting the build…" : "Build my twin"}
            </button>
            <span className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
              You&apos;ll watch it write its 9 profile files. Connect Gmail or Slack later to deepen it.
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
