"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HalfMoon, NavArrowDown, SunLight } from "iconoir-react";
import { Icons, type IconName } from "./icons";
import { type EmployeeWithTwin } from "@/lib/employees";
import { GlobalApprovalOverlay, NotificationBell } from "./global-approval-overlay";
import { ActiveBuildsBanner } from "./active-builds-banner";
import { RosterProvider, useRoster } from "./roster-context";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

type CommandItem = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  group: "Popular" | "Navigate" | "Twins";
  hint: string;
  keywords: string;
};

const SIDEBAR_NAV: NavSection[] = [
  {
    label: "Operate",
    items: [
      { href: "/employees", label: "Employees", icon: "Home" },
      { href: "/inbox", label: "Inbox", icon: "Bell" },
      { href: "/tasks", label: "Tasks", icon: "Zap" },
      { href: "/flow", label: "Twins", icon: "Bot" },
      { href: "/council", label: "Team Meeting", icon: "Team" },
    ],
  },
  {
    label: "Observe",
    items: [
      { href: "/cockpit", label: "Cockpit", icon: "Activity" },
      { href: "/budgets", label: "Budgets", icon: "DollarSign" },
    ],
  },
  {
    label: "Automate",
    items: [
      { href: "/routines", label: "Routines", icon: "Refresh" },
      { href: "/templates", label: "Templates", icon: "Doc" },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/connections", label: "Connections", icon: "Plug" },
    ],
  },
];

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem("em001-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: "light" | "dark" =
      saved === "dark" || saved === "light" ? saved : prefersDark ? "dark" : "light";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("em001-theme", next);
      return next;
    });
  }, []);

  return { theme, toggle };
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <SunLight width={13} height={13} /> : <HalfMoon width={13} height={13} />}
    </button>
  );
}

// Company-wide monthly budget for twin task execution.
// Will become configurable per workspace in a follow-up; the meter math doesn't
// need to change when that lands — only this constant moves into a setting.
const COMPANY_MONTHLY_BUDGET_USD = 50;

const STATIC_COMMANDS: CommandItem[] = [
  { id: "home", label: "Employees", href: "/employees", icon: "Home", group: "Popular", hint: "Open CEO admin roster", keywords: "people team admin roster clone status" },
  { id: "inbox", label: "Inbox", href: "/inbox", icon: "Bell", group: "Popular", hint: "Org-wide feed of twin activity, alerts, and approvals", keywords: "feed activity alerts review approval flagged updates" },
  { id: "cockpit", label: "Cockpit", href: "/cockpit", icon: "Activity", group: "Popular", hint: "Live grid of every running agent — what they're doing right now", keywords: "live agents running cockpit monitor real-time" },
  { id: "tasks", label: "Tasks", href: "/tasks", icon: "Zap", group: "Popular", hint: "Run or review twin tasks", keywords: "agent execution work runs retry" },
  { id: "twins", label: "Twins", href: "/flow", icon: "Bot", group: "Popular", hint: "Open memory graph and chat", keywords: "memory graph chat ask clone" },
  { id: "connections", label: "Connections", href: "/connections", icon: "Plug", group: "Navigate", hint: "Manage connected tools", keywords: "integrations composio slack github gmail tools" },
  { id: "marketplace", label: "Marketplace", href: "/marketplace", icon: "Store", group: "Navigate", hint: "Hire specialized agents", keywords: "agents hire catalog" },
  { id: "council", label: "Team Meeting", href: "/council", icon: "Team", group: "Navigate", hint: "Open the council room", keywords: "meeting team debate room" },
  { id: "templates", label: "Templates", href: "/templates", icon: "Doc", group: "Navigate", hint: "Browse task templates", keywords: "slash commands prompts snippets" },
  { id: "routines", label: "Routines", href: "/routines", icon: "Refresh", group: "Navigate", hint: "Schedule recurring work", keywords: "automation schedule recurring cron" },
  { id: "focus", label: "Focus", href: "/focus", icon: "Eye", group: "Navigate", hint: "Configure per-twin world prefetch (PRs, Linear, Gmail) before each shift", keywords: "focus prefetch composio github linear gmail world state" },
  { id: "audit", label: "Audit log", href: "/audit", icon: "Logs", group: "Navigate", hint: "Review approvals and actions", keywords: "compliance approvals trace history" },
  { id: "workspace-costs", label: "Workspace costs", href: "/workspace", icon: "Zap", group: "Navigate", hint: "Review training, refresh, and execution spend", keywords: "workspace costs budget spend usage billing models" },
  { id: "budgets", label: "Budgets", href: "/budgets", icon: "DollarSign", group: "Navigate", hint: "Set daily spend caps per twin", keywords: "budgets limits caps spend cost per twin daily" },
  { id: "settings", label: "Settings", href: "/settings", icon: "Settings", group: "Navigate", hint: "Workspace configuration", keywords: "workspace org skills mcp account" },
];

