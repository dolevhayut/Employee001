"use client";

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Icons } from "@/components/ex/icons";
import { PageHead } from "@/components/ex/page-head";
import { Topbar } from "@/components/ex/shell";
import type { AgentPlacement } from "@/lib/agent-placement";
import { CATEGORY_LABELS, type MarketplaceCategory } from "@/lib/marketplace";

type AgentCard = {
  id: string;
  name: string;
  firstName: string;
  role: string;
  department: string;
  initials: string;
  avatarColor: string;
  category: MarketplaceCategory;
  tagline: string;
  skills: string[];
  suggestedToolkits: string[];
  hired: boolean;
};

type EmployeeOption = {
  id: string;
  name: string;
  firstName: string;
  role: string;
  department: string;
};

const ALL_CATEGORIES: { id: "all" | MarketplaceCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "engineering", label: "Engineering" },
  { id: "product", label: "Product" },
  { id: "sales", label: "Sales" },
  { id: "marketing", label: "Marketing" },
  { id: "data", label: "Data & Analytics" },
  { id: "design", label: "Design" },
  { id: "operations", label: "Operations" },
  { id: "security", label: "Security" },
  { id: "hr", label: "HR & People" },
  { id: "finance", label: "Finance" },
];

function Avatar({ initials, color, size = 44 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.33,
        fontWeight: 600,
        color: "#fff",
        flexShrink: 0,
        letterSpacing: "0.02em",
      }}
    >
      {initials}
    </div>
  );
}

function SkillPill({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 20,
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        fontSize: "var(--fs-meta)",
        color: "var(--muted)",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function AgentCardComponent({
  agent,
  onHire,
  onDismiss,
  loading,
}: {
  agent: AgentCard;
  onHire: (id: string) => void;
  onDismiss: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--surface-raised, var(--surface))",
        border: `1px solid ${agent.hired ? "var(--accent)" : "var(--hairline)"}`,
        borderRadius: 12,
        padding: "var(--sp-20)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-14)",
        transition: "border-color 0.15s, box-shadow 0.15s",
        boxShadow: agent.hired ? "0 0 0 1px var(--accent)20" : "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", gap: "var(--sp-12)", alignItems: "flex-start" }}>
        <Avatar initials={agent.initials} color={agent.avatarColor} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)" }}>
            <span style={{ fontWeight: 600, fontSize: "var(--fs-base)", color: "var(--fg)" }}>
              {agent.name}
            </span>
            {agent.hired && (
              <span
                style={{
                  background: "var(--accent)20",
                  color: "var(--accent)",
                  border: "1px solid var(--accent)40",
                  fontSize: "var(--fs-xs)",
                  fontWeight: 600,
                  padding: "1px 7px",
                  borderRadius: 20,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Hired
              </span>
            )}
          </div>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginTop: "var(--sp-1)" }}>
            {agent.role} · {agent.department}
          </div>
        </div>
        <span
          style={{
            fontSize: "var(--fs-xs)",
            color: "var(--muted)",
            background: "var(--surface)",
            border: "1px solid var(--hairline)",
            padding: "2px 7px",
            borderRadius: 20,
            textTransform: "capitalize",
            whiteSpace: "nowrap",
          }}
        >
          {CATEGORY_LABELS[agent.category]}
        </span>
      </div>

      <p style={{ fontSize: "var(--fs-ui)", color: "var(--fg-sub)", margin: 0, lineHeight: 1.5 }}>
        {agent.tagline}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)" }}>
        {agent.skills.map((s) => (
          <SkillPill key={s} label={s} />
        ))}
      </div>

      <div style={{ marginTop: "auto", display: "flex", gap: "var(--sp-8)" }}>
        {agent.hired ? (
          <>
            <a
              href={`/profile?employee=${agent.id}`}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--sp-6)",
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--surface)",
                border: "1px solid var(--hairline)",
                fontSize: "var(--fs-ui)",
                fontWeight: 500,
                color: "var(--fg)",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              <Icons.Eye size={13} />
              View profile
            </a>
            <button
              onClick={() => onDismiss(agent.id)}
              disabled={loading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--sp-6)",
                padding: "8px 12px",
                borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--hairline)",
                fontSize: "var(--fs-ui)",
                color: "var(--muted)",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              <Icons.X size={13} />
              Leave
            </button>
          </>
        ) : (
          <button
            onClick={() => onHire(agent.id)}
            disabled={loading}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--sp-7)",
              padding: "9px 16px",
              borderRadius: 8,
              background: "var(--text)",
              border: "none",
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              color: "var(--bg)",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {loading ? (
              <Icons.Loader size={13} />
            ) : (
              <Icons.UserPlus size={13} />
            )}
            Hire agent
          </button>
        )}
      </div>
    </div>
  );
}

