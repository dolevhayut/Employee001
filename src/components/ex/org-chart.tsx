"use client";

import { useMemo, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { EmployeeWithTwin } from "@/lib/employees";

const MARKETPLACE_ID_PREFIX = "marketplace-";

type Props = {
  employees: EmployeeWithTwin[];
  ceoName?: string;
};

type NodeData = {
  label: string;
  sub?: string;
  initials: string;
  color: string;
  kind: "ceo" | "employee" | "agent";
  status?: "ready" | "building" | "pending";
};

function PersonNode({ data }: NodeProps<NodeData>) {
  const isCEO = data.kind === "ceo";
  const ring =
    data.status === "ready"
      ? "var(--success, #4ade80)"
      : data.status === "building"
        ? "var(--warn, #f59e0b)"
        : "var(--hairline)";

  return (
    <div
      style={{
        background: "var(--surface-raised, var(--surface))",
        border: `1px solid ${isCEO ? "var(--text)" : "var(--hairline)"}`,
        borderRadius: 12,
        padding: "10px 14px",
        minWidth: 180,
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: isCEO
          ? "0 2px 12px rgba(0,0,0,0.10)"
          : "0 1px 3px rgba(0,0,0,0.06)",
        fontFamily: "inherit",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "transparent", border: "none", width: 1, height: 1 }}
      />
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: data.color,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontWeight: 650,
          fontSize: 13,
          letterSpacing: "0.02em",
          flexShrink: 0,
          boxShadow: `0 0 0 2px ${ring}`,
        }}
      >
        {data.initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: "var(--fg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 160,
          }}
        >
          {data.label}
        </div>
        {data.sub && (
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 160,
            }}
          >
            {data.sub}
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "transparent", border: "none", width: 1, height: 1 }}
      />
    </div>
  );
}

const nodeTypes = { person: PersonNode };

type Popover = {
  employee: EmployeeWithTwin | null;
  isCEO: boolean;
  x: number;
  y: number;
};