function formatBudgetCost(usd: number): string {
  if (usd >= 10) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd > 0) return `$${usd.toFixed(3)}`;
  return "$0";
}

function BudgetMeter() {
  const [spend, setSpend] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const fetchCosts = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/costs?month=current", {
        cache: "no-store",
      });
      const data = (await res.json()) as { totalUsd?: number };
      setSpend(typeof data.totalUsd === "number" ? data.totalUsd : 0);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  // Initial fetch + poll every 30s while the tab is visible. Lightweight and
  // catches new task completions without requiring cross-component plumbing.
  useEffect(() => {
    const initialFetch = window.setTimeout(fetchCosts, 0);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchCosts();
    }, 30_000);
    const onFocus = () => fetchCosts();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initialFetch);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchCosts]);

  const budget = COMPANY_MONTHLY_BUDGET_USD;
  const pct = budget > 0 ? Math.min(1, spend / budget) : 0;
  const overBudget = spend > budget;
  const tone =
    pct >= 1 ? "danger" : pct >= 0.8 ? "warn" : pct >= 0.5 ? "warn-soft" : "success";
  const barColor =
    tone === "danger"
      ? "var(--danger)"
      : tone === "warn"
      ? "var(--warn)"
      : tone === "warn-soft"
      ? "var(--warn)"
      : "var(--success)";

  return (
    <Link
      href="/workspace"
      title="Click to view per-employee execution costs"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-6)",
        padding: "10px 10px",
        background: "var(--surface-soft)",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color .12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--hairline-strong)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--hairline)";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--sp-6)",
        }}
      >
        <span
          style={{
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: ".06em",
          }}
        >
          Twin spend · MTD
        </span>
        <div style={{ flex: 1 }} />
        <span
          className="mono"
          style={{
            fontSize: "var(--fs-xs)",
            color: overBudget ? "var(--danger)" : "var(--text-subtle)",
            fontWeight: 600,
          }}
        >
          {Math.round(pct * 100)}%
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--sp-4)",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: "var(--fs-base)",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: overBudget ? "var(--danger)" : "var(--text)",
          }}
        >
          {loaded ? formatBudgetCost(spend) : "—"}
        </span>
        <span
          className="mono subtle"
          style={{ fontSize: "var(--fs-meta)" }}
        >
          / {formatBudgetCost(budget)}
        </span>
      </div>

      <div
        style={{
          height: 4,
          background: "var(--bg-sunken)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: pct * 100 + "%",
            height: "100%",
            background: barColor,
            borderRadius: 2,
            transition: "width .25s ease, background .15s",
          }}
        />
      </div>
    </Link>
  );
}

function statusDot(status: EmployeeWithTwin["twinStatus"]) {
  if (status === "ready") return "dot success pulse";
  if (status === "building") return "dot warn";
  return "dot idle";
}

function statusLabel(emp: EmployeeWithTwin) {
  if (emp.twinStatus === "ready") return "Twin ready";
  if (emp.twinStatus === "building") return `Building · ${emp.profileFilesComplete}/13 files`;
  return "Not started";
}