function HirePlacementModal({
  agent,
  employees,
  placement,
  loading,
  onChange,
  onClose,
  onConfirm,
}: {
  agent: AgentCard;
  employees: EmployeeOption[];
  placement: AgentPlacement;
  loading: boolean;
  onChange: (placement: AgentPlacement) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  function updateTeammates(teammateIds: string[]) {
    const teammateNames = employees
      .filter((employee) => teammateIds.includes(employee.id))
      .map((employee) => employee.name);
    onChange({ ...placement, teammateIds, teammateNames });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hire-placement-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        background: "rgba(0,0,0,0.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--sp-20)",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface-raised, var(--surface))",
          border: "1px solid var(--hairline)",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.2))",
          padding: "var(--sp-22)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-12)" }}>
          <div>
            <div
              id="hire-placement-title"
              style={{ fontSize: "var(--fs-h4)", fontWeight: 650, color: "var(--fg)" }}
            >
              Place {agent.firstName} on the team
            </div>
            <p style={{ margin: "6px 0 0", fontSize: "var(--fs-ui)", color: "var(--muted)", lineHeight: 1.5 }}>
              Choose who owns this agent, where they work, and whether this is a team member
              or an external consultant.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--hairline)",
              background: "transparent",
              color: "var(--muted)",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            <Icons.X size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gap: "var(--sp-14)", marginTop: "var(--sp-20)" }}>
          <label style={{ display: "grid", gap: "var(--sp-6)", fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 600 }}>
            Employment kind
            <select
              value={placement.employmentKind}
              onChange={(event) =>
                onChange({
                  ...placement,
                  employmentKind: event.target.value as AgentPlacement["employmentKind"],
                })
              }
              style={fieldStyle}
            >
              <option value="external_consultant">External consultant</option>
              <option value="team_member">Team member</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: "var(--sp-6)", fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 600 }}>
            Responsible owner
            <select
              value={placement.responsibleEmployeeId}
              onChange={(event) => {
                const owner = employees.find((employee) => employee.id === event.target.value);
                onChange({
                  ...placement,
                  responsibleEmployeeId: event.target.value,
                  responsibleEmployeeName: owner?.name ?? placement.responsibleEmployeeName,
                });
              }}
              style={fieldStyle}
            >
              {employees.length === 0 && (
                <option value={placement.responsibleEmployeeId}>
                  {placement.responsibleEmployeeName}
                </option>
              )}
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} — {employee.role}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "var(--sp-6)", fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 600 }}>
            Team
            <input
              value={placement.teamName}
              onChange={(event) => onChange({ ...placement, teamName: event.target.value })}
              placeholder={agent.department}
              style={fieldStyle}
            />
          </label>

          <div style={{ display: "grid", gap: "var(--sp-8)" }}>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 600 }}>
              Teammates
            </div>
            <div style={{ display: "grid", gap: "var(--sp-6)" }}>
              {employees.map((employee) => {
                const checked = placement.teammateIds.includes(employee.id);
                return (
                  <label
                    key={employee.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-8)",
                      padding: "8px 10px",
                      border: "1px solid var(--hairline)",
                      borderRadius: 8,
                      fontSize: "var(--fs-ui)",
                      color: "var(--fg)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const nextIds = event.target.checked
                          ? [...placement.teammateIds, employee.id]
                          : placement.teammateIds.filter((id) => id !== employee.id);
                        updateTeammates(nextIds);
                      }}
                    />
                    <span>
                      {employee.name}
                      <span style={{ color: "var(--muted)" }}> · {employee.department}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <label style={{ display: "grid", gap: "var(--sp-6)", fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 600 }}>
            Engagement note
            <textarea
              value={placement.engagementNote ?? ""}
              onChange={(event) =>
                onChange({ ...placement, engagementNote: event.target.value })
              }
              placeholder="Example: Use as a part-time advisor for security reviews."
              rows={3}
              style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-10)", marginTop: "var(--sp-22)" }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: "9px 14px",
              borderRadius: 8,
              border: "1px solid var(--hairline)",
              background: "transparent",
              color: "var(--fg)",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !placement.responsibleEmployeeId || !placement.teamName.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-7)",
              padding: "9px 14px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 650,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading ? <Icons.Loader size={13} /> : <Icons.UserPlus size={13} />}
            Join team
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--fg)",
  fontSize: "var(--fs-ui)",
  padding: "9px 10px",
  outline: "none",
};

