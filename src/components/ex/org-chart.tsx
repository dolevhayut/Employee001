"use client";

import { useMemo } from "react";
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

export function OrgChart({ employees, ceoName = "You (CEO)" }: Props) {
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
      >
        <Background gap={20} size={1} color="var(--hairline)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