function buildTwinCommands(roster: EmployeeWithTwin[]): CommandItem[] {
  return roster.flatMap((emp) => {
    const flowHref = emp.twinStatus === "ready" ? `/flow?employee=${emp.id}` : "/clone";
    const statusKeyword = emp.twinStatus === "ready" ? "ready live chat memory" : "onboarding setup clone";

    return [
      {
        id: `twin-${emp.id}`,
        label: `${emp.name} twin`,
        href: flowHref,
        icon: "Bot",
        group: "Twins",
        hint: emp.twinStatus === "ready" ? "Open live twin chat" : "Start onboarding",
        keywords: `${emp.name} ${emp.firstName} ${emp.role} ${statusKeyword}`,
      },
      {
        id: `profile-${emp.id}`,
        label: `${emp.name} profile`,
        href: `/profile?employee=${emp.id}`,
        icon: "Doc",
        group: "Twins",
        hint: "View profile, consent, lineage",
        keywords: `${emp.name} ${emp.firstName} profile sources voice skills consent`,
      },
    ];
  });
}

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const roster = useRoster();
  const commands = useMemo(() => [...STATIC_COMMANDS, ...buildTwinCommands(roster)], [roster]);
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.hint} ${command.keywords}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [commands, query]);

  const groupedCommands = useMemo(() => {
    const groups: CommandItem["group"][] = ["Popular", "Navigate", "Twins"];
    return groups
      .map((group) => ({
        group,
        items: filteredCommands.filter((command) => command.group === group),
      }))
      .filter((section) => section.items.length > 0);
  }, [filteredCommands]);

  const close = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    onOpenChange(false);
  }, [onOpenChange]);

  const openPalette = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    onOpenChange(true);
  }, [onOpenChange]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const isCommandK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!isCommandK) return;
      event.preventDefault();
      if (open) close();
      else openPalette();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open, openPalette]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const runCommand = useCallback(
    (command: CommandItem) => {
      close();
      router.push(command.href);
    },
    [close, router]
  );

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(filteredCommands.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && filteredCommands[activeIndex]) {
      event.preventDefault();
      runCommand(filteredCommands[activeIndex]);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "start center",
        padding: "12vh 20px 20px",
        background: "color-mix(in oklch, var(--text) 28%, transparent)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(680px, 100%)",
          overflow: "hidden",
          background: "var(--surface)",
          border: "1px solid var(--hairline-strong)",
          borderRadius: 8,
          boxShadow: "var(--shadow-dialog)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-12)",
            padding: "14px 16px",
            borderBottom: "1px solid var(--hairline)",
            background: "var(--bg-elevated)",
          }}
        >
          <Icons.Search size={16} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages, twins, tasks..."
            aria-label="Search commands"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text)",
              fontSize: "var(--fs-lg)",
              fontWeight: 500,
            }}
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="scrollbar" style={{ maxHeight: "min(520px, 62vh)", overflow: "auto", padding: "var(--sp-8)" }}>
          {groupedCommands.length === 0 ? (
            <div style={{ padding: "34px 18px", textAlign: "center" }}>
              <div style={{ fontSize: "var(--fs-base)", fontWeight: 650 }}>No commands found</div>
              <div className="subtle" style={{ marginTop: "var(--sp-6)", fontSize: "var(--fs-sm)" }}>
                Try searching for a page, employee, or workflow.
              </div>
            </div>
          ) : (
            groupedCommands.map((section) => (
              <div key={section.group} style={{ padding: "7px 0" }}>
                <div className="nav-label" style={{ padding: "4px 8px 6px" }}>
                  {section.group}
                </div>
                {section.items.map((command) => {
                  const index = filteredCommands.indexOf(command);
                  const active = index === activeIndex;
                  const Icon = Icons[command.icon];

                  return (
                    <button
                      key={command.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => runCommand(command)}
                      style={{
                        width: "100%",
                        minHeight: 48,
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--sp-12)",
                        padding: "9px 10px",
                        border: "1px solid " + (active ? "var(--hairline-strong)" : "transparent"),
                        borderRadius: 6,
                        background: active ? "var(--surface-soft)" : "transparent",
                        color: "var(--text)",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0,
                          border: "1px solid var(--hairline)",
                          borderRadius: 6,
                          background: active ? "var(--bg)" : "var(--bg-elevated)",
                          color: active ? "var(--accent)" : "var(--text-muted)",
                        }}
                      >
                        <Icon size={14} />
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: "var(--fs-ui)", fontWeight: 650 }}>
                          {command.label}
                        </span>
                        <span className="subtle" style={{ display: "block", marginTop: "var(--sp-2)", fontSize: "var(--fs-meta)" }}>
                          {command.hint}
                        </span>
                      </span>
                      <span className="kbd" style={{ opacity: active ? 1 : 0 }}>
                        Enter
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-10)",
            padding: "10px 14px",
            borderTop: "1px solid var(--hairline)",
            background: "var(--bg-elevated)",
            color: "var(--text-subtle)",
            fontSize: "var(--fs-meta)",
          }}
        >
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> Navigate</span>
          <span><span className="kbd">Enter</span> Open</span>
          <div className="spacer" />
          <span className="mono">{filteredCommands.length} commands</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function TwinSwitcher() {
  const router = useRouter();
  const roster = useRoster();
  const defaultTwin = roster.find((e) => e.twinStatus === "ready") ?? roster[0];
  const [active, setActive] = useState<EmployeeWithTwin | undefined>(defaultTwin);

  // Sync local active state when roster hydrates from /api/employees on mount.
  useEffect(() => {
    if (active) return;
    const next = roster.find((e) => e.twinStatus === "ready") ?? roster[0];
    if (next) setActive(next);
  }, [roster, active]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(emp: EmployeeWithTwin) {
    setActive(emp);
    setOpen(false);
    if (emp.twinStatus === "ready") {
      router.push(`/flow?employee=${emp.id}`);
    }
  }

  if (!active) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
        <div className="nav-label">Active twin</div>
        <div className="subtle" style={{ fontSize: "var(--fs-meta)", padding: "8px 4px" }}>
          No employees yet.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
      <div className="nav-label">Active twin</div>

      <div ref={ref} style={{ position: "relative", marginTop: "var(--sp-4)" }}>
        {/* Trigger */}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: "100%",
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-9)",
            background: open ? "var(--surface)" : "var(--surface-soft)",
            border: "1px solid var(--hairline)",
            borderRadius: open ? "6px 6px 0 0" : 6,
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "inherit",
            transition: "background .12s",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: active.avatarColor,
              display: "grid",
              placeItems: "center",
              fontSize: "var(--fs-xs)",
              fontWeight: 700,
              color: "var(--text)",
              flexShrink: 0,
            }}
          >
            {active.initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
              {active.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", marginTop: "var(--sp-2)" }}>
              <span className={statusDot(active.twinStatus)} style={{ boxShadow: "none", flexShrink: 0 }} />
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>{statusLabel(active)}</span>
            </div>
          </div>
          <NavArrowDown
            width={10}
            height={10}
            strokeWidth={1.4}
            style={{ flexShrink: 0, opacity: 0.4, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
          />
        </button>

        {/* Dropdown */}
        {open && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
              overflow: "hidden",
              zIndex: 50,
              boxShadow: "var(--shadow-dropdown)",
            }}
          >
            {roster.map((emp) => {
              const isCurrent = emp.id === active.id;
              return (
                <button
                  key={emp.id}
                  onClick={() => select(emp)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-9)",
                    background: isCurrent ? "var(--bg-sunken)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "background .1s",
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--bg-sunken)"; }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: emp.avatarColor,
                      display: "grid",
                      placeItems: "center",
                      fontSize: "var(--fs-2xs)",
                      fontWeight: 700,
                      color: "var(--text)",
                      flexShrink: 0,
                      opacity: emp.twinStatus === "pending" ? 0.5 : 1,
                    }}
                  >
                    {emp.initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: emp.twinStatus === "pending" ? "var(--text-muted)" : "var(--text)" }}>
                      {emp.name}
                    </div>
                  </div>
                  <span className={statusDot(emp.twinStatus)} style={{ boxShadow: "none", flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Status card */}
      <div className="card" style={{ padding: "var(--sp-10)", marginTop: "var(--sp-4)", background: "var(--surface-soft)" }}>
        {active.twinStatus === "ready" && (
          <>
            <div className="row" style={{ gap: "var(--sp-8)" }}>
              <div className="dot success pulse" />
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500 }}>Twin is live</span>
            </div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-4)", lineHeight: 1.4 }}>
              Answering on{" "}
              <span className="mono">#ask-{active.firstName.toLowerCase()}</span>{" "}
              · threshold 0.70
            </div>
            <button className="btn sm" style={{ marginTop: "var(--sp-8)", width: "100%", justifyContent: "center" }}>
              Pause twin
            </button>
          </>
        )}
        {active.twinStatus === "building" && (
          <>
            <div className="row" style={{ gap: "var(--sp-8)" }}>
              <Icons.Refresh size={11} className="spin" style={{ color: "var(--warn)", flexShrink: 0 }} />
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500 }}>Building profile</span>
            </div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-4)", lineHeight: 1.4 }}>
              {active.profileFilesComplete} of 12 files complete. Ready soon.
            </div>
          </>
        )}
        {active.twinStatus === "pending" && (
          <>
            <div className="row" style={{ gap: "var(--sp-8)" }}>
              <div className="dot idle" />
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-muted)" }}>Not started</span>
            </div>
            <div className="subtle" style={{ fontSize: "var(--fs-meta)", marginTop: "var(--sp-4)", lineHeight: 1.4 }}>
              {active.firstName}&apos;s twin hasn&apos;t been set up yet.
            </div>
            <Link
              href={`/clone`}
              className="btn sm"
              style={{ marginTop: "var(--sp-8)", width: "100%", justifyContent: "center", textDecoration: "none" }}
            >
              Start onboarding
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

const SIDEBAR_COLLAPSED_KEY = "em001-sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (saved === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  const w = collapsed ? 52 : 232;

  return (
    <aside
      style={{
        width: w,
        minWidth: w,
        background: "var(--bg-elevated)",
        borderRight: "1px solid var(--hairline)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width .18s ease, min-width .18s ease",
      }}
    >
      {/* Brand — pinned top */}
      <div
        className="brand"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-9)",
          padding: collapsed ? "14px 0 10px" : "14px 20px 10px",
          justifyContent: collapsed ? "center" : undefined,
          flexShrink: 0,
        }}
      >
        <Image
          src="/logo.svg"
          alt="Employee001"
          width={22}
          height={22}
          priority
          className="brand-logo"
          style={{ display: "block", flexShrink: 0 }}
        />
        {!collapsed && (
          <>
            <div style={{ fontWeight: 600, fontSize: "var(--fs-base)", letterSpacing: "-0.015em", whiteSpace: "nowrap" }}>
              Employee001{" "}
              <em style={{ fontStyle: "normal", color: "var(--text-muted)", fontWeight: 400, marginLeft: "var(--sp-4)", fontSize: "var(--fs-meta)" }}>
                v0.4
              </em>
            </div>
            <div className="spacer" />
            <NotificationBell />
          </>
        )}
      </div>

      {/* Scrollable middle */}
      <div
        className="scrollbar"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: collapsed ? "0 6px" : "0 12px",
          display: "flex",
          flexDirection: "column",
          gap: collapsed ? 2 : 14,
          transition: "padding .18s ease",
        }}
      >
        {/* Workspace nav */}
        <div style={{ display: "flex", flexDirection: "column", gap: collapsed ? 2 : 9 }}>
          {SIDEBAR_NAV.map((section) => (
            <div key={section.label} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
              {!collapsed && <div className="nav-label">{section.label}</div>}
              {collapsed && <div style={{ height: 6 }} />}
              {section.items.map((item) => {
                const Icon = Icons[item.icon];
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={"nav-item " + (isActive ? "active" : "")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: collapsed ? "center" : undefined,
                      gap: "var(--sp-9)",
                      padding: collapsed ? "7px 0" : "6px 8px",
                      fontSize: "var(--fs-ui)",
                      color: isActive ? "var(--text)" : "var(--text-muted)",
                      background: isActive ? "var(--surface)" : "transparent",
                      borderRadius: 4,
                      fontWeight: 500,
                      letterSpacing: "-0.005em",
                      textDecoration: "none",
                      boxShadow: isActive ? "var(--shadow-sm)" : "none",
                    }}
                  >
                    <Icon size={14} style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0 }} />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Budget meter — hidden when collapsed */}
        {!collapsed && <BudgetMeter />}

        {/* Bottom padding inside scroll area */}
        <div style={{ height: 8 }} />
      </div>

      {/* Pinned bottom */}
      <div
        style={{
          flexShrink: 0,
          padding: collapsed ? "8px 6px 12px" : "8px 12px 12px",
          borderTop: "1px solid var(--hairline)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
        }}
      >
        <Link
          href="/settings"
          title={collapsed ? "Settings" : undefined}
          className="nav-item"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : undefined,
            gap: "var(--sp-9)",
            padding: collapsed ? "7px 0" : "6px 8px",
            fontSize: "var(--fs-ui)",
            color: "var(--text-muted)",
            borderRadius: 4,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          <Icons.Settings size={14} style={{ opacity: 0.7 }} />
          {!collapsed && <span>Settings</span>}
        </Link>

        {/* Admin footer */}
        {!collapsed && (
          <div
            style={{
              marginTop: "var(--sp-4)",
              padding: "8px",
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-9)",
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                background: "var(--bg-sunken)",
                color: "var(--text-muted)",
                display: "grid",
                placeItems: "center",
                fontWeight: 600,
                fontSize: "var(--fs-xs)",
                borderRadius: "50%",
                flexShrink: 0,
                border: "1px solid var(--hairline)",
              }}
            >
              A
            </div>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text)" }}>Admin</div>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>Employee001</div>
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : undefined,
            gap: "var(--sp-8)",
            padding: collapsed ? "7px 0" : "6px 8px",
            border: "none",
            borderRadius: 4,
            background: "transparent",
            color: "var(--text-subtle)",
            cursor: "pointer",
            fontSize: "var(--fs-meta)",
            fontFamily: "inherit",
            width: "100%",
            transition: "background .1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-sunken)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <Icons.ChevronLeft
            size={13}
            style={{
              flexShrink: 0,
              transition: "transform .18s ease",
              transform: collapsed ? "rotate(180deg)" : "none",
            }}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

export function Topbar({ crumbs = [], actions }: { crumbs?: string[]; actions?: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <>
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg)",
          gap: "var(--sp-16)",
          flexShrink: 0,
        }}
      >
        <div className="row" style={{ gap: "var(--sp-8)", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-8)" }}>
              {i > 0 && <span style={{ color: "var(--text-subtle)" }}>/</span>}
              <span
                style={{
                  color: i === crumbs.length - 1 ? "var(--text)" : undefined,
                  fontWeight: i === crumbs.length - 1 ? 600 : 500,
                }}
              >
                {c}
              </span>
            </span>
          ))}
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: "var(--sp-8)" }}>
          {actions}
          <ThemeToggle />
          <button
            type="button"
            className="btn ghost sm"
            title="Open command palette"
            aria-haspopup="dialog"
            aria-expanded={commandOpen}
            onClick={() => setCommandOpen(true)}
          >
            <Icons.Search size={13} /> <span className="kbd">⌘K</span>
          </button>
        </div>
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <RosterProvider>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          height: "100vh",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <Sidebar />
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
          {children}
        </div>
        <GlobalApprovalOverlay />
        <ActiveBuildsBanner />
      </div>
    </RosterProvider>
  );
}
