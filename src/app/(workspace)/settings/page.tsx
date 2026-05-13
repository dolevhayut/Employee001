"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import type {
  CustomMcpHeader,
  CustomMcpServer,
  CustomMcpTransport,
} from "@/lib/custom-mcp";
import type { OrgSkillPlaybook } from "@/lib/org-skills";
import type { OrgBrainNode, OrgBrainNodeType, OrgBrainInput } from "@/lib/org-brain";
import type { EmployeeGraph } from "@/lib/profile-graph-real";
import { ObsidianGraph } from "@/components/ex/obsidian-graph";
import { BrainGraph3D } from "@/components/ex/brain-graph-3d";

export default function SettingsPage() {
  return (
    <>
      <Topbar crumbs={["Workspace", "Settings"]} />
      <div
        className="scrollbar"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "32px 40px 64px",
        }}
      >
        <div style={{ maxWidth: 760 }}>
          <PageHead
            icon="Settings"
            title="Settings"
            subtitle="Configure workspace identity, internal playbooks (org skills), and custom MCP servers. This is where you wire new capabilities into the company."
            style={{ marginBottom: "var(--sp-20)" }}
          />

          <WorkspaceSection />
          <OrgBrainSection />
          <OrgSkillsSection />
          <CustomMcpSection />
          <AccountSection />
        </div>
      </div>
    </>
  );
}

function WorkspaceSection() {
  const [name, setName] = useState("Employee001");
  const [domain, setDomain] = useState("employee001.io");

  return (
    <section style={{ marginBottom: "var(--sp-32)" }}>
      <SectionHeader
        title="Workspace"
        desc="The organization this workspace represents."
      />
      <div className="card" style={{ padding: "var(--sp-20)" }}>
        <div className="row" style={{ gap: "var(--sp-16)", alignItems: "center", marginBottom: "var(--sp-20)" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 10,
              background: "var(--text)",
              color: "var(--bg)",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: "var(--fs-h3)",
              flexShrink: 0,
            }}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 500 }}>Workspace logo</div>
            <div className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-2)" }}>
              PNG or SVG, square, ≥ 256×256
            </div>
          </div>
          <button className="btn sm">Upload</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-16)" }}>
          <Field label="Organization name" value={name} onChange={setName} />
          <Field label="Domain" value={domain} onChange={setDomain} />
        </div>
      </div>
    </section>
  );
}

// ─── Org Skills ──────────────────────────────────────────────────────────────

