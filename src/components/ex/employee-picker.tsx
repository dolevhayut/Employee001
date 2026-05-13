"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { NavArrowRight } from "iconoir-react";
import {
  EMPLOYEES_WITH_TWIN,
  getEmployee,
  type EmployeeWithTwin,
} from "@/lib/employees";

type Props = {
  onSelect?: (id: string) => void;
};

function statusLabel(emp: EmployeeWithTwin): string {
  if (emp.twinStatus === "ready") return "Twin ready";
  if (emp.twinStatus === "building") return "Building twin";
  return "Not started";
}

export function EmployeePicker({ onSelect }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = searchParams.get("employee") ?? EMPLOYEES_WITH_TWIN[0]?.id ?? "";
  const active = getEmployee(activeId) ?? EMPLOYEES_WITH_TWIN[0];

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function pick(emp: EmployeeWithTwin) {
    if (emp.twinStatus !== "ready" && emp.id !== active?.id) {
      // For non-ready employees, still allow selection so the banner shows.
    }
    setOpen(false);
    router.replace(`/flow?employee=${emp.id}`);
    onSelect?.(emp.id);
  }

  // No employees onboarded yet — render a quiet placeholder rather than crash.
  // This is the fresh-install state, before the CEO adds any employees.
  // Hooks above are unconditional so this early return is safe.
  if (!active) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
          padding: "4px 10px",
          fontFamily: '"Manrope", sans-serif',
          fontSize: "var(--fs-ui)",
          color: "#9A9490",
        }}
      >
        No employees yet
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-8)",
          padding: "4px 10px 4px 4px",
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: 100,
          cursor: "pointer",
          fontFamily: '"Manrope", sans-serif',
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#FFFFFF";
          e.currentTarget.style.borderColor = "#EDE8E1";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderColor = "transparent";
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: active.avatarColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--fs-2xs)",
            fontWeight: 700,
            color: "#0A0A0A",
          }}
        >
          {active.initials}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-6)" }}>
          <span
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              color: "#0A0A0A",
              letterSpacing: "-0.01em",
            }}
          >
            {active.name}
          </span>
          <span style={{ fontSize: "var(--fs-meta)", color: "#9A9490" }}>{active.role}</span>
        </div>
        {active.twinStatus === "ready" ? (
          <motion.div
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#22C55E",
              marginLeft: "var(--sp-2)",
            }}
          />
        ) : (
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: active.twinStatus === "building" ? "#F59E0B" : "#C4B4A8",
              marginLeft: "var(--sp-2)",
            }}
          />
        )}
        <NavArrowRight
          width={11}
          height={11}
          strokeWidth={1.5}
          color="#9A9490"
          style={{
            marginLeft: "var(--sp-4)",
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 0.18s",
          }}
        />
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 280,
            background: "#FFFFFF",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            boxShadow: "var(--shadow)",
            padding: "var(--sp-4)",
            zIndex: 50,
          }}
        >
          {EMPLOYEES_WITH_TWIN.map((emp) => {
            const disabled = emp.twinStatus !== "ready";
            const isActive = emp.id === active.id;
            return (
              <button
                key={emp.id}
                type="button"
                onClick={() => {
                  if (disabled) return;
                  pick(emp);
                }}
                disabled={disabled}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-10)",
                  padding: "8px 10px",
                  background: isActive ? "var(--bg-sunken)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                  fontFamily: '"Manrope", sans-serif',
                  opacity: disabled ? 0.55 : 1,
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!disabled && !isActive)
                    e.currentTarget.style.background = "var(--bg-sunken)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: emp.avatarColor,
                    display: "grid",
                    placeItems: "center",
                    fontSize: "var(--fs-xs)",
                    fontWeight: 700,
                    color: "#0A0A0A",
                    flexShrink: 0,
                  }}
                >
                  {emp.initials}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "#0A0A0A" }}>
                    {emp.name}
                  </div>
                  <div style={{ fontSize: "var(--fs-xs)", color: "#9A9490" }}>{emp.role}</div>
                </div>
                <span
                  style={{
                    fontSize: "var(--fs-xs)",
                    color:
                      emp.twinStatus === "ready"
                        ? "#22C55E"
                        : emp.twinStatus === "building"
                          ? "#F59E0B"
                          : "#9A9490",
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                  }}
                >
                  {statusLabel(emp)}
                </span>
              </button>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