export default function MarketplacePage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [category, setCategory] = useState<"all" | MarketplaceCategory>("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const [pendingAgent, setPendingAgent] = useState<AgentCard | null>(null);
  const [placementDraft, setPlacementDraft] = useState<AgentPlacement | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const [agentsRes, employeesRes] = await Promise.all([
        fetch("/api/marketplace/agents", { cache: "no-store" }),
        fetch("/api/employees", { cache: "no-store" }),
      ]);
      const data = (await agentsRes.json()) as AgentCard[];
      const employeeData = (await employeesRes.json()) as EmployeeOption[];
      setAgents(data);
      setEmployees(employeeData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  function showToast(msg: string, kind: "success" | "error") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }

  function defaultOwnerFor(agent: AgentCard): EmployeeOption | undefined {
    return (
      employees.find((employee) => employee.department === agent.department) ??
      employees.find((employee) => employee.department === "Engineering") ??
      employees[0]
    );
  }

  function openHirePlacement(agentId: string) {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;

    const owner = defaultOwnerFor(agent);
    setPendingAgent(agent);
    // If no employees onboarded yet (fresh install, no demo), leave the
    // responsible-employee fields empty. The dropdown lets the user pick,
    // and the Confirm button is disabled on falsy responsibleEmployeeId.
    setPlacementDraft({
      employmentKind: "external_consultant",
      responsibleEmployeeId: owner?.id ?? "",
      responsibleEmployeeName: owner?.name ?? "",
      teamName: agent.department,
      teammateIds: owner ? [owner.id] : [],
      teammateNames: owner ? [owner.name] : [],
    });
  }

  async function confirmHire() {
    if (!pendingAgent || !placementDraft) return;
    const agentId = pendingAgent.id;
    setActionLoading(agentId);
    try {
      const res = await fetch("/api/marketplace/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, placement: placementDraft }),
      });
      if (res.ok) {
        setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, hired: true } : a)));
        const agent = agents.find((a) => a.id === agentId);
        showToast(`${agent?.firstName ?? "Agent"} hired — ready on your team`, "success");
        setPendingAgent(null);
        setPlacementDraft(null);
        router.refresh();
      } else {
        const err = (await res.json()) as { error?: string };
        showToast(err.error ?? "Failed to hire agent", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDismiss(agentId: string) {
    setActionLoading(agentId);
    try {
      const res = await fetch(`/api/marketplace/hired/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, hired: false } : a)));
        const agent = agents.find((a) => a.id === agentId);
        showToast(`${agent?.firstName ?? "Agent"} removed from your team`, "success");
        router.refresh();
      } else {
        showToast("Failed to dismiss agent", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = agents.filter((a) => {
    const matchCat = category === "all" || a.category === category;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.role.toLowerCase().includes(q) ||
      a.tagline.toLowerCase().includes(q) ||
      a.skills.some((s) => s.toLowerCase().includes(q));
    return matchCat && matchSearch;
  });

  const hiredCount = agents.filter((a) => a.hired).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar
        crumbs={["Marketplace"]}
        actions={
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
            {agents.length} agents · {hiredCount} hired
          </span>
        }
      />

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: toast.kind === "success" ? "var(--accent)" : "var(--danger)",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: "var(--fs-ui)",
            fontWeight: 500,
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-8)",
          }}
        >
          {toast.kind === "success" ? <Icons.Check size={14} /> : <Icons.X size={14} />}
          {toast.msg}
        </div>
      )}

      {pendingAgent && placementDraft && (
        <HirePlacementModal
          agent={pendingAgent}
          employees={employees}
          placement={placementDraft}
          loading={actionLoading === pendingAgent.id}
          onChange={setPlacementDraft}
          onClose={() => {
            if (actionLoading) return;
            setPendingAgent(null);
            setPlacementDraft(null);
          }}
          onConfirm={confirmHire}
        />
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-24)",
        }}
      >
        <PageHead
          icon="Store"
          title="Hire external AI agents"
          subtitle="Hand-curated agents for roles your team doesn't cover yet. Each comes with a complete 9-file profile, defined expertise, and guardrails — ready to assign tasks on day one."
        />

        <div style={{ display: "flex", gap: "var(--sp-12)", alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-8)",
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 8,
              padding: "7px 12px",
              flex: "1 1 200px",
              maxWidth: 300,
            }}
          >
            <Icons.Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search role, skill…"
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                fontSize: "var(--fs-ui)",
                color: "var(--fg)",
                width: "100%",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)" }}
              >
                <Icons.X size={12} />
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "var(--sp-6)", flexWrap: "wrap" }}>
            {ALL_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 20,
                  border: "1px solid",
                  borderColor: category === cat.id ? "var(--accent)" : "var(--hairline)",
                  background: category === cat.id ? "var(--accent)15" : "transparent",
                  color: category === cat.id ? "var(--accent)" : "var(--muted)",
                  fontSize: "var(--fs-sm)",
                  fontWeight: category === cat.id ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
            <Icons.Loader size={20} style={{ color: "var(--muted)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "var(--muted)",
              fontSize: "var(--fs-base)",
            }}
          >
            <Icons.Search size={32} style={{ marginBottom: "var(--sp-12)", opacity: 0.3 }} />
            <div>No agents match your search</div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "var(--sp-16)",
            }}
          >
            {filtered.map((agent) => (
              <AgentCardComponent
                key={agent.id}
                agent={agent}
                onHire={openHirePlacement}
                onDismiss={handleDismiss}
                loading={actionLoading === agent.id}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
