"use client";

import { useEffect, useState, useCallback } from "react";
import { Icons } from "@/components/ex/icons";
import { Topbar } from "@/components/ex/shell";
import { PageHead } from "@/components/ex/page-head";

// ─── Types (mirror src/lib/task-templates.ts + custom-templates.ts) ──────────

type TemplateRecord = {
  id: string;
  name: string;
  description: string;
  task: string;
  category?: string;
  appliesTo: "all" | string[];
  requiresToolkits?: string[];
  kind: "builtin" | "custom";
  createdAt?: string;
  updatedAt?: string;
};

type Draft = {
  name: string;
  description: string;
  task: string;
  category: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  task: "",
  category: "Custom",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      const data = (await res.json()) as { templates: TemplateRecord[] };
      setTemplates(data.templates ?? []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function startNew() {
    setEditingId("new");
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  function startEdit(t: TemplateRecord) {
    if (t.kind !== "custom") return;
    setEditingId(t.id);
    setDraft({
      name: t.name,
      description: t.description ?? "",
      task: t.task,
      category: t.category ?? "Custom",
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  async function save() {
    if (!draft.name.trim() || !draft.task.trim()) {
      setError("Name and task text are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url =
        editingId === "new" ? "/api/templates" : `/api/templates/${editingId}`;
      const method = editingId === "new" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Save failed" }));
        setError((e as { error: string }).error);
        return;
      }
      await refresh();
      cancelEdit();
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (res.ok) refresh();
  }

  // Group by category for display
  const grouped: Record<string, TemplateRecord[]> = {};
  for (const t of templates) {
    const cat = t.category ?? "Other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }

  const customCount = templates.filter((t) => t.kind === "custom").length;
  const builtinCount = templates.filter((t) => t.kind === "builtin").length;

  return (
    <>
      <Topbar crumbs={["Workspace", "Templates"]} />
      <div
        className="scrollbar"
        style={{ overflow: "auto", padding: "32px 40px 60px" }}
      >
        <div style={{ maxWidth: 880 }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--sp-16)",
              marginBottom: "var(--sp-28)",
            }}
          >
            <div style={{ flex: 1 }}>
              <PageHead
                icon="Doc"
                title="Task templates"
                subtitle="Reusable task prompts for your org. Built-ins are defaults; custom templates are yours to edit and share so the CEO can run proven tasks consistently."
              />
            </div>
            <button
              className="btn primary"
              onClick={startNew}
              disabled={editingId !== null}
            >
              <Icons.Plus size={11} /> New template
            </button>
          </div>

          {/* Counts */}
          <div
            style={{
              display: "flex",
              gap: "var(--sp-18)",
              marginBottom: "var(--sp-20)",
              fontSize: "var(--fs-sm)",
              color: "var(--text-muted)",
            }}
          >
            <span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {builtinCount}
              </span>{" "}
              built-in
            </span>
            <span>
              <span
                className="mono"
                style={{ fontWeight: 600, color: "var(--accent-deep)" }}
              >
                {customCount}
              </span>{" "}
              custom
            </span>
          </div>

          {/* Editor */}
          {editingId !== null && (
            <Editor
              draft={draft}
              setDraft={setDraft}
              onSave={save}
              onCancel={cancelEdit}
              saving={saving}
              error={error}
              isNew={editingId === "new"}
            />
          )}

          {/* Templates grouped by category */}
          {loading ? (
            <p className="muted" style={{ fontSize: "var(--fs-ui)" }}>
              Loading…
            </p>
          ) : templates.length === 0 ? (
            <div
              className="card"
              style={{
                padding: "20px 18px",
                fontSize: "var(--fs-ui)",
                color: "var(--text-muted)",
              }}
            >
              No templates yet. Click <strong>New template</strong> to add one.
            </div>
          ) : (
            Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} style={{ marginBottom: "var(--sp-24)" }}>
                <h2
                  style={{
                    fontSize: "var(--fs-meta)",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    margin: "0 0 10px",
                  }}
                >
                  {cat}
                </h2>
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  {items.map((t, i) => (
                    <TemplateRow
                      key={t.id}
                      template={t}
                      onEdit={() => startEdit(t)}
                      onDelete={() => deleteTemplate(t.id)}
                      isLast={i === items.length - 1}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ─── Editor (inline create + edit form) ──────────────────────────────────────

function Editor({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
  error,
  isNew,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  isNew: boolean;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: "hidden",
        marginBottom: "var(--sp-24)",
        borderColor: "var(--accent)",
      }}
    >
      <div
        style={{
          padding: "12px 18px",
          background: "var(--accent-soft)",
          borderBottom: "1px solid var(--accent)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
        }}
      >
        <Icons.Pencil size={12} style={{ color: "var(--accent-deep)" }} />
        <span
          style={{
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
            color: "var(--accent-deep)",
          }}
        >
          {isNew ? "New template" : "Edit template"}
        </span>
      </div>

      <div
        style={{
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-14)",
        }}
      >
        {/* Name + category row */}
        <div style={{ display: "flex", gap: "var(--sp-12)" }}>
          <Field label="Name" required style={{ flex: 2 }}>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Daily standup digest"
              style={inputStyle}
            />
          </Field>
          <Field label="Category" style={{ flex: 1 }}>
            <input
              type="text"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="Custom"
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Description">
          <input
            type="text"
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            placeholder="One-line summary shown in the slash menu"
            style={inputStyle}
          />
        </Field>

        <Field label="Task" required>
          <textarea
            value={draft.task}
            onChange={(e) => setDraft({ ...draft, task: e.target.value })}
            placeholder='The actual prompt that fills the textarea, e.g. "Pull all PRs from the last 24h..."'
            style={{
              ...inputStyle,
              minHeight: 110,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </Field>

        {error && (
          <div
            style={{
              fontSize: "var(--fs-sm)",
              color: "var(--danger)",
              padding: "6px 10px",
              background: "rgba(220,60,60,0.06)",
              borderRadius: 6,
              border: "1px solid var(--danger)",
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "var(--sp-8)",
            justifyContent: "flex-end",
            marginTop: "var(--sp-4)",
          }}
        >
          <button className="btn sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn primary sm"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : isNew ? "Create template" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
  style,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", ...style }}>
      <span
        style={{
          fontSize: "var(--fs-meta)",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: ".05em",
        }}
      >
        {label}
        {required && (
          <span style={{ color: "var(--danger)", marginLeft: "var(--sp-4)" }}>*</span>
        )}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  fontSize: "var(--fs-ui)",
  color: "var(--text)",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

// ─── Row ────────────────────────────────────────────────────────────────────

function TemplateRow({
  template,
  onEdit,
  onDelete,
  isLast,
}: {
  template: TemplateRecord;
  onEdit: () => void;
  onDelete: () => void;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCustom = template.kind === "custom";

  return (
    <div
      style={{
        borderBottom: !isLast ? "1px solid var(--hairline)" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--sp-12)",
          padding: "12px 16px",
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            marginTop: "var(--sp-3)",
            color: "var(--text-subtle)",
          }}
          title={expanded ? "Collapse" : "Show task text"}
        >
          <Icons.Chevron
            size={11}
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform .15s",
            }}
          />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--sp-8)",
              marginBottom: "var(--sp-2)",
            }}
          >
            <span style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>
              {template.name}
            </span>
            <span
              className="mono subtle"
              style={{ fontSize: "var(--fs-xs)" }}
              title="Slash command shortcut"
            >
              /{template.id}
            </span>
            {!isCustom && (
              <span
                style={{
                  fontSize: "var(--fs-2xs)",
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "var(--bg-elevated)",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                Default
              </span>
            )}
            {isCustom && (
              <span
                style={{
                  fontSize: "var(--fs-2xs)",
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "var(--accent-soft)",
                  color: "var(--accent-deep)",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                Custom
              </span>
            )}
          </div>
          <div
            className="subtle"
            style={{
              fontSize: "var(--fs-sm)",
              lineHeight: 1.45,
              marginBottom:
                template.requiresToolkits && template.requiresToolkits.length > 0
                  ? 6
                  : 0,
            }}
          >
            {template.description || (
              <em style={{ opacity: 0.6 }}>No description</em>
            )}
          </div>
          {template.requiresToolkits && template.requiresToolkits.length > 0 && (
            <div
              className="subtle"
              style={{ fontSize: "var(--fs-xs)", display: "flex", gap: "var(--sp-6)" }}
            >
              <span>Requires:</span>
              {template.requiresToolkits.map((t) => (
                <span
                  key={t}
                  className="mono"
                  style={{
                    background: "var(--bg-elevated)",
                    padding: "1px 6px",
                    borderRadius: 3,
                    fontSize: "var(--fs-xs)",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "var(--sp-6)", flexShrink: 0 }}>
          {isCustom ? (
            <>
              <button className="btn sm ghost" onClick={onEdit} title="Edit">
                <Icons.Pencil size={11} />
              </button>
              <button
                className="btn sm ghost"
                onClick={onDelete}
                title="Delete"
                style={{ color: "var(--danger)" }}
              >
                <Icons.X size={11} />
              </button>
            </>
          ) : (
            <span
              className="subtle"
              style={{ fontSize: "var(--fs-meta)", padding: "0 4px", lineHeight: "26px" }}
              title="Built-in templates can't be edited"
            >
              Read-only
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div
          style={{
            padding: "10px 16px 16px 39px",
            background: "var(--bg-elevated)",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <div
            className="section-title"
            style={{ fontSize: "var(--fs-2xs)", marginBottom: "var(--sp-6)" }}
          >
            Task text
          </div>
          <div
            style={{
              fontSize: "var(--fs-sm)",
              lineHeight: 1.55,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {template.task}
          </div>
        </div>
      )}
    </div>
  );
}
