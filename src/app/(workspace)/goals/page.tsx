"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Topbar } from "@/components/ex/shell";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { useRoster } from "@/components/ex/roster-context";
import { useT } from "@/components/ex/i18n-context";
import type { Goal, GoalStatus } from "@/lib/goals";

type Draft = {
  title: string;
  description: string;
  ownerEmployeeId: string | null;
  parentId: string | null;
  status: GoalStatus;
};

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

const blankDraft: Draft = { title: "", description: "", ownerEmployeeId: null, parentId: null, status: "active" };

function draftFromGoal(goal: Goal): Draft {
  return { title: goal.title, description: goal.description ?? "", ownerEmployeeId: goal.ownerEmployeeId, parentId: goal.parentId, status: goal.status };
}

function orderedGoals(goals: Goal[]): Array<{ goal: Goal; depth: number }> {
  const children = new Map<string | null, Goal[]>();
  for (const goal of goals) children.set(goal.parentId, [...(children.get(goal.parentId) ?? []), goal]);
  for (const list of children.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: Array<{ goal: Goal; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const goal of children.get(parentId) ?? []) {
      out.push({ goal, depth });
      visit(goal.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export default function GoalsPage() {
  const { t, locale } = useT();
  const roster = useRoster();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/goals", { cache: "no-store" });
      if (!response.ok) throw new Error("goals_unavailable");
      const body = await response.json() as { goals: Goal[] };
      setGoals(body.goals);
      setError("");
    } catch {
      setError(t("goals.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);
  const rows = useMemo(() => orderedGoals(goals), [goals]);

  async function save(draft: Draft, id?: string) {
    if (!draft.title.trim()) return;
    const response = await fetch(id ? `/api/goals/${id}` : "/api/goals", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, description: draft.description.trim() || (id ? null : undefined) }),
    });
    if (!response.ok) { setError(t("goals.error")); return; }
    setCreating(false); setEditing(null); await load();
  }

  async function changeStatus(id: string, status: GoalStatus) {
    const response = await fetch(`/api/goals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { setError(t("goals.error")); return; }
    await load();
  }

  async function remove() {
    if (!deleting) return;
    const response = await fetch(`/api/goals/${deleting.id}`, { method: "DELETE" });
    if (!response.ok) { setError(t("goals.error")); return; }
    setDeleting(null); await load();
  }

  return (
    <div dir={locale === "he" ? "rtl" : "ltr"} style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar crumbs={[t("nav.goals")]} actions={<button className="btn primary sm" onClick={() => { setCreating(true); setEditing(null); }} style={{ height: 28 }}><Icons.Plus size={12} /> {t("goals.new")}</button>} />
      <main className="scrollbar" style={{ flex: 1, overflow: "auto", padding: "20px 24px 60px" }}>
        <PageHead icon="Flow" title={t("goals.title")} subtitle={t("goals.subtitle")} style={{ marginBottom: "var(--sp-16)", maxWidth: 880 }} />
        {error && <p role="alert" style={{ maxWidth: 880, color: "var(--danger)", fontSize: "var(--fs-sm)" }}>{error}</p>}
        {loading ? <p style={{ color: "var(--text-muted)", fontSize: "var(--fs-ui)" }}>{t("goals.loading")}</p> : rows.length === 0 ? (
          <div style={{ maxWidth: 560, margin: "60px auto 0", textAlign: "center", color: "var(--text-muted)" }}>
            <Icons.Flow size={28} style={{ opacity: 0.3, marginBottom: "var(--sp-12)" }} />
            <p style={{ margin: "0 0 var(--sp-16)", fontSize: "var(--fs-ui)", lineHeight: 1.55 }}>{t("goals.empty")}</p>
            <button className="btn primary" onClick={() => setCreating(true)}><Icons.Plus size={13} /> {t("goals.new")}</button>
          </div>
        ) : <div style={{ maxWidth: 880, display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
          {rows.map(({ goal, depth }) => editing === goal.id ? (
            <GoalForm key={goal.id} goals={goals} roster={roster} initial={draftFromGoal(goal)} excludeId={goal.id} submitLabel={t("goals.save")} onCancel={() => setEditing(null)} onSubmit={(draft) => save(draft, goal.id)} t={t} />
          ) : <motion.article key={goal.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} style={{ marginInlineStart: `${depth * 28}px`, padding: "var(--sp-14)", border: "1px solid var(--hairline)", borderRadius: 10, background: "var(--surface)", borderInlineStart: depth ? "3px solid var(--accent-soft)" : "1px solid var(--hairline)" }}>
            <div style={{ display: "flex", gap: "var(--sp-12)", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, color: "var(--text)", fontSize: "var(--fs-body)", fontWeight: 600 }}>{goal.title}</h2>
                {goal.description && <p style={{ margin: "var(--sp-6) 0 0", color: "var(--text-muted)", fontSize: "var(--fs-ui)", lineHeight: 1.45 }}>{goal.description}</p>}
                <p style={{ margin: "var(--sp-8) 0 0", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>{goal.ownerEmployeeId ? roster.find((employee) => employee.id === goal.ownerEmployeeId)?.name ?? goal.ownerEmployeeId : t("goals.company")}</p>
              </div>
              <select aria-label={t("goals.status")} value={goal.status} onChange={(event) => void changeStatus(goal.id, event.target.value as GoalStatus)} style={{ ...fieldStyle, width: "auto", padding: "5px 7px", color: goal.status === "active" ? "var(--accent)" : "var(--text-muted)" }}>
                <option value="active">{t("goals.active")}</option><option value="done">{t("goals.done")}</option><option value="dropped">{t("goals.dropped")}</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "var(--sp-8)", marginTop: "var(--sp-12)" }}>
              <button className="btn ghost sm" onClick={() => { setEditing(goal.id); setCreating(false); }}><Icons.Pencil size={12} /> {t("goals.edit")}</button>
              <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => setDeleting(goal)}><Icons.Trash size={12} /> {t("goals.delete")}</button>
            </div>
          </motion.article>)}
        </div>}
        <AnimatePresence>{creating && <GoalForm goals={goals} roster={roster} initial={blankDraft} submitLabel={t("goals.create")} onCancel={() => setCreating(false)} onSubmit={save} t={t} />}</AnimatePresence>
        <AnimatePresence>{deleting && <DeleteDialog goal={deleting} onCancel={() => setDeleting(null)} onConfirm={remove} t={t} />}</AnimatePresence>
      </main>
    </div>
  );
}

type Translate = (key: "goals.create" | "goals.save" | "goals.cancel" | "goals.titleLabel" | "goals.descriptionOptional" | "goals.owner" | "goals.company" | "goals.parent" | "goals.noParent" | "goals.status" | "goals.active" | "goals.done" | "goals.dropped" | "goals.confirmDelete" | "goals.confirm") => string;
type FormProps = { goals: Goal[]; roster: ReturnType<typeof useRoster>; initial: Draft; submitLabel: string; onCancel: () => void; onSubmit: (draft: Draft) => void; excludeId?: string; t: Translate };

function GoalForm({ goals, roster, initial, submitLabel, onCancel, onSubmit, excludeId, t }: FormProps) {
  const [draft, setDraft] = useState(initial);
  const parents = goals.filter((goal) => goal.id !== excludeId && goal.status === "active");
  return <motion.form initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }} style={{ maxWidth: 880, marginTop: "var(--sp-12)", padding: "var(--sp-16)", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 10, display: "grid", gap: "var(--sp-12)" }}>
    <label style={{ color: "var(--text)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{t("goals.titleLabel")}<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} style={{ ...fieldStyle, marginTop: "var(--sp-6)" }} /></label>
    <label style={{ color: "var(--text)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{t("goals.descriptionOptional")}<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} style={{ ...fieldStyle, marginTop: "var(--sp-6)", resize: "vertical" }} /></label>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--sp-12)" }}>
      <label style={{ color: "var(--text)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{t("goals.owner")}<select value={draft.ownerEmployeeId ?? ""} onChange={(event) => setDraft({ ...draft, ownerEmployeeId: event.target.value || null })} style={{ ...fieldStyle, marginTop: "var(--sp-6)" }}><option value="">{t("goals.company")}</option>{roster.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
      <label style={{ color: "var(--text)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{t("goals.parent")}<select value={draft.parentId ?? ""} onChange={(event) => setDraft({ ...draft, parentId: event.target.value || null })} style={{ ...fieldStyle, marginTop: "var(--sp-6)" }}><option value="">{t("goals.noParent")}</option>{parents.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
      <label style={{ color: "var(--text)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{t("goals.status")}<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as GoalStatus })} style={{ ...fieldStyle, marginTop: "var(--sp-6)" }}><option value="active">{t("goals.active")}</option><option value="done">{t("goals.done")}</option><option value="dropped">{t("goals.dropped")}</option></select></label>
    </div>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-8)" }}><button type="button" className="btn ghost" onClick={onCancel}>{t("goals.cancel")}</button><button className="btn primary" type="submit">{submitLabel}</button></div>
  </motion.form>;
}

function DeleteDialog({ goal, onCancel, onConfirm, t }: { goal: Goal; onCancel: () => void; onConfirm: () => void; t: Translate }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "fixed", inset: 0, background: "color-mix(in srgb, var(--text) 25%, transparent)", display: "grid", placeItems: "center", padding: "var(--sp-16)", zIndex: 20 }}><motion.div initial={{ scale: 0.98, y: 6 }} animate={{ scale: 1, y: 0 }} style={{ maxWidth: 390, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)", borderRadius: 12, padding: "var(--sp-18)", boxShadow: "var(--shadow)" }}><h2 style={{ margin: 0, fontSize: "var(--fs-body)" }}>{goal.title}</h2><p style={{ color: "var(--text-muted)", fontSize: "var(--fs-ui)", lineHeight: 1.5 }}>{t("goals.confirmDelete")}</p><div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-8)" }}><button className="btn ghost" onClick={onCancel}>{t("goals.cancel")}</button><button className="btn" style={{ background: "var(--danger)", color: "var(--surface)" }} onClick={onConfirm}>{t("goals.confirm")}</button></div></motion.div></motion.div>;
}