function EmployeePopover({
  popover,
  onClose,
}: {
  popover: Popover;
  onClose: () => void;
}) {
  const { employee, isCEO, x, y } = popover;
  if (isCEO) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.15 }}
        style={popoverShell(x, y)}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 650, color: "var(--fg)", fontSize: 14 }}>
          You (CEO)
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          Founder · Employee001
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          Every onboarded employee and hired agent reports up to you.
        </div>
      </motion.div>
    );
  }
  if (!employee) return null;

  const statusLabel =
    employee.twinStatus === "ready"
      ? "Twin ready"
      : employee.twinStatus === "building"
        ? "Twin building"
        : "Pending";
  const statusColor =
    employee.twinStatus === "ready"
      ? "var(--success, #4ade80)"
      : employee.twinStatus === "building"
        ? "var(--warn, #f59e0b)"
        : "var(--muted)";
  const isAgent = employee.id.startsWith("marketplace-");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      style={popoverShell(x, y)}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: employee.avatarColor,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 650,
            flexShrink: 0,
          }}
        >
          {employee.initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 650,
              color: "var(--fg)",
              fontSize: 14,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {employee.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {employee.role}
          </div>
        </div>
        {isAgent && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 6px",
              borderRadius: 10,
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Agent
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "6px 10px",
          marginTop: 12,
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--muted)" }}>Department</span>
        <span style={{ color: "var(--fg)" }}>{employee.department}</span>

        <span style={{ color: "var(--muted)" }}>Status</span>
        <span style={{ color: "var(--fg)", display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: statusColor,
              flexShrink: 0,
            }}
          />
          {statusLabel}
          {employee.twinStatus === "ready" && (
            <span style={{ color: "var(--muted)" }}>
              · {(employee.twinConfidence * 100).toFixed(0)}% conf.
            </span>
          )}
        </span>

        <span style={{ color: "var(--muted)" }}>Profile</span>
        <span style={{ color: "var(--fg)" }}>
          {employee.profileFilesComplete}/9 files
        </span>

        {employee.placement?.responsibleEmployeeName && (
          <>
            <span style={{ color: "var(--muted)" }}>Reports to</span>
            <span style={{ color: "var(--fg)" }}>
              {employee.placement.responsibleEmployeeName}
            </span>
          </>
        )}

        <span style={{ color: "var(--muted)" }}>Questions / wk</span>
        <span style={{ color: "var(--fg)" }}>{employee.questionsThisWeek}</span>
      </div>

      {employee.skills.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 12,
          }}
        >
          {employee.skills.slice(0, 5).map((s) => (
            <span
              key={s.id}
              style={{
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 10,
                background: "var(--surface)",
                border: "1px solid var(--hairline)",
                color: "var(--muted)",
              }}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <a
          href={`/profile?employee=${employee.id}`}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--text)",
            color: "var(--bg)",
            fontWeight: 600,
            fontSize: 12,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Open profile →
        </a>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 32,
            borderRadius: 8,
            border: "1px solid var(--hairline)",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ×
        </button>
      </div>
    </motion.div>
  );
}

function popoverShell(x: number, y: number) {
  return {
    position: "absolute" as const,
    left: x,
    top: y,
    transform: "translate(-50%, 12px)",
    width: 280,
    background: "var(--surface-raised, var(--surface))",
    border: "1px solid var(--hairline)",
    borderRadius: 12,
    boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
    padding: 14,
    zIndex: 20,
    pointerEvents: "auto" as const,
  };
}

export function OrgChart({ employees, ceoName = "You (CEO)" }: Props) {
  const [popover, setPopover] = useState<Popover | null>(null);
  const { nodes, edges } = useMemo(() => {
    const NODE_W = 220;
    const ROW_H = 110;
    const ROOT_ID = "__ceo__";

    // Split into "direct reports to CEO" vs "hired agents managed by an employee"
    const isAgent = (e: EmployeeWithTwin) => e.id.startsWith(MARKETPLACE_ID_PREFIX);
    const directReports = employees.filter((e) => !isAgent(e));
    const agents = employees.filter(isAgent);

    // Map employee id → list of agents who report to them
    const reportsByManager = new Map<string, EmployeeWithTwin[]>();
    const unmanagedAgents: EmployeeWithTwin[] = [];
    for (const a of agents) {
      const mid = a.placement?.responsibleEmployeeId;
      if (mid && directReports.some((d) => d.id === mid)) {
        const arr = reportsByManager.get(mid) ?? [];
        arr.push(a);
        reportsByManager.set(mid, arr);
      } else {
        // Agent without a real manager — hang directly off CEO
        unmanagedAgents.push(a);
      }
    }

    const topLevel = [...directReports, ...unmanagedAgents];

    // Layout
    const ns: Node<NodeData>[] = [];
    const es: Edge[] = [];

    const totalTopWidth = Math.max(topLevel.length, 1) * NODE_W;
    const startX = -totalTopWidth / 2 + NODE_W / 2;

    // Root CEO
    ns.push({
      id: ROOT_ID,
      type: "person",
      position: { x: -NODE_W / 2 + NODE_W / 2, y: 0 },
      data: {
        label: ceoName,
        sub: "Founder",
        initials: "CEO",
        color: "#111",
        kind: "ceo",
      },
    });

    topLevel.forEach((emp, i) => {
      const x = startX + i * NODE_W;
      ns.push({
        id: emp.id,
        type: "person",
        position: { x, y: ROW_H },
        data: {
          label: emp.name,
          sub: `${emp.role} · ${emp.department}`,
          initials: emp.initials,
          color: emp.avatarColor,
          kind: isAgent(emp) ? "agent" : "employee",
          status: emp.twinStatus,
        },
      });
      es.push({
        id: `e-${ROOT_ID}-${emp.id}`,
        source: ROOT_ID,
        target: emp.id,
        type: "smoothstep",
        animated: false,
        style: { stroke: "var(--hairline-strong, var(--hairline))", strokeWidth: 1.5 },
      });

      // Level 2 — agents managed by this employee
      const reports = reportsByManager.get(emp.id) ?? [];
      if (reports.length > 0) {
        const subWidth = reports.length * NODE_W;
        const subStartX = x - subWidth / 2 + NODE_W / 2;
        reports.forEach((rep, j) => {
          ns.push({
            id: rep.id,
            type: "person",
            position: { x: subStartX + j * NODE_W, y: ROW_H * 2 },
            data: {
              label: rep.name,
              sub: `${rep.role} · agent`,
              initials: rep.initials,
              color: rep.avatarColor,
              kind: "agent",
              status: rep.twinStatus,
            },
          });
          es.push({
            id: `e-${emp.id}-${rep.id}`,
            source: emp.id,
            target: rep.id,
            type: "smoothstep",
            style: {
              stroke: "var(--hairline-strong, var(--hairline))",
              strokeWidth: 1.5,
              strokeDasharray: "4 4",
            },
          });
        });
      }
    });

    return { nodes: ns, edges: es };
  }, [employees, ceoName]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<NodeData>) => {
      event.stopPropagation();
      const container = (event.currentTarget as HTMLElement)
        .closest(".react-flow")
        ?.getBoundingClientRect();
      const target = (event.target as HTMLElement)
        .closest(".react-flow__node")
        ?.getBoundingClientRect();
      if (!container || !target) return;
      const x = target.left - container.left + target.width / 2;
      const y = target.top - container.top + target.height;

      if (node.data.kind === "ceo") {
        setPopover({ employee: null, isCEO: true, x, y });
        return;
      }
      const emp = employees.find((e) => e.id === node.id) ?? null;
      if (emp) setPopover({ employee: emp, isCEO: false, x, y });
    },
    [employees]
  );

  if (employees.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--muted)",
          fontSize: "var(--fs-ui)",
        }}
      >
        Onboard your first employee to see the org chart.
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 460,
        background: "var(--surface)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.6}
        onNodeClick={onNodeClick}
        onPaneClick={() => setPopover(null)}
        onMove={() => setPopover(null)}
      >
        <Background gap={20} size={1} color="var(--hairline)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <AnimatePresence>
        {popover && (
          <EmployeePopover popover={popover} onClose={() => setPopover(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