function OrgSkillsSection() {
  const [skills, setSkills] = useState<OrgSkillPlaybook[] | null>(null);
  const [editing, setEditing] = useState<OrgSkillPlaybook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/skills", { cache: "no-store" });
      const data = (await res.json()) as { skills?: OrgSkillPlaybook[] };
      setSkills(data.skills ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setSkills([]);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(id);
  }, [load]);

  async function importFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    setError(null);
    setImportMessage(null);

    try {
      const payload = await Promise.all(
        Array.from(files)
          .filter((file) => file.name.toLowerCase().endsWith(".md"))
          .map(async (file) => ({
            filename: file.name,
            content: await file.text(),
          }))
      );

      if (payload.length === 0) {
        throw new Error("Choose one or more .md files");
      }

      const res = await fetch("/api/org/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const data = (await res.json()) as {
        imported?: OrgSkillPlaybook[];
        errors?: Array<{ filename: string; error: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Import failed");

      const importedCount = data.imported?.length ?? 0;
      const errorCount = data.errors?.length ?? 0;
      setImportMessage(
        errorCount > 0
          ? `Imported ${importedCount}; ${errorCount} file${errorCount === 1 ? "" : "s"} failed`
          : `Imported ${importedCount} skill${importedCount === 1 ? "" : "s"}`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section style={{ marginBottom: "var(--sp-32)" }}>
      <SectionHeader
        title="Organization skills"
        desc="Reusable operating playbooks. Assign them to twins from each twin profile."
      />
      <div className="card" style={{ padding: "var(--sp-20)" }}>
        <div className="row" style={{ alignItems: "center", marginBottom: "var(--sp-16)" }}>
          <div style={{ flex: 1, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
            {skills === null
              ? "Loading…"
              : `${skills.length} org skill${skills.length === 1 ? "" : "s"} available`}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,text/markdown,text/plain"
            multiple
            style={{ display: "none" }}
            onChange={(event) => void importFiles(event.target.files)}
          />
          <button
            className="btn sm"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            title="Import one or more SKILL.md files"
          >
            <Icons.Doc size={12} />
            {importing ? "Importing…" : "Import SKILL.md"}
          </button>
        </div>

        {importMessage && (
          <div
            style={{
              padding: "var(--sp-10)",
              fontSize: "var(--fs-sm)",
              background: "rgba(88, 160, 112, 0.10)",
              color: "var(--success)",
              borderRadius: 6,
              marginBottom: "var(--sp-12)",
            }}
          >
            {importMessage}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "var(--sp-10)",
              fontSize: "var(--fs-sm)",
              background: "rgba(220, 80, 60, 0.08)",
              color: "var(--danger)",
              borderRadius: 6,
              marginBottom: "var(--sp-12)",
            }}
          >
            {error}
          </div>
        )}

        {skills && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)" }}>
            {skills.map((skill) => (
              <OrgSkillRow
                key={skill.id}
                skill={skill}
                onEdit={() => setEditing(skill)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <OrgSkillModal
          skill={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function OrgSkillRow({
  skill,
  onEdit,
}: {
  skill: OrgSkillPlaybook;
  onEdit: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-14)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-12)",
        background: "var(--bg-elevated)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "var(--twin-soft)",
          color: "var(--twin)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Icons.Sparkle2 size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{skill.label}</div>
        <div
          style={{
            fontSize: "var(--fs-meta)",
            color: "var(--text-muted)",
            marginTop: "var(--sp-3)",
            lineHeight: 1.4,
          }}
        >
          {skill.description || "No description yet"}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", marginTop: "var(--sp-6)" }}>
          {skill.triggers.slice(0, 6).map((trigger) => (
            <span
              key={trigger}
              className="mono"
              style={{
                fontSize: "var(--fs-xs)",
                padding: "2px 5px",
                borderRadius: 3,
                border: "1px solid var(--hairline)",
                background: "var(--surface)",
                color: "var(--text-muted)",
              }}
            >
              {trigger}
            </span>
          ))}
        </div>
      </div>
      <button className="btn ghost sm" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

function OrgSkillModal({
  skill,
  onClose,
  onSaved,
}: {
  skill: OrgSkillPlaybook;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(skill.label);
  const [description, setDescription] = useState(skill.description);
  const [triggers, setTriggers] = useState(skill.triggers.join(", "));
  const [body, setBody] = useState(skill.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          description,
          triggers: triggers.split(",").map((t) => t.trim()).filter(Boolean),
          body,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 12, 8, 0.45)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: "var(--sp-16)",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 680,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "var(--sp-24)",
          background: "var(--bg-elevated)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ marginBottom: "var(--sp-20)" }}>
          <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, margin: 0 }}>
            Edit {skill.label}
          </h2>
          <p className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-4)" }}>
            Changes affect the next twin run that selects this organization skill.
          </p>
        </div>

        <div style={{ display: "grid", gap: "var(--sp-14)" }}>
          <Field label="Label" value={label} onChange={setLabel} />
          <Field
            label="Description"
            value={description}
            onChange={setDescription}
          />
          <Field
            label="Triggers"
            value={triggers}
            onChange={setTriggers}
            placeholder="roadmap, priority, launch"
          />
          <div>
            <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-4)" }}>
              Playbook
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              style={{
                ...inputStyle,
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: 1.45,
                resize: "vertical",
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: "var(--sp-10)",
                fontSize: "var(--fs-sm)",
                background: "rgba(220, 80, 60, 0.08)",
                color: "var(--danger)",
                borderRadius: 6,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-8)", marginTop: "var(--sp-24)" }}>
          <button className="btn sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn sm"
            onClick={save}
            disabled={saving}
            style={{
              background: "var(--text)",
              color: "var(--bg)",
              borderColor: "var(--text)",
            }}
          >
            {saving ? "Saving…" : "Save skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Org Brain (Company-wide knowledge graph) ───────────────────────────────

const BRAIN_TYPES: OrgBrainNodeType[] = [
  "document",
  "decision",
  "incident",
  "policy",
  "customer",
  "product",
  "process",
  "note",
];

const BRAIN_TYPE_TINT: Record<OrgBrainNodeType, string> = {
  document: "rgba(95, 130, 210, 0.18)",
  decision: "rgba(180, 110, 200, 0.18)",
  incident: "rgba(220, 90, 80, 0.18)",
  policy: "rgba(220, 160, 80, 0.18)",
  customer: "rgba(110, 180, 130, 0.18)",
  product: "rgba(80, 170, 200, 0.18)",
  process: "rgba(180, 180, 180, 0.18)",
  note: "rgba(150, 150, 150, 0.14)",
};

type BrainEditState =
  | { mode: "create" }
  | { mode: "edit"; node: OrgBrainNode }
  | null;

function OrgBrainSection() {
  const [nodes, setNodes] = useState<OrgBrainNode[] | null>(null);
  const [editing, setEditing] = useState<BrainEditState>(null);
  const [building, setBuilding] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/brain", { cache: "no-store" });
      const data = (await res.json()) as { nodes?: OrgBrainNode[] };
      setNodes(data.nodes ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setNodes([]);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(id);
  }, [load]);

  async function remove(node: OrgBrainNode) {
    if (
      !confirm(
        `Delete the "${node.label}" knowledge node? Every twin loses access immediately.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/org/brain/${node.slug}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Delete failed");
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <section style={{ marginBottom: "var(--sp-32)" }}>
      <SectionHeader
        title="Company brain"
        desc="Organization-wide knowledge nodes — facts every twin reads at run time. Pricing policies, customer segments, incident postmortems, product decisions."
      />
      <div className="card" style={{ padding: "var(--sp-20)" }}>
        <div className="row" style={{ alignItems: "center", marginBottom: "var(--sp-16)" }}>
          <div style={{ flex: 1, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
            {nodes === null
              ? "Loading…"
              : nodes.length === 0
              ? "No nodes yet — every twin has nothing organizational to lean on."
              : `${nodes.length} brain node${nodes.length === 1 ? "" : "s"} · shared across every twin`}
          </div>
          <button
            className="btn sm"
            onClick={() => setGraphOpen(true)}
            title="View Obsidian-style graph of all brain nodes and their cross-references"
            disabled={nodes !== null && nodes.length === 0}
          >
            <Icons.Sparkle2 size={12} /> Graph
          </button>
          <button
            className="btn sm"
            onClick={() => setBuilding(true)}
            title="Paste raw text — Claude extracts structured knowledge nodes"
          >
            <Icons.Sparkle2 size={12} /> Build from text
          </button>
          <button
            className="btn sm"
            onClick={() => setEditing({ mode: "create" })}
          >
            <Icons.Plus size={12} /> New node
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "var(--sp-10)",
              fontSize: "var(--fs-sm)",
              background: "rgba(220, 80, 60, 0.08)",
              color: "var(--danger)",
              borderRadius: 6,
              marginBottom: "var(--sp-12)",
            }}
          >
            {error}
          </div>
        )}

        {nodes && nodes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)" }}>
            {nodes.map((node) => (
              <OrgBrainRow
                key={node.slug}
                node={node}
                onEdit={() => setEditing({ mode: "edit", node })}
                onDelete={() => remove(node)}
              />
            ))}
          </div>
        )}

        {nodes && nodes.length === 0 && (
          <div
            style={{
              padding: "20px 16px",
              textAlign: "center",
              fontSize: "var(--fs-sm)",
              color: "var(--text-subtle)",
              border: "1px dashed var(--hairline)",
              borderRadius: 6,
            }}
          >
            Click <strong>New node</strong> to create the first piece of company
            knowledge — a pricing rule, an ICP definition, an incident postmortem,
            anything every twin should know.
          </div>
        )}
      </div>

      {editing && (
        <OrgBrainModal
          state={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {building && (
        <BrainBuilderModal
          onClose={() => setBuilding(false)}
          onSaved={() => {
            setBuilding(false);
            load();
          }}
        />
      )}

      {graphOpen && (
        <BrainGraphModal onClose={() => setGraphOpen(false)} />
      )}
    </section>
  );
}

function BrainGraphModal({ onClose }: { onClose: () => void }) {
  const [graph, setGraph] = useState<EmployeeGraph | null>(null);
  const [stats, setStats] = useState<{
    brainNodeCount: number;
    edgeCount: number;
    employeesLinkedIn: number;
    orphanBrainNodes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Track container size for the 3D canvas.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/org/brain/graph", { cache: "no-store" });
        const data = (await res.json()) as {
          graph?: EmployeeGraph;
          stats?: typeof stats;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Graph load failed");
        setGraph(data.graph ?? null);
        setStats(data.stats ?? null);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Graph load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 12, 8, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: "var(--sp-16)",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(96vw, 1200px)",
          height: "92vh",
          padding: 0,
          background: view === "3d" ? "#0a0908" : "var(--bg-elevated)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 12,
          border: view === "3d" ? "1px solid #2a2624" : undefined,
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom:
              view === "3d"
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid var(--hairline)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-16)",
            color: view === "3d" ? "#f0e8d8" : undefined,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2
              style={{
                fontSize: "var(--fs-body)",
                fontWeight: 600,
                margin: 0,
                color: view === "3d" ? "#f5edd9" : undefined,
              }}
            >
              Company Brain — Knowledge Graph
            </h2>
            <p
              style={{
                fontSize: "var(--fs-meta)",
                marginTop: "var(--sp-2)",
                marginBottom: 0,
                color: view === "3d" ? "rgba(245,237,217,0.6)" : "var(--text-subtle)",
              }}
            >
              {stats
                ? `${stats.brainNodeCount} node${stats.brainNodeCount === 1 ? "" : "s"} · ${stats.edgeCount} edge${stats.edgeCount === 1 ? "" : "s"} · ${stats.employeesLinkedIn} employee${stats.employeesLinkedIn === 1 ? "" : "s"} cross-linked · ${stats.orphanBrainNodes} unlinked`
                : "Loading…"}
            </p>
          </div>
          <div
            style={{
              display: "flex",
              gap: "var(--sp-4)",
              padding: "var(--sp-3)",
              borderRadius: 6,
              background:
                view === "3d" ? "rgba(255,255,255,0.06)" : "var(--surface)",
            }}
          >
            {(["3d", "2d"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setView(mode)}
                className="btn sm"
                style={{
                  padding: "4px 12px",
                  fontSize: "var(--fs-meta)",
                  background:
                    view === mode
                      ? view === "3d"
                        ? "#e8c87a"
                        : "var(--text)"
                      : "transparent",
                  color:
                    view === mode
                      ? view === "3d"
                        ? "#1a1612"
                        : "var(--bg)"
                      : view === "3d"
                      ? "rgba(245,237,217,0.7)"
                      : undefined,
                  borderColor: "transparent",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 600,
                }}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            className="btn ghost sm"
            onClick={onClose}
            style={{
              color: view === "3d" ? "rgba(245,237,217,0.85)" : undefined,
              borderColor:
                view === "3d" ? "rgba(245,237,217,0.18)" : undefined,
            }}
          >
            Close
          </button>
        </div>
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            background:
              view === "3d"
                ? "radial-gradient(circle at 50% 35%, rgba(232,200,122,0.06), transparent 60%), #0a0908"
                : undefined,
          }}
        >
          {error ? (
            <div style={{ padding: "var(--sp-24)", fontSize: "var(--fs-ui)", color: "var(--danger)" }}>
              {error}
            </div>
          ) : view === "3d" ? (
            size.w > 0 && size.h > 0 ? (
              <BrainGraph3D
                graph={graph}
                loading={!graph}
                width={size.w}
                height={size.h}
              />
            ) : null
          ) : (
            <ObsidianGraph
              graph={graph}
              state={{
                reading: new Set(),
                recentlyTouched: new Set(),
                cited: new Set(),
              }}
              onOpenFile={() => {
                /* noop in graph modal */
              }}
              loading={!graph}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BrainBuilderModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [running, setRunning] = useState(false);
  const [proposed, setProposed] = useState<OrgBrainInput[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extract() {
    setRunning(true);
    setError(null);
    setProposed(null);
    try {
      const res = await fetch("/api/org/brain/builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sourceLabel: sourceLabel.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        proposed?: OrgBrainInput[];
        notes?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      setProposed(data.proposed ?? []);
      setNotes(data.notes ?? null);
      setSelected(new Set((data.proposed ?? []).map((_, i) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setRunning(false);
    }
  }

  async function saveSelected() {
    if (!proposed || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const items = Array.from(selected)
        .map((i) => proposed[i])
        .filter(Boolean);
      const failures: string[] = [];
      for (const node of items) {
        const res = await fetch("/api/org/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(node),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          failures.push(`${node.slug}: ${data.error ?? "save failed"}`);
        }
      }
      if (failures.length > 0) {
        setError(`Saved ${items.length - failures.length}/${items.length}. Errors: ${failures.join("; ")}`);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 12, 8, 0.45)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: "var(--sp-16)",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "var(--sp-24)",
          background: "var(--bg-elevated)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ marginBottom: "var(--sp-20)" }}>
          <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, margin: 0 }}>
            Build brain from text
          </h2>
          <p className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-4)" }}>
            Paste a Notion page, Slack thread, postmortem, meeting notes, or
            email. Claude extracts structured knowledge nodes — you pick which
            to save.
          </p>
        </div>

        {!proposed && (
          <div style={{ display: "grid", gap: "var(--sp-14)" }}>
            <Field
              label="Source label (optional)"
              value={sourceLabel}
              onChange={setSourceLabel}
              placeholder="notion-export-q2-roadmap, slack-thread-incident-2026-04-22"
            />
            <div>
              <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-4)" }}>
                Raw text
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={16}
                placeholder="Paste the source material here..."
                style={{
                  ...inputStyle,
                  fontFamily: "var(--font-mono, monospace)",
                  lineHeight: 1.45,
                  resize: "vertical",
                }}
              />
              <div
                className="subtle"
                style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-4)" }}
              >
                {text.length.toLocaleString()} chars · max 60,000
              </div>
            </div>

            {error && (
              <div
                style={{
                  padding: "var(--sp-10)",
                  fontSize: "var(--fs-sm)",
                  background: "rgba(220, 80, 60, 0.08)",
                  color: "var(--danger)",
                  borderRadius: 6,
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}

        {proposed && (
          <div style={{ display: "grid", gap: "var(--sp-12)" }}>
            {notes && (
              <div
                style={{
                  padding: "var(--sp-10)",
                  fontSize: "var(--fs-sm)",
                  background: "rgba(95, 130, 210, 0.08)",
                  borderRadius: 6,
                  color: "var(--text-muted)",
                }}
              >
                <strong>Builder note:</strong> {notes}
              </div>
            )}

            {proposed.length === 0 ? (
              <div
                style={{
                  padding: "var(--sp-16)",
                  textAlign: "center",
                  fontSize: "var(--fs-sm)",
                  color: "var(--text-subtle)",
                  border: "1px dashed var(--hairline)",
                  borderRadius: 6,
                }}
              >
                Nothing extractable from this text. Try pasting more substantive
                org material.
              </div>
            ) : (
              <>
                <div
                  className="subtle"
                  style={{ fontSize: "var(--fs-sm)" }}
                >
                  {proposed.length} node{proposed.length === 1 ? "" : "s"} extracted ·
                  {" "}{selected.size} selected
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)", maxHeight: 360, overflowY: "auto" }}>
                  {proposed.map((node, i) => (
                    <label
                      key={i}
                      className="card"
                      style={{
                        padding: "var(--sp-12)",
                        background: selected.has(i)
                          ? "var(--bg-elevated)"
                          : "var(--bg)",
                        cursor: "pointer",
                        display: "flex",
                        gap: "var(--sp-10)",
                        alignItems: "flex-start",
                        opacity: selected.has(i) ? 1 : 0.6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => toggle(i)}
                        style={{ marginTop: "var(--sp-3)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: "var(--sp-8)", alignItems: "center" }}>
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: 3,
                              background:
                                BRAIN_TYPE_TINT[node.type ?? "note"],
                              fontSize: "var(--fs-xs)",
                              fontWeight: 600,
                              textTransform: "uppercase",
                            }}
                          >
                            {node.type ?? "note"}
                          </span>
                          <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
                            {node.label}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", marginTop: "var(--sp-3)" }}>
                          {node.slug}
                        </div>
                        {node.description && (
                          <div
                            style={{
                              fontSize: "var(--fs-sm)",
                              color: "var(--text-muted)",
                              marginTop: "var(--sp-4)",
                              lineHeight: 1.4,
                            }}
                          >
                            {node.description}
                          </div>
                        )}
                        {node.triggers && node.triggers.length > 0 && (
                          <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", marginTop: "var(--sp-6)" }}>
                            {node.triggers.slice(0, 8).map((t) => (
                              <span
                                key={t}
                                className="mono"
                                style={{
                                  fontSize: "var(--fs-xs)",
                                  padding: "2px 5px",
                                  borderRadius: 3,
                                  border: "1px solid var(--hairline)",
                                  background: "var(--surface)",
                                  color: "var(--text-muted)",
                                }}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {error && (
              <div
                style={{
                  padding: "var(--sp-10)",
                  fontSize: "var(--fs-sm)",
                  background: "rgba(220, 80, 60, 0.08)",
                  color: "var(--danger)",
                  borderRadius: 6,
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--sp-8)",
            marginTop: "var(--sp-24)",
          }}
        >
          {proposed && (
            <button
              className="btn ghost sm"
              onClick={() => {
                setProposed(null);
                setSelected(new Set());
                setNotes(null);
                setError(null);
              }}
              disabled={saving}
            >
              Back to text
            </button>
          )}
          <button className="btn sm" onClick={onClose} disabled={running || saving}>
            Cancel
          </button>
          {!proposed && (
            <button
              className="btn sm"
              onClick={extract}
              disabled={running || !text.trim() || text.length > 60_000}
              style={{
                background: "var(--text)",
                color: "var(--bg)",
                borderColor: "var(--text)",
              }}
            >
              {running ? "Extracting…" : "Extract nodes"}
            </button>
          )}
          {proposed && proposed.length > 0 && (
            <button
              className="btn sm"
              onClick={saveSelected}
              disabled={saving || selected.size === 0}
              style={{
                background: "var(--text)",
                color: "var(--bg)",
                borderColor: "var(--text)",
              }}
            >
              {saving
                ? "Saving…"
                : `Save ${selected.size} node${selected.size === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OrgBrainRow({
  node,
  onEdit,
  onDelete,
}: {
  node: OrgBrainNode;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-14)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-12)",
        background: "var(--bg-elevated)",
      }}
    >
      <div
        style={{
          minWidth: 64,
          padding: "4px 8px",
          borderRadius: 4,
          background: BRAIN_TYPE_TINT[node.type],
          fontSize: "var(--fs-xs)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {node.type}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{node.label}</div>
        <div
          style={{
            fontSize: "var(--fs-meta)",
            color: "var(--text-muted)",
            marginTop: "var(--sp-3)",
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {node.description || "No description"}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", marginTop: "var(--sp-6)" }}>
          {node.triggers.slice(0, 6).map((trigger) => (
            <span
              key={trigger}
              className="mono"
              style={{
                fontSize: "var(--fs-xs)",
                padding: "2px 5px",
                borderRadius: 3,
                border: "1px solid var(--hairline)",
                background: "var(--surface)",
                color: "var(--text-muted)",
              }}
            >
              {trigger}
            </span>
          ))}
          {node.linkedNodes.length > 0 && (
            <span
              className="mono"
              style={{
                fontSize: "var(--fs-xs)",
                padding: "2px 5px",
                borderRadius: 3,
                background: "rgba(95, 130, 210, 0.10)",
                color: "var(--text-muted)",
              }}
              title={node.linkedNodes.join(", ")}
            >
              ↗ {node.linkedNodes.length} link
              {node.linkedNodes.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-6)" }}>
        <button className="btn ghost sm" onClick={onEdit}>
          Edit
        </button>
        <button
          className="btn ghost sm"
          onClick={onDelete}
          style={{ color: "var(--danger)" }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function OrgBrainModal({
  state,
  onClose,
  onSaved,
}: {
  state: NonNullable<BrainEditState>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = state.mode === "edit";
  const existing = isEdit ? state.node : null;

  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [type, setType] = useState<OrgBrainNodeType>(existing?.type ?? "note");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [triggers, setTriggers] = useState(
    (existing?.triggers ?? []).join(", ")
  );
  const [sources, setSources] = useState((existing?.sources ?? []).join(", "));
  const [linkedNodes, setLinkedNodes] = useState(
    (existing?.linkedNodes ?? []).join(", ")
  );
  const [body, setBody] = useState(existing?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill slug from label when creating.
  useEffect(() => {
    if (!isEdit && label && !slug) {
      const auto = label
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (auto) setSlug(auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        slug,
        label,
        type,
        description,
        triggers: triggers.split(",").map((t) => t.trim()).filter(Boolean),
        sources: sources.split(",").map((s) => s.trim()).filter(Boolean),
        linkedNodes: linkedNodes
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
        body,
      };
      const res = await fetch(
        isEdit ? `/api/org/brain/${existing!.slug}` : "/api/org/brain",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 12, 8, 0.45)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: "var(--sp-16)",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "var(--sp-24)",
          background: "var(--bg-elevated)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ marginBottom: "var(--sp-20)" }}>
          <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, margin: 0 }}>
            {isEdit ? `Edit ${existing!.label}` : "New brain node"}
          </h2>
          <p className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-4)" }}>
            Every twin in this workspace will see this content the next time
            its triggers match a question.
          </p>
        </div>

        <div style={{ display: "grid", gap: "var(--sp-14)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-14)" }}>
            <Field
              label="Label"
              value={label}
              onChange={setLabel}
              placeholder="Pricing Policy — Q2 2026"
            />
            <Field
              label="Slug"
              value={slug}
              onChange={setSlug}
              placeholder="pricing-policy-q2-2026"
            />
          </div>

          <div>
            <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-4)" }}>
              Type
            </div>
            <div style={{ display: "flex", gap: "var(--sp-6)", flexWrap: "wrap" }}>
              {BRAIN_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="btn sm"
                  style={{
                    padding: "4px 10px",
                    fontSize: "var(--fs-meta)",
                    background:
                      type === t ? "var(--text)" : "var(--bg-elevated)",
                    color: type === t ? "var(--bg)" : "var(--text)",
                    borderColor:
                      type === t ? "var(--text)" : "var(--hairline)",
                    textTransform: "capitalize",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <Field
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="One-line summary — what this node is and when it matters"
          />
          <Field
            label="Triggers (comma-separated)"
            value={triggers}
            onChange={setTriggers}
            placeholder="pricing, discount, exception, deal"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-14)" }}>
            <Field
              label="Sources (comma-separated)"
              value={sources}
              onChange={setSources}
              placeholder="manual, confluence, slack-thread"
            />
            <Field
              label="Linked nodes (slugs)"
              value={linkedNodes}
              onChange={setLinkedNodes}
              placeholder="enterprise-segment-smb-vs-mid-market"
            />
          </div>

          <div>
            <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-4)" }}>
              Body (markdown — supports [[wikilinks]])
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              style={{
                ...inputStyle,
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: 1.45,
                resize: "vertical",
              }}
              placeholder="# Pricing Policy

## Discount authority
| Discount | Approver |
|----------|----------|
| 0–10%    | AE |
..."
            />
          </div>

          {error && (
            <div
              style={{
                padding: "var(--sp-10)",
                fontSize: "var(--fs-sm)",
                background: "rgba(220, 80, 60, 0.08)",
                color: "var(--danger)",
                borderRadius: 6,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--sp-8)",
            marginTop: "var(--sp-24)",
          }}
        >
          <button className="btn sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn sm"
            onClick={save}
            disabled={saving || !label.trim() || !slug.trim()}
            style={{
              background: "var(--text)",
              color: "var(--bg)",
              borderColor: "var(--text)",
            }}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create node"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Custom MCP ──────────────────────────────────────────────────────────────

function CustomMcpSection() {
  const [servers, setServers] = useState<CustomMcpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomMcpServer | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/mcp", { cache: "no-store" });
      const data = (await res.json()) as { servers?: CustomMcpServer[] };
      setServers(data.servers ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setServers([]);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(id);
  }, [load]);

  async function toggleEnabled(s: CustomMcpServer) {
    setServers((prev) =>
      prev?.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)) ??
      null
    );
    try {
      const res = await fetch(`/api/org/mcp/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } catch {
      load();
    }
  }

  async function remove(s: CustomMcpServer) {
    if (!confirm(`Delete the "${s.name}" MCP server? Twins lose access immediately.`)) return;
    await fetch(`/api/org/mcp/${s.id}`, { method: "DELETE" });
    load();
  }

  return (
    <section style={{ marginBottom: "var(--sp-32)" }}>
      <SectionHeader
        title="Custom MCP servers"
        desc="Org-wide tools every twin can use. Add Supabase, your internal API, or any MCP-compatible server."
      />
      <div className="card" style={{ padding: "var(--sp-20)" }}>
        <div className="row" style={{ alignItems: "center", marginBottom: "var(--sp-16)" }}>
          <div style={{ flex: 1, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
            {servers === null
              ? "Loading…"
              : servers.length === 0
              ? "No custom MCP servers yet."
              : `${servers.length} server${servers.length === 1 ? "" : "s"} configured`}
          </div>
          <button className="btn sm" onClick={() => setCreating(true)}>
            <Icons.Plus size={12} /> Add MCP server
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "var(--sp-10)",
              fontSize: "var(--fs-sm)",
              background: "rgba(220, 80, 60, 0.08)",
              color: "var(--danger)",
              borderRadius: 6,
              marginBottom: "var(--sp-12)",
            }}
          >
            {error}
          </div>
        )}

        {servers && servers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-10)" }}>
            {servers.map((s) => (
              <McpServerRow
                key={s.id}
                server={s}
                onEdit={() => setEditing(s)}
                onToggle={() => toggleEnabled(s)}
                onDelete={() => remove(s)}
              />
            ))}
          </div>
        )}

        {servers && servers.length === 0 && (
          <div
            style={{
              padding: "20px 16px",
              textAlign: "center",
              fontSize: "var(--fs-sm)",
              color: "var(--text-subtle)",
              border: "1px dashed var(--hairline)",
              borderRadius: 6,
            }}
          >
            Click <strong>Add MCP server</strong> to give every twin in the org
            access to a custom tool layer.
          </div>
        )}
      </div>

      {(creating || editing) && (
        <McpModal
          server={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function McpServerRow({
  server,
  onEdit,
  onToggle,
  onDelete,
}: {
  server: CustomMcpServer;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const host = (() => {
    try {
      return new URL(server.url).host;
    } catch {
      return server.url;
    }
  })();

  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-14)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-12)",
        background: "var(--bg-elevated)",
        opacity: server.enabled ? 1 : 0.6,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "var(--bg-sunken)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          fontSize: "var(--fs-meta)",
          fontWeight: 700,
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {server.transport}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-8)",
            fontSize: "var(--fs-ui)",
            fontWeight: 600,
          }}
        >
          {server.name}
          <span
            className="dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: server.enabled ? "var(--success)" : "var(--text-subtle)",
            }}
          />
          <span style={{ fontSize: "var(--fs-meta)", fontWeight: 500, color: "var(--text-subtle)" }}>
            {server.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div
          className="mono"
          style={{
            fontSize: "var(--fs-meta)",
            color: "var(--text-muted)",
            marginTop: "var(--sp-3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={server.url}
        >
          {host}
          {server.headers.length > 0 && (
            <span style={{ marginLeft: "var(--sp-8)", color: "var(--text-subtle)" }}>
              · {server.headers.length} header{server.headers.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {server.description && (
          <div
            style={{
              fontSize: "var(--fs-meta)",
              color: "var(--text-subtle)",
              marginTop: "var(--sp-3)",
            }}
          >
            {server.description}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: "var(--sp-6)" }}>
        <button className="btn ghost sm" onClick={onToggle}>
          {server.enabled ? "Disable" : "Enable"}
        </button>
        <button className="btn ghost sm" onClick={onEdit}>
          Edit
        </button>
        <button
          className="btn ghost sm"
          onClick={onDelete}
          style={{ color: "var(--danger)" }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function McpModal({
  server,
  onClose,
  onSaved,
}: {
  server: CustomMcpServer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = server !== null;
  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [transport, setTransport] = useState<CustomMcpTransport>(
    server?.transport ?? "http"
  );
  const [url, setUrl] = useState(server?.url ?? "");
  const [headers, setHeaders] = useState<CustomMcpHeader[]>(
    server?.headers && server.headers.length > 0
      ? server.headers
      : [{ key: "", value: "" }]
  );
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        description: description || undefined,
        transport,
        url,
        headers: headers.filter((h) => h.key && h.value),
        enabled,
      };
      const res = await fetch(
        isEdit ? `/api/org/mcp/${server.id}` : "/api/org/mcp",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 12, 8, 0.45)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: "var(--sp-16)",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "var(--sp-24)",
          background: "var(--bg-elevated)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ marginBottom: "var(--sp-20)" }}>
          <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, margin: 0 }}>
            {isEdit ? `Edit ${server.name}` : "Add custom MCP server"}
          </h2>
          <p
            className="subtle"
            style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-4)" }}
          >
            Available to every twin in this workspace. Tools route through
            the same approval + audit log as Composio actions.
          </p>
        </div>

        <div style={{ display: "grid", gap: "var(--sp-14)" }}>
          <Field
            label="Name"
            value={name}
            onChange={setName}
            placeholder="e.g. Supabase"
          />
          <Field
            label="Description (optional)"
            value={description}
            onChange={setDescription}
            placeholder="What this gives the twins access to"
          />

          <div>
            <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-4)" }}>
              Transport
            </div>
            <div style={{ display: "flex", gap: "var(--sp-8)" }}>
              {(["http", "sse"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTransport(t)}
                  className="btn sm"
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    background:
                      transport === t ? "var(--text)" : "var(--bg-elevated)",
                    color: transport === t ? "var(--bg)" : "var(--text)",
                    borderColor:
                      transport === t ? "var(--text)" : "var(--hairline)",
                  }}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <div
              className="subtle"
              style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-4)" }}
            >
              {transport === "http"
                ? "Streamable HTTP transport — most modern MCP servers."
                : "Server-Sent Events — for legacy MCP servers."}
            </div>
          </div>

          <Field
            label="URL"
            value={url}
            onChange={setUrl}
            placeholder="https://your-mcp-server.example.com/mcp"
          />

          <div>
            <div
              className="row"
              style={{ alignItems: "center", marginBottom: "var(--sp-6)" }}
            >
              <div
                className="section-title"
                style={{ fontSize: "var(--fs-xs)", flex: 1, marginBottom: 0 }}
              >
                Headers (auth, tokens)
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() =>
                  setHeaders((h) => [...h, { key: "", value: "" }])
                }
              >
                + Add header
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
              {headers.map((h, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1.6fr auto",
                    gap: "var(--sp-6)",
                  }}
                >
                  <input
                    placeholder="Authorization"
                    value={h.key}
                    onChange={(e) =>
                      setHeaders((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, key: e.target.value } : x
                        )
                      )
                    }
                    style={inputStyle}
                  />
                  <input
                    placeholder="Bearer sk_..."
                    value={h.value}
                    onChange={(e) =>
                      setHeaders((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x
                        )
                      )
                    }
                    style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                  />
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() =>
                      setHeaders((arr) => arr.filter((_, j) => j !== i))
                    }
                    aria-label="Remove header"
                    style={{ padding: "0 8px" }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-8)",
              fontSize: "var(--fs-sm)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enable for all twins immediately</span>
          </label>

          {error && (
            <div
              style={{
                padding: "var(--sp-10)",
                fontSize: "var(--fs-sm)",
                background: "rgba(220, 80, 60, 0.08)",
                color: "var(--danger)",
                borderRadius: 6,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--sp-8)",
            marginTop: "var(--sp-24)",
          }}
        >
          <button className="btn sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn sm"
            onClick={save}
            disabled={saving}
            style={{
              background: "var(--text)",
              color: "var(--bg)",
              borderColor: "var(--text)",
            }}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add server"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: "var(--fs-sm)",
  background: "var(--bg)",
  border: "1px solid var(--hairline)",
  borderRadius: 4,
  color: "var(--text)",
  fontFamily: "inherit",
};

// ─── Account ─────────────────────────────────────────────────────────────────

function AccountSection() {
  const [fullName, setFullName] = useState("Admin");
  const [email, setEmail] = useState("admin@employee001.io");

  return (
    <section style={{ marginBottom: "var(--sp-32)" }}>
      <SectionHeader title="Account" desc="The signed-in user." />
      <div className="card" style={{ padding: "var(--sp-20)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-16)", marginBottom: "var(--sp-16)" }}>
          <Field label="Full name" value={fullName} onChange={setFullName} />
          <Field label="Email" value={email} onChange={setEmail} type="email" />
        </div>

        <div
          className="row"
          style={{
            paddingTop: "var(--sp-16)",
            borderTop: "1px solid var(--hairline)",
            alignItems: "center",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 500 }}>Password</div>
            <div className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-2)" }}>
              Last changed never · we&apos;ll email a reset link
            </div>
          </div>
          <button className="btn sm">Change password</button>
        </div>
      </div>

      <div
        className="card"
        style={{
          padding: "var(--sp-20)",
          marginTop: "var(--sp-16)",
          borderColor: "var(--danger)",
        }}
      >
        <div className="row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--danger)" }}>
              Sign out
            </div>
            <div className="subtle" style={{ fontSize: "var(--fs-sm)", marginTop: "var(--sp-2)" }}>
              End the current session on this device.
            </div>
          </div>
          <button
            className="btn sm"
            style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
          >
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
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
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)", marginTop: "var(--sp-2)" }}>
        {desc}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="section-title" style={{ fontSize: "var(--fs-xs)", marginBottom: "var(--sp-4)" }}>
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: "var(--fs-ui)",
          background: "var(--bg-elevated)",
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          color: "var(--text)",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}
