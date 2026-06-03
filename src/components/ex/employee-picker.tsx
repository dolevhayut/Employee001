"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { NavArrowRight } from "iconoir-react";
import { type EmployeeWithTwin } from "@/lib/employees";
import { useRoster } from "@/components/ex/roster-context";

type Props = {
  /** Controlled selected id. When provided, the picker reflects this value
   *  instead of reading `?employee=` from the URL. */
  value?: string;
  onSelect?: (id: string) => void;
  /** When true (default), picking navigates to /flow?employee=<id> — the
   *  original top-bar behaviour. Pass false to use it as a pure form control
   *  (e.g. inside a modal) with no routing side effects. */
  navigate?: boolean;
  /** Only offer ready twins (others are shown disabled when false). */
  readyOnly?: boolean;
  placeholder?: string;
};

function statusLabel(emp: EmployeeWithTwin): string {
  if (emp.twinStatus === "ready") return "Twin ready";
  if (emp.twinStatus === "building") return "Building twin";
  return "Not started";
}

function statusColor(emp: EmployeeWithTwin): string {
  if (emp.twinStatus === "ready") return "#22C55E";
  if (emp.twinStatus === "building") return "#F59E0B";
  return "var(--text-subtle)";
}

/**
 * A pretty, theme-aware twin picker — avatar + name + role + twin status —
 * styled as a form-field dropdown. Replaces the bare browser <select> wherever
 * a twin is chosen from a list. Works both as a routing top-bar control
 * (default) and as a controlled form input (`value` + `navigate={false}`).
 */
export function EmployeePicker({ value, onSelect, navigate = true, readyOnly, placeholder }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roster = useRoster();

  const options = useMemo(
    () => (readyOnly ? roster.filter((e) => e.twinStatus === "ready") : roster),
    [roster, readyOnly]
  );

  const activeId = value ?? searchParams.get("employee") ?? roster[0]?.id ?? "";
  const active = roster.find((e) => e.id === activeId) ?? options[0];

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(emp: EmployeeWithTwin) {
    setOpen(false);
    if (navigate) router.replace(`/flow?employee=${emp.id}`);
    onSelect?.(emp.id);
  }

  // Fresh-install state — no employees yet. Hooks above are unconditional so
  // this early return is safe.
  if (!active) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 10px",
          fontSize: "var(--fs-ui)",
          color: "var(--text-subtle)",
          border: "1px solid var(--hairline)",
          borderRadius: 6,
          background: "var(--surface)",
        }}
      >
        {placeholder ?? "No employees yet"}
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-10)",
          padding: "6px 10px",
          background: "var(--surface)",
          border: `1px solid ${open ? "var(--accent-soft, var(--hairline))" : "var(--hairline)"}`,
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: "inherit",
          boxSizing: "border-box",
          transition: "border-color 0.15s",
        }}
      >
        <Avatar emp={active} />
        <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <div
            style={{
              fontSize: "var(--fs-ui)",
              fontWeight: 600,
              color: "var(--text)",
              letterSpacing: "-0.01em",
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {active.name}
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", lineHeight: 1.25 }}>
            {active.role}
          </div>
        </div>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: statusColor(active),
            flexShrink: 0,
          }}
        />
        <NavArrowRight
          width={12}
          height={12}
          strokeWidth={1.5}
          color="var(--text-subtle)"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.18s", flexShrink: 0 }}
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
            width: "100%",
            minWidth: 240,
            maxHeight: 280,
            overflowY: "auto",
            background: "var(--bg-elevated)",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            boxShadow: "var(--shadow)",
            padding: "var(--sp-4)",
            zIndex: 50,
          }}
          className="scrollbar"
        >
          {options.map((emp) => {
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
                  fontFamily: "inherit",
                  opacity: disabled ? 0.55 : 1,
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!disabled && !isActive) e.currentTarget.style.background = "var(--bg-sunken)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <Avatar emp={emp} size={28} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)" }}>
                    {emp.name}
                  </div>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{emp.role}</div>
                </div>
                <span
                  style={{
                    fontSize: "var(--fs-xs)",
                    color: statusColor(emp),
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                    flexShrink: 0,
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

function Avatar({ emp, size = 26 }: { emp: EmployeeWithTwin; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: emp.avatarColor,
        display: "grid",
        placeItems: "center",
        fontSize: size >= 28 ? "var(--fs-xs)" : "var(--fs-2xs)",
        fontWeight: 700,
        color: "#0A0A0A",
        flexShrink: 0,
      }}
    >
      {emp.initials}
    </div>
  );
}
