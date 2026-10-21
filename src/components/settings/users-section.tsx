"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ErrorLine, postJson } from "@/components/auth/auth-form";

// Settings → People and sign-in. Admins add people, set roles, reset
// passwords and disable accounts. Every change is audited server-side.

type Role = "owner" | "admin" | "approver" | "member" | "employee";
type User = { id: string; email: string; name: string; role: Role; employeeId?: string; mfaEnabled: boolean; sso: boolean; disabled: boolean };
type Twin = { id: string; name: string };

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including other owners",
  admin: "Settings, connections, deletion, audit",
  approver: "Uses twins and approves their actions",
  member: "Asks twins, runs meetings and tasks",
  employee: "Sees only their own twin, can withdraw consent",
};
const ROLES = Object.keys(ROLE_HELP) as Role[];

type Loaded = { accounts: boolean; me: { id: string; role: Role } | null; users: User[]; twins: Twin[] };

async function fetchAll(): Promise<Loaded> {
  const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const base = { accounts: Boolean(me?.accounts), me: me?.user ?? null };
  if (!me?.accounts) return { ...base, users: [], twins: [] };
  const users = await fetch("/api/auth/users", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { users: [] })).catch(() => ({ users: [] }));
  const emps = await fetch("/api/employees", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return { ...base, users: (users as { users: User[] }).users, twins: (emps as Twin[]).map((e) => ({ id: e.id, name: e.name })) };
}

export function UsersSection() {
  const [state, setState] = useState<{ accounts: boolean; me: { id: string; role: Role } | null } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [twins, setTwins] = useState<Twin[]>([]);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((d: Loaded) => {
    setState({ accounts: d.accounts, me: d.me });
    setUsers(d.users);
    setTwins(d.twins);
  }, []);
  const load = useCallback(() => fetchAll().then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    fetchAll().then((d) => {
      if (alive) apply(d);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/auth/users/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
    load();
  }

  async function remove(u: User) {
    if (!window.confirm(`Remove ${u.name}'s account? They are signed out right away.`)) return;
    const res = await fetch(`/api/auth/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not remove.");
    load();
  }

  async function resetPassword(u: User) {
    const password = window.prompt(`New password for ${u.name} (at least 12 characters). They'll be signed out everywhere.`);
    if (password) patch(u.id, { password });
  }

  return (
    <section id="people" style={{ marginBottom: "var(--sp-32)" }}>
      <h2 style={{ fontSize: "var(--fs-base)", fontWeight: 600, margin: "0 0 var(--sp-4)" }}>People and sign-in</h2>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: "0 0 var(--sp-12)", lineHeight: 1.5 }}>
        Who can sign in and what each role may do. Your own password and two-factor sign-in are on <Link href="/account">your account</Link>.
      </p>

      {state && !state.accounts ? (
        <div className="card" style={{ padding: "var(--sp-20)", fontSize: "var(--fs-ui)", lineHeight: 1.5 }}>
          No accounts yet: anyone at this machine has full access. <Link href="/auth/setup">Create the owner account</Link> to require sign-in and use roles.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {users.map((u) => (
            <div key={u.id} className="row" style={{ padding: "var(--sp-12) var(--sp-16)", borderBottom: "1px solid var(--hairline)", gap: "var(--sp-12)", alignItems: "center", flexWrap: "wrap", opacity: u.disabled ? 0.55 : 1 }}>
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <div style={{ fontSize: "var(--fs-ui)", fontWeight: 600 }}>{u.name}{u.id === state?.me?.id ? " (you)" : ""}</div>
                <div className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
                  {u.email}
                  {u.mfaEnabled ? " · 2FA on" : ""}
                  {u.sso ? " · SSO" : ""}
                  {u.disabled ? " · disabled" : ""}
                </div>
              </div>
              <label className="subtle" style={{ fontSize: "var(--fs-sm)" }}>
                <span style={{ position: "absolute", left: -9999 }}>Role for {u.name}</span>
                <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} title={ROLE_HELP[u.role]} style={{ fontSize: "var(--fs-sm)" }}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              {u.role === "employee" && (
                <select aria-label={`Twin for ${u.name}`} value={u.employeeId ?? ""} onChange={(e) => patch(u.id, { employeeId: e.target.value || null })} style={{ fontSize: "var(--fs-sm)" }}>
                  <option value="">Pick their twin…</option>
                  {twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              {!u.sso && <button className="btn sm" onClick={() => resetPassword(u)}>Reset password</button>}
              <button className="btn sm" onClick={() => patch(u.id, { disabled: !u.disabled })}>{u.disabled ? "Enable" : "Disable"}</button>
              <button className="btn sm" style={{ color: "var(--danger)" }} onClick={() => remove(u)}>Remove</button>
            </div>
          ))}
          <AddUser twins={twins} canAddOwner={state?.me?.role === "owner"} onAdded={load} />
        </div>
      )}
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

function AddUser({ twins, canAddOwner, onAdded }: { twins: Twin[]; canAddOwner: boolean; onAdded: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { ok, data } = await postJson("/api/auth/users", {
      email,
      name,
      role,
      ...(role === "employee" ? { employeeId } : {}),
      ...(password ? { password } : {}),
    });
    if (!ok) return setError(data.error ?? "Could not add them.");
    setEmail("");
    setName("");
    setPassword("");
    onAdded();
  }

  const input = { fontSize: "var(--fs-sm)", padding: "6px 8px", border: "1px solid var(--hairline-strong)", borderRadius: 4, background: "var(--surface)", color: "var(--text)" } as const;
  return (
    <form onSubmit={submit} style={{ padding: "var(--sp-12) var(--sp-16)", display: "flex", gap: "var(--sp-8)", flexWrap: "wrap", alignItems: "center" }}>
      <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, flex: "1 1 120px" }} />
      <input aria-label="Email" placeholder="email@company.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...input, flex: "1 1 160px" }} />
      <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} style={input}>
        {ROLES.filter((r) => r !== "owner" || canAddOwner).map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {role === "employee" && (
        <select aria-label="Their twin" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={input}>
          <option value="">Pick their twin…</option>
          {twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <input aria-label="Temporary password" placeholder="Temporary password (or SSO only)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input, flex: "1 1 160px" }} autoComplete="new-password" />
      <button className="btn sm primary" disabled={!email}>Add</button>
      {error && <div role="alert" style={{ flexBasis: "100%", fontSize: "var(--fs-sm)", color: "var(--danger)" }}>{error}</div>}
    </form>
  );
}
