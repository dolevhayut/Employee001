"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import HeroCanvas from "./HeroCanvas";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BookStack,
  Calendar,
  ChatBubble,
  ChatLines,
  Code,
  Database,
  Group,
  HalfMoon,
  Mail,
  Network,
  Page,
  Shield,
  ShoppingBag,
  Sparks,
  SunLight,
  TaskList,
  UserCircle,
} from "iconoir-react";
import { trackLandingEvent } from "@/lib/landing-analytics";

const USP_ITEMS = [
  {
    title: "Your organizational brain",
    body: "Turn scattered expertise, decisions, and work patterns into one living intelligence layer your company can query, trust, and grow.",
    Icon: Database,
  },
  {
    title: "Agent twins for every employee",
    body: "Give every employee an always-on AI twin that understands their role, context, work style, and expertise.",
    Icon: UserCircle,
  },
  {
    title: "Run team meetings with digital twins",
    body: "Ask one question and let multiple employee agents discuss, challenge, and build a shared answer together.",
    Icon: ChatLines,
  },
  {
    title: "Connected to the way people actually work",
    body: "Employee001 plugs into each employee’s tools, files, conversations, and workflows to learn from real work in context.",
    Icon: Network,
  },
  {
    title: "From knowledge to execution",
    body: "Employee001 doesn’t just answer questions. It drafts, coordinates, follows up, and gets work done through connected tools.",
    Icon: TaskList,
  },
] as const;

const INTEGRATIONS = [
  { label: "Email", Icon: Mail },
  { label: "Calendar", Icon: Calendar },
  { label: "Documents", Icon: Page },
  { label: "Chat", Icon: ChatLines },
  { label: "Tasks", Icon: TaskList },
  { label: "Code repositories", Icon: Code },
  { label: "CRM", Icon: ShoppingBag },
  { label: "Knowledge bases", Icon: BookStack },
  { label: "Internal tools", Icon: Network },
] as const;

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

function SectionTitle({
  eyebrow,
  title,
  className,
}: {
  eyebrow?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={cx("mb-8 max-w-2xl", className)}>
      {eyebrow ? (
        <p
          className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--lp-text-muted)" }}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        className="text-balance text-4xl tracking-tight sm:text-5xl"
        style={{
          fontFamily: "var(--font-instrument-serif), 'Instrument Serif', serif",
          fontWeight: 400,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
    </div>
  );
}

function IntegrationsOrbit() {
  const rowA = [
    "Gmail",
    "Slack",
    "Notion",
    "GitHub",
    "Linear",
    "Jira",
    "Asana",
    "Calendly",
    "Trello",
    "Discord",
  ];
  const rowB = [
    "Google Drive",
    "Dropbox",
    "Salesforce",
    "HubSpot",
    "Figma",
    "Airtable",
    "Stripe",
    "Zoom",
    "Intercom",
    "Front",
  ];
  const rowC = [
    "Confluence",
    "Outlook",
    "Microsoft Teams",
    "ClickUp",
    "Monday",
    "Pipedrive",
    "Mailchimp",
    "Twilio",
    "Zapier",
    "Loom",
  ];

  return (
    <div
      className="relative overflow-hidden rounded-[var(--lp-radius)] border"
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, color-mix(in oklch, var(--lp-dot) 14%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24"
        style={{
          background:
            "linear-gradient(to right, var(--lp-surface), transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24"
        style={{
          background:
            "linear-gradient(to left, var(--lp-surface), transparent)",
        }}
      />

      <div className="relative space-y-3 py-10 sm:py-12">
        <OrbitRow items={rowA} duration={42} reverse={false} />
        <OrbitRow items={rowB} duration={52} reverse={true} />
        <OrbitRow items={rowC} duration={46} reverse={false} />
      </div>

      {/* Composio hub overlay */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <motion.div
          className="flex items-center gap-3 rounded-full border px-5 py-3 backdrop-blur-md"
          style={{
            borderColor: "var(--lp-border)",
            background:
              "color-mix(in oklch, var(--lp-surface) 78%, transparent)",
            boxShadow: "0 12px 40px -8px color-mix(in oklch, var(--lp-dot) 30%, transparent)",
          }}
          animate={{
            boxShadow: [
              "0 12px 40px -8px color-mix(in oklch, var(--lp-dot) 18%, transparent)",
              "0 12px 60px -4px color-mix(in oklch, var(--lp-dot) 36%, transparent)",
              "0 12px 40px -8px color-mix(in oklch, var(--lp-dot) 18%, transparent)",
            ],
          }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background:
                "linear-gradient(135deg, var(--lp-dot), color-mix(in oklch, var(--lp-dot) 40%, var(--lp-surface)))",
            }}
          >
            <Network
              width={16}
              height={16}
              strokeWidth={1.7}
              style={{ color: "var(--lp-bg)" }}
            />
          </div>
          <div className="leading-tight">
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--lp-text-muted)" }}
            >
              Powered by
            </p>
            <p className="text-[14px] font-semibold">Composio MCP</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function OrbitRow({
  items,
  duration,
  reverse,
}: {
  items: readonly string[];
  duration: number;
  reverse: boolean;
}) {
  const doubled = [...items, ...items];
  const fromTo = reverse ? ["-50%", "0%"] : ["0%", "-50%"];
  return (
    <div className="overflow-hidden">
      <motion.div
        className="flex w-max gap-3 pr-3"
        animate={{ x: fromTo }}
        transition={{ duration, repeat: Infinity, ease: "linear" }}
      >
        {doubled.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium"
            style={{
              borderColor: "var(--lp-border)",
              background: "var(--lp-surface-alt)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--lp-dot)" }}
            />
            {label}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

function useLandingTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem("em001-theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
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

function LandingThemeToggle() {
  const { theme, toggle } = useLandingTheme();
  const label =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
        color: "var(--lp-text-muted)",
      }}
    >
      {theme === "dark" ? (
        <SunLight width={16} height={16} strokeWidth={1.5} />
      ) : (
        <HalfMoon width={16} height={16} strokeWidth={1.5} />
      )}
    </button>
  );
}

const OUTPUTS = [
  {
    id: "slack",
    label: "Slack post",
    by: "Dana (Product twin)",
    target: "#general",
    cycleMs: 6000,
  },
  {
    id: "linear",
    label: "Linear ticket",
    by: "Arie (Engineering twin)",
    target: "ENG-482",
    cycleMs: 6000,
  },
  {
    id: "email",
    label: "Email draft",
    by: "Noa (Sales twin)",
    target: "To: launch-team@",
    cycleMs: 6500,
  },
  {
    id: "doc",
    label: "Doc summary",
    by: "Tamar (Support twin)",
    target: "Weekly digest",
    cycleMs: 6000,
  },
] as const;

function OutputGallery() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const t = setTimeout(
      () => setActiveIdx((i) => (i + 1) % OUTPUTS.length),
      OUTPUTS[activeIdx].cycleMs,
    );
    return () => clearTimeout(t);
  }, [activeIdx]);

  const active = OUTPUTS[activeIdx];

  return (
    <div className="mx-auto max-w-4xl">
      {/* Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {OUTPUTS.map((o, i) => {
          const isActive = i === activeIdx;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setActiveIdx(i)}
              className="relative rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                borderColor: "var(--lp-border)",
                background: isActive
                  ? "var(--lp-text)"
                  : "var(--lp-surface)",
                color: isActive ? "var(--lp-bg)" : "var(--lp-text-muted)",
              }}
            >
              {o.label}
            </button>
          );
        })}
        <div
          className="ml-auto hidden items-center gap-2 text-[11px] sm:flex"
          style={{ color: "var(--lp-text-muted)" }}
        >
          <span className="font-semibold uppercase tracking-[0.14em]">
            By
          </span>
          <span style={{ color: "var(--lp-text)" }}>{active.by}</span>
          <span>·</span>
          <span>{active.target}</span>
        </div>
      </div>

      {/* Window */}
      <div
        className="relative overflow-hidden rounded-xl border"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface)",
          boxShadow:
            "0 32px 60px -24px rgba(0,0,0,0.35), 0 8px 24px -12px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in oklch, var(--lp-border) 60%, transparent)",
        }}
      >
        {/* Title bar */}
        <div
          className="relative flex items-center border-b px-3 py-2.5"
          style={{
            borderColor: "var(--lp-border)",
            background:
              "linear-gradient(to bottom, color-mix(in oklch, var(--lp-surface-alt) 100%, transparent), color-mix(in oklch, var(--lp-surface) 100%, transparent))",
          }}
        >
          <div className="flex gap-2">
            <span
              className="block size-3 rounded-full"
              style={{
                background: "#FF5F57",
                boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
              }}
            />
            <span
              className="block size-3 rounded-full"
              style={{
                background: "#FEBC2E",
                boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
              }}
            />
            <span
              className="block size-3 rounded-full"
              style={{
                background: "#28C840",
                boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
              }}
            />
          </div>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <OutputWindowTitle id={active.id} />
          </div>
          <div
            className="ml-auto flex items-center gap-1.5 rounded-full border px-2 py-0.5"
            style={{
              borderColor: "var(--lp-border)",
              background: "var(--lp-surface)",
            }}
          >
            <motion.span
              className="block size-1.5 rounded-full"
              style={{ background: "#28C840" }}
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <span
              className="text-[10.5px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: "var(--lp-text-muted)" }}
            >
              just shipped
            </span>
          </div>
        </div>

        {/* Body — cross-fade between outputs */}
        <div className="relative min-h-[360px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 p-5 sm:p-6"
            >
              {active.id === "slack" && <SlackOutput />}
              {active.id === "linear" && <LinearOutput />}
              {active.id === "email" && <EmailOutput />}
              {active.id === "doc" && <DocOutput />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function OutputWindowTitle({ id }: { id: string }) {
  const map: Record<string, { name: string; sub: string }> = {
    slack: { name: "Slack", sub: "#general" },
    linear: { name: "Linear", sub: "ENG-482 · Sprint 14" },
    email: { name: "Mail", sub: "Draft — Launch readiness" },
    doc: { name: "Docs", sub: "Weekly digest · 2026-05-12" },
  };
  const v = map[id] ?? map.slack;
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-[12px] font-semibold"
        style={{ color: "var(--lp-text)" }}
      >
        {v.name}
      </span>
      <span
        className="text-[12px]"
        style={{ color: "var(--lp-text-muted)" }}
      >
        · {v.sub}
      </span>
    </div>
  );
}

function SlackOutput() {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white"
          style={{ background: "oklch(0.55 0.12 18)" }}
        >
          D
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold">Dana</span>
            <span
              className="rounded border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{
                borderColor: "var(--lp-border)",
                color: "var(--lp-text-muted)",
              }}
            >
              twin
            </span>
            <span
              className="text-[11px]"
              style={{ color: "var(--lp-text-muted)" }}
            >
              10:32 AM
            </span>
          </div>
          <p className="mt-1 text-[14px] leading-relaxed">
            Council decision on the onboarding launch:
          </p>
          <ul
            className="mt-2 space-y-1 text-[13px] leading-relaxed"
            style={{ color: "var(--lp-text)" }}
          >
            <li>
              <span style={{ color: "var(--lp-dot)" }}>•</span> Stage launch to
              10% next Tuesday, after migration rollback test
            </li>
            <li>
              <span style={{ color: "var(--lp-dot)" }}>•</span> Sales keeps
              this week&rsquo;s enterprise demos
            </li>
            <li>
              <span style={{ color: "var(--lp-dot)" }}>•</span> Support ships
              docs + macros by Monday EOD
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className="rounded border px-2 py-1 text-[11px]"
              style={{
                borderColor: "var(--lp-border)",
                background: "var(--lp-surface-alt)",
              }}
            >
              📎 launch-checklist.md
            </span>
            <span
              className="rounded border px-2 py-1 text-[11px]"
              style={{
                borderColor: "var(--lp-border)",
                background: "var(--lp-surface-alt)",
              }}
            >
              🔗 Linear · ENG-482
            </span>
          </div>
          <div
            className="mt-3 flex gap-3 text-[11px]"
            style={{ color: "var(--lp-text-muted)" }}
          >
            <span>👍 12</span>
            <span>🚀 5</span>
            <span>3 replies · view thread</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinearOutput() {
  const tasks = [
    { id: "ENG-482", title: "Migration rollback test plan", owner: "Arie", state: "In review" },
    { id: "ENG-483", title: "Stage launch flag for 10% rollout", owner: "Arie", state: "Todo" },
    { id: "SUP-219", title: "Onboarding macros + help center docs", owner: "Tamar", state: "Todo" },
    { id: "SLS-094", title: "Brief enterprise demo prospects on timeline", owner: "Noa", state: "Done" },
  ];
  return (
    <div className="space-y-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="rounded border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider"
          style={{
            borderColor: "var(--lp-border)",
            background: "var(--lp-surface-alt)",
            color: "var(--lp-text-muted)",
          }}
        >
          Sprint 14
        </span>
        <span
          className="text-[12px]"
          style={{ color: "var(--lp-text-muted)" }}
        >
          4 tasks created by twins · 0 conflicts
        </span>
      </div>
      {tasks.map((t) => {
        const stateColor =
          t.state === "Done"
            ? "#28C840"
            : t.state === "In review"
              ? "#FEBC2E"
              : "var(--lp-border)";
        return (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
            style={{
              borderColor: "var(--lp-border)",
              background: "var(--lp-surface-alt)",
            }}
          >
            <span
              className="block size-2.5 shrink-0 rounded-full"
              style={{ background: stateColor }}
            />
            <span
              className="font-mono text-[11px] font-semibold"
              style={{ color: "var(--lp-text-muted)" }}
            >
              {t.id}
            </span>
            <span className="flex-1 truncate text-[13px]">{t.title}</span>
            <span
              className="rounded border px-1.5 py-0.5 text-[10.5px]"
              style={{
                borderColor: "var(--lp-border)",
                color: "var(--lp-text-muted)",
              }}
            >
              {t.state}
            </span>
            <span
              className="hidden text-[11px] sm:block"
              style={{ color: "var(--lp-text-muted)" }}
            >
              {t.owner}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmailOutput() {
  return (
    <div className="space-y-3">
      <div
        className="border-b pb-3 text-[13px]"
        style={{ borderColor: "var(--lp-border)" }}
      >
        <div className="flex items-baseline gap-2">
          <span style={{ color: "var(--lp-text-muted)" }}>To:</span>
          <span>launch-team@employee001.com</span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span style={{ color: "var(--lp-text-muted)" }}>Subject:</span>
          <span className="font-semibold">
            Onboarding launch — staged rollout next Tuesday
          </span>
        </div>
      </div>
      <p className="text-[13.5px] leading-relaxed">Hi all,</p>
      <p className="text-[13.5px] leading-relaxed">
        Following this morning&rsquo;s council, here&rsquo;s the plan we&rsquo;re
        going with:
      </p>
      <ol
        className="ml-5 list-decimal space-y-1 text-[13.5px] leading-relaxed"
        style={{ color: "var(--lp-text)" }}
      >
        <li>
          Engineering finishes the migration rollback test by{" "}
          <span className="font-semibold">Monday EOD</span>.
        </li>
        <li>
          Launch flag opens to 10% of accounts on{" "}
          <span className="font-semibold">Tuesday 10:00 IST</span>.
        </li>
        <li>
          Support&rsquo;s onboarding macros + help docs go live with the
          flag.
        </li>
        <li>
          Sales keeps this week&rsquo;s enterprise demos — no schedule change.
        </li>
      </ol>
      <p
        className="text-[12.5px] leading-relaxed"
        style={{ color: "var(--lp-text-muted)" }}
      >
        Drafted by Noa (Sales twin) · ready to send. Reply{" "}
        <span style={{ color: "var(--lp-dot)" }}>Approve</span> or edit
        inline.
      </p>
    </div>
  );
}

function DocOutput() {
  return (
    <div className="space-y-3">
      <p
        className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--lp-text-muted)" }}
      >
        Weekly digest · 2026-05-12
      </p>
      <h4
        className="text-2xl"
        style={{
          fontFamily:
            "var(--font-instrument-serif), 'Instrument Serif', serif",
          fontWeight: 400,
          letterSpacing: "-0.01em",
        }}
      >
        Onboarding flow — readiness summary
      </h4>
      <div
        className="rounded-md border p-3"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
      >
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--lp-dot)" }}
        >
          TL;DR
        </p>
        <p className="mt-1 text-[13.5px] leading-relaxed">
          Staged launch Tuesday after rollback test. Sales keeps demos.
          Support ships docs by Monday.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-[13px]">
        <div
          className="rounded-md border p-3"
          style={{ borderColor: "var(--lp-border)" }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--lp-text-muted)" }}
          >
            Risks
          </p>
          <p className="mt-1">Migration rollback untested</p>
        </div>
        <div
          className="rounded-md border p-3"
          style={{ borderColor: "var(--lp-border)" }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--lp-text-muted)" }}
          >
            Blockers
          </p>
          <p className="mt-1">2-day support content lift</p>
        </div>
        <div
          className="rounded-md border p-3"
          style={{ borderColor: "var(--lp-border)" }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--lp-text-muted)" }}
          >
            Next
          </p>
          <p className="mt-1">10% rollout Tuesday 10:00</p>
        </div>
      </div>
      <p
        className="text-[11.5px]"
        style={{ color: "var(--lp-text-muted)" }}
      >
        Compiled by Tamar (Support twin) from Council thread, Linear, and #general.
      </p>
    </div>
  );
}

type CouncilMessage = {
  who: string;
  role: string;
  text: string;
  side: "right" | "left";
  hueDeg: number;
  thinkMs: number;
  tools: string[];
};

const COUNCIL_PROMPT =
  "What should we do before launching the new customer onboarding flow?";

const COUNCIL_THREAD: CouncilMessage[] = [
  {
    who: "Dana",
    role: "Product twin",
    text: "Risks first — the new flow touches activation. Let’s pull last quarter’s drop-off points.",
    side: "left",
    hueDeg: 18,
    thinkMs: 1800,
    tools: ["Linear", "Slack"],
  },
  {
    who: "Arie",
    role: "Engineering twin",
    text: "DB migration ships Thursday. Day-1 launch blocks if rollback isn’t tested.",
    side: "left",
    hueDeg: 200,
    thinkMs: 2000,
    tools: ["GitHub", "Linear"],
  },
  {
    who: "Noa",
    role: "Sales twin",
    text: "Two enterprise demos this week. Defer = revenue at risk. Stage launch?",
    side: "left",
    hueDeg: 280,
    thinkMs: 1800,
    tools: ["Slack", "Monday"],
  },
  {
    who: "Tamar",
    role: "Support twin",
    text: "Need help docs + macros ready, or the queue floods. 2 days of work.",
    side: "left",
    hueDeg: 140,
    thinkMs: 1700,
    tools: ["ClickUp", "Slack"],
  },
];

const TOOL_TINT: Record<string, string> = {
  GitHub: "210",
  Linear: "260",
  ClickUp: "200",
  Monday: "0",
  Slack: "300",
};

const COUNCIL_VERDICT =
  "Stage launch to 10% next Tuesday after migration rollback test. Sales keeps demos; Support ships docs + macros by Monday.";

function TwinCouncilDemo() {
  const [step, setStep] = useState(0);
  // Steps: 0 = idle, 1 = CEO message, 2..5 = each twin thinking, 6..9 = each twin replied,
  // 10 = consensus verdict, 11 = reset

  useEffect(() => {
    const totalSteps = 11; // 0..10
    let timer: ReturnType<typeof setTimeout>;
    const advance = (s: number) => {
      let delay = 1200;
      if (s === 1) delay = 1800; // after CEO bubble
      if (s >= 2 && s <= 5) {
        // thinking state — use twin's specific thinkMs
        const twinIdx = s - 2;
        delay = COUNCIL_THREAD[twinIdx].thinkMs;
      } else if (s >= 6 && s <= 9) {
        // delay after twin reply — give time to read
        delay = 1600;
      } else if (s === 10) delay = 4200; // hold verdict longer
      timer = setTimeout(() => {
        if (s + 1 > totalSteps) setStep(0);
        else setStep(s + 1);
      }, delay);
    };
    if (step === 0) {
      timer = setTimeout(() => setStep(1), 900);
    } else {
      advance(step);
    }
    return () => clearTimeout(timer);
  }, [step]);

  const ceoVisible = step >= 1;
  const verdictVisible = step >= 10;

  return (
    <div
      className="relative mx-auto max-w-4xl overflow-hidden rounded-xl border"
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
        boxShadow:
          "0 32px 60px -24px rgba(0,0,0,0.35), 0 8px 24px -12px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in oklch, var(--lp-border) 60%, transparent)",
      }}
    >
      {/* macOS title bar */}
      <div
        className="relative flex items-center border-b px-3 py-2.5"
        style={{
          borderColor: "var(--lp-border)",
          background:
            "linear-gradient(to bottom, color-mix(in oklch, var(--lp-surface-alt) 100%, transparent), color-mix(in oklch, var(--lp-surface) 100%, transparent))",
        }}
      >
        {/* Traffic lights */}
        <div className="flex gap-2">
          <span
            className="block size-3 rounded-full"
            style={{
              background: "#FF5F57",
              boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
            }}
          />
          <span
            className="block size-3 rounded-full"
            style={{
              background: "#FEBC2E",
              boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
            }}
          />
          <span
            className="block size-3 rounded-full"
            style={{
              background: "#28C840",
              boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
            }}
          />
        </div>
        {/* Centered title */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
          <Sparks
            width={12}
            height={12}
            strokeWidth={1.6}
            style={{ color: "var(--lp-text-muted)" }}
          />
          <span
            className="text-[12px] font-semibold"
            style={{ color: "var(--lp-text)" }}
          >
            Council
          </span>
          <span
            className="text-[12px]"
            style={{ color: "var(--lp-text-muted)" }}
          >
            · onboarding-launch
          </span>
        </div>
        {/* Right: live indicator */}
        <div className="ml-auto flex items-center gap-1.5 rounded-full border px-2 py-0.5"
          style={{ borderColor: "var(--lp-border)", background: "var(--lp-surface)" }}
        >
          <motion.span
            className="block size-1.5 rounded-full"
            style={{ background: "#28C840" }}
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: "var(--lp-text-muted)" }}
          >
            live
          </span>
        </div>
      </div>

      {/* Body — sidebar + thread */}
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr]">
        {/* Sidebar — participants */}
        <aside
          className="hidden border-r p-4 sm:block"
          style={{
            borderColor: "var(--lp-border)",
            background: "var(--lp-surface-alt)",
          }}
        >
          <p
            className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--lp-text-muted)" }}
          >
            In this room
          </p>
          <ul className="space-y-2.5">
            {/* CEO */}
            <li className="flex items-center gap-2">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: "oklch(0.55 0.12 40)" }}
              >
                Y
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold leading-tight">
                  You
                </p>
                <p
                  className="truncate text-[10.5px] leading-tight"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  CEO
                </p>
              </div>
            </li>
            {COUNCIL_THREAD.map((m, i) => {
              const isThinking = step === 2 + i;
              const hasReplied = step >= 6 + i;
              return (
                <li key={m.who} className="flex items-center gap-2">
                  <span
                    className="relative flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: `oklch(0.55 0.12 ${m.hueDeg})` }}
                  >
                    {m.who[0]}
                    {isThinking && (
                      <motion.span
                        aria-hidden
                        className="absolute -inset-1 rounded-full"
                        style={{
                          boxShadow: `0 0 0 2px oklch(0.55 0.12 ${m.hueDeg} / 0.45)`,
                        }}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{
                          duration: 1.4,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      />
                    )}
                    {hasReplied && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 block size-2 rounded-full border-2"
                        style={{
                          background: "#28C840",
                          borderColor: "var(--lp-surface-alt)",
                        }}
                      />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold leading-tight">
                      {m.who}
                    </p>
                    <p
                      className="truncate text-[10.5px] leading-tight"
                      style={{ color: "var(--lp-text-muted)" }}
                    >
                      {m.role}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Thread */}
        <div className="min-h-[480px] space-y-4 p-5 sm:p-6">
          {/* CEO message (right) */}
          <AnimatePresence>
            {ceoVisible && (
              <CouncilBubble
                key="ceo"
                who="You"
                role="CEO"
                text={COUNCIL_PROMPT}
                side="right"
                hueDeg={40}
                showName
                accent
              />
            )}
          </AnimatePresence>

          {/* Twin replies */}
          {COUNCIL_THREAD.map((m, i) => {
            const stepReveal = 6 + i;
            const stepThink = 2 + i;
            const revealed = step >= stepReveal;
            const thinking = step === stepThink;
            return (
              <AnimatePresence key={m.who}>
                {(revealed || thinking) && (
                  <CouncilBubble
                    who={m.who}
                    role={m.role}
                    text={revealed ? m.text : ""}
                    thinking={!revealed}
                    tools={m.tools}
                    side={m.side}
                    hueDeg={m.hueDeg}
                    showName
                  />
                )}
              </AnimatePresence>
            );
          })}

          {/* Consensus verdict */}
          <AnimatePresence>
            {verdictVisible && (
              <motion.div
                key="verdict"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="mt-2 rounded-[var(--lp-radius-sm)] border p-4"
                style={{
                  borderColor: "var(--lp-border)",
                  background:
                    "color-mix(in oklch, var(--lp-dot) 14%, var(--lp-surface-alt))",
                }}
              >
                <p
                  className="text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "var(--lp-dot)" }}
                >
                  Consensus
                </p>
                <p className="mt-1.5 text-[14px] leading-relaxed">
                  {COUNCIL_VERDICT}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function CouncilBubble({
  who,
  role,
  text,
  thinking = false,
  tools,
  side,
  hueDeg,
  showName = true,
  accent = false,
}: {
  who: string;
  role: string;
  text: string;
  thinking?: boolean;
  tools?: string[];
  side: "left" | "right";
  hueDeg: number;
  showName?: boolean;
  accent?: boolean;
}) {
  const isRight = side === "right";
  const avatarBg = `oklch(0.55 0.12 ${hueDeg})`;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cx(
        "flex items-end gap-3",
        isRight && "flex-row-reverse",
      )}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ background: avatarBg }}
      >
        {who[0]}
      </div>
      <div
        className={cx("flex max-w-[78%] flex-col", isRight ? "items-end" : "items-start")}
      >
        {showName && (
          <div className="mb-1 flex items-baseline gap-2 px-1">
            <span className="text-[11px] font-semibold">{who}</span>
            <span
              className="text-[10px] uppercase tracking-[0.1em]"
              style={{ color: "var(--lp-text-muted)" }}
            >
              {role}
            </span>
          </div>
        )}
        <div
          className={cx(
            "rounded-2xl border px-3.5 py-2 text-[13.5px] leading-relaxed",
            isRight ? "rounded-br-md" : "rounded-bl-md",
          )}
          style={{
            borderColor: "var(--lp-border)",
            background: accent
              ? "color-mix(in oklch, var(--lp-dot) 18%, var(--lp-surface-alt))"
              : "var(--lp-surface-alt)",
            color: "var(--lp-text)",
          }}
        >
          {thinking ? (
            <span className="flex items-center gap-2 py-0.5">
              <span className="flex items-center gap-1">
                {[0, 0.18, 0.36].map((d, i) => (
                  <motion.span
                    key={i}
                    className="block size-1.5 rounded-full"
                    style={{ background: "var(--lp-text-muted)" }}
                    animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                    transition={{
                      duration: 1,
                      delay: d,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </span>
              {tools && tools.length > 0 ? (
                <span
                  className="text-[11px]"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  using
                </span>
              ) : null}
              {tools?.map((tool, idx) => {
                const hue = TOOL_TINT[tool] ?? "0";
                return (
                  <motion.span
                    key={tool}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + idx * 0.45, duration: 0.3 }}
                    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold"
                    style={{
                      borderColor: "var(--lp-border)",
                      background: "var(--lp-surface)",
                      color: "var(--lp-text)",
                    }}
                  >
                    <motion.span
                      className="block size-1.5 rounded-full"
                      style={{ background: `oklch(0.65 0.14 ${hue})` }}
                      animate={{ opacity: [0.6, 1, 0.6] }}
                      transition={{
                        duration: 1.2,
                        delay: idx * 0.3,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                    {tool}
                  </motion.span>
                );
              })}
            </span>
          ) : (
            text
          )}
        </div>
      </div>
    </motion.div>
  );
}

function UspBentoCard({
  span,
  index,
  children,
}: {
  span: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      data-usp-card
      data-usp-index={index}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{
        duration: 0.55,
        delay: index * 0.08,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{ y: -4 }}
      className={cx(
        "group relative overflow-hidden rounded-[var(--lp-radius)] border",
        span,
      )}
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
        boxShadow: "0 1px 0 rgba(22,19,17,0.04)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 90% at 100% 0%, var(--usp-glow), transparent 55%)",
        }}
      />
      <button
        type="button"
        onClick={() => trackLandingEvent("usp_card_clicked", { index })}
        className="relative h-full w-full cursor-pointer border-0 bg-transparent p-0 text-left"
      >
        {children}
      </button>
    </motion.div>
  );
}

function UspBento() {
  return (
    <div className="relative">
      <div className="relative z-10 grid grid-cols-6 gap-3">
        {/* 1. Hero: "One brain" 100% bubble */}
        <UspBentoCard index={0} span="col-span-full flex overflow-hidden lg:col-span-2">
          <div className="m-auto size-fit pt-6 pb-6">
            <div className="relative flex h-24 w-56 items-center">
              <svg
                className="absolute inset-0 size-full"
                viewBox="0 0 254 104"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ color: "var(--lp-border)" }}
              >
                <path
                  d="M112.891 97.7022C140.366 97.0802 171.004 94.6715 201.087 87.5116C210.43 85.2881 219.615 82.6412 228.284 78.2473C232.198 76.3179 235.905 73.9942 239.348 71.3124C241.85 69.2557 243.954 66.7571 245.555 63.9408C249.34 57.3235 248.281 50.5341 242.498 45.6109C239.033 42.7237 235.228 40.2703 231.169 38.3054C219.443 32.7209 207.141 28.4382 194.482 25.534C184.013 23.1927 173.358 21.7755 162.64 21.2989C161.376 21.3512 160.113 21.181 158.908 20.796C158.034 20.399 156.857 19.1682 156.962 18.4535C157.115 17.8927 157.381 17.3689 157.743 16.9139C158.104 16.4588 158.555 16.0821 159.067 15.8066C160.14 15.4683 161.274 15.3733 162.389 15.5286C179.805 15.3566 196.626 18.8373 212.998 24.462C220.978 27.2494 228.798 30.4747 236.423 34.1232C240.476 36.1159 244.202 38.7131 247.474 41.8258C254.342 48.2578 255.745 56.9397 251.841 65.4892C249.793 69.8582 246.736 73.6777 242.921 76.6327C236.224 82.0192 228.522 85.4602 220.502 88.2924C205.017 93.7847 188.964 96.9081 172.738 99.2109C153.442 101.949 133.993 103.478 114.506 103.79C91.1468 104.161 67.9334 102.97 45.1169 97.5831C36.0094 95.5616 27.2626 92.1655 19.1771 87.5116C13.839 84.5746 9.1557 80.5802 5.41318 75.7725C-0.54238 67.7259 -1.13794 59.1763 3.25594 50.2827C5.82447 45.3918 9.29572 41.0315 13.4863 37.4319C24.2989 27.5721 37.0438 20.9681 50.5431 15.7272C68.1451 8.8849 86.4883 5.1395 105.175 2.83669C129.045 0.0992292 153.151 0.134761 177.013 2.94256C197.672 5.23215 218.04 9.01724 237.588 16.3889C240.089 17.3418 242.498 18.5197 244.933 19.6446C246.627 20.4387 247.725 21.6695 246.997 23.615C246.455 25.1105 244.814 25.5605 242.63 24.5811C230.322 18.9961 217.233 16.1904 204.117 13.4376C188.761 10.3438 173.2 8.36665 157.558 7.52174C129.914 5.70776 102.154 8.06792 75.2124 14.5228C60.6177 17.8788 46.5758 23.2977 33.5102 30.6161C26.6595 34.3329 20.4123 39.0673 14.9818 44.658C12.9433 46.8071 11.1336 49.1622 9.58207 51.6855C4.87056 59.5336 5.61172 67.2494 11.9246 73.7608C15.2064 77.0494 18.8775 79.925 22.8564 82.3236C31.6176 87.7101 41.3848 90.5291 51.3902 92.5804C70.6068 96.5773 90.0219 97.7419 112.891 97.7022Z"
                  fill="currentColor"
                />
              </svg>
              <span
                className="mx-auto block w-fit text-5xl"
                style={{
                  fontFamily:
                    "var(--font-instrument-serif), 'Instrument Serif', serif",
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                }}
              >
                1 brain
              </span>
            </div>
            <h3 className="mt-6 text-center text-xl font-semibold tracking-tight">
              One organizational brain
            </h3>
            <p
              className="mx-auto mt-2 max-w-[14rem] text-center text-[13px] leading-snug"
              style={{ color: "var(--lp-text-muted)" }}
            >
              All your scattered knowledge becomes one queryable layer.
            </p>
          </div>
        </UspBentoCard>

        {/* 2. Twins watching — Shield in circle */}
        <UspBentoCard
          index={1}
          span="col-span-full sm:col-span-3 lg:col-span-2"
        >
          <div className="px-6 pt-8 pb-6">
            <div
              className="relative mx-auto flex aspect-square size-32 rounded-full border before:absolute before:-inset-2 before:rounded-full before:border"
              style={{
                borderColor: "var(--lp-border)",
                ["--tw-shadow-color" as never]: "var(--lp-border)",
              }}
            >
              <Group
                width={56}
                height={56}
                strokeWidth={1.1}
                className="m-auto"
                style={{ color: "var(--lp-text)" }}
              />
            </div>
            <div className="relative z-10 mt-6 space-y-1.5 text-center">
              <h3 className="text-lg font-semibold tracking-tight">
                A twin for every employee
              </h3>
              <p
                className="text-[13px] leading-snug"
                style={{ color: "var(--lp-text-muted)" }}
              >
                Each one learns their owner&rsquo;s role, tone, and decisions.
              </p>
            </div>
          </div>
        </UspBentoCard>

        {/* 3. Connected — line graph */}
        <UspBentoCard
          index={2}
          span="col-span-full sm:col-span-3 lg:col-span-2"
        >
          <div className="px-5 pt-6 pb-6">
            <div className="pt-2 lg:px-2">
              <svg
                className="w-full"
                viewBox="0 0 386 123"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ color: "var(--lp-text-muted)" }}
              >
                <rect width="386" height="123" rx="10" fill="none" />
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M3 123C3 123 14.3298 94.153 35.1282 88.0957C55.9266 82.0384 65.9333 80.5508 65.9333 80.5508C65.9333 80.5508 80.699 80.5508 92.1777 80.5508C103.656 80.5508 100.887 63.5348 109.06 63.5348C117.233 63.5348 117.217 91.9728 124.78 91.9728C132.343 91.9728 142.264 78.03 153.831 80.5508C165.398 83.0716 186.825 91.9728 193.761 91.9728C200.697 91.9728 206.296 63.5348 214.07 63.5348C221.844 63.5348 238.653 93.7771 244.234 91.9728C249.814 90.1684 258.8 60 266.19 60C272.075 60 284.1 88.057 286.678 88.0957C294.762 88.2171 300.192 72.9284 305.423 72.9284C312.323 72.9284 323.377 65.2437 335.553 63.5348C347.729 61.8259 348.218 82.07 363.639 80.5508C367.875 80.1335 372.949 82.2017 376.437 87.1008C379.446 91.3274 381.054 97.4325 382.521 104.647C383.479 109.364 382.521 123 382.521 123"
                  fill="url(#uspGraphFill)"
                />
                <path
                  d="M3 121.077C3 121.077 15.3041 93.6691 36.0195 87.756C56.7349 81.8429 66.6632 80.9723 66.6632 80.9723C66.6632 80.9723 80.0327 80.9723 91.4656 80.9723C102.898 80.9723 100.415 64.2824 108.556 64.2824C116.696 64.2824 117.693 92.1332 125.226 92.1332C132.759 92.1332 142.07 78.5115 153.591 80.9723C165.113 83.433 186.092 92.1332 193 92.1332C199.908 92.1332 205.274 64.2824 213.017 64.2824C220.76 64.2824 237.832 93.8946 243.39 92.1332C248.948 90.3718 257.923 60.5 265.284 60.5C271.145 60.5 283.204 87.7182 285.772 87.756C293.823 87.8746 299.2 73.0802 304.411 73.0802C311.283 73.0802 321.425 65.9506 333.552 64.2824C345.68 62.6141 346.91 82.4553 362.27 80.9723C377.629 79.4892 383 106.605 383 106.605"
                  stroke="var(--lp-dot)"
                  strokeWidth="3"
                  fill="none"
                />
                <defs>
                  <linearGradient
                    id="uspGraphFill"
                    x1="3"
                    y1="60"
                    x2="3"
                    y2="123"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop
                      stopColor="var(--lp-dot)"
                      stopOpacity="0.18"
                    />
                    <stop offset="1" stopColor="var(--lp-dot)" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="relative z-10 mt-6 space-y-1.5 text-center">
              <h3 className="text-lg font-semibold tracking-tight">
                Connected to real work
              </h3>
              <p
                className="text-[13px] leading-snug"
                style={{ color: "var(--lp-text-muted)" }}
              >
                Every email, doc, ticket, and chat — live, not uploaded.
              </p>
            </div>
          </div>
        </UspBentoCard>

        {/* 4. Knowledge → Execution — wide with mini dashboard */}
        <UspBentoCard index={3} span="col-span-full lg:col-span-3">
          <div className="grid pt-6 sm:grid-cols-2 px-6 pb-6">
            <div className="relative z-10 flex flex-col justify-between space-y-12 lg:space-y-6">
              <div
                className="relative flex aspect-square size-12 rounded-full border before:absolute before:-inset-2 before:rounded-full before:border"
                style={{ borderColor: "var(--lp-border)" }}
              >
                <TaskList
                  width={20}
                  height={20}
                  strokeWidth={1.2}
                  className="m-auto"
                  style={{ color: "var(--lp-text)" }}
                />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold tracking-tight">
                  Knowledge → execution
                </h3>
                <p
                  className="text-[13px] leading-snug"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  Twins don&rsquo;t just answer. They draft, post, and close
                  the loop.
                </p>
              </div>
            </div>
            <div
              className="relative -mb-6 -mr-6 mt-6 h-fit rounded-tl-lg border-l border-t p-6 sm:ml-6"
              style={{ borderColor: "var(--lp-border)" }}
            >
              <div className="absolute left-3 top-2 flex gap-1">
                <span
                  className="block size-2 rounded-full border"
                  style={{ borderColor: "var(--lp-border)" }}
                />
                <span
                  className="block size-2 rounded-full border"
                  style={{ borderColor: "var(--lp-border)" }}
                />
                <span
                  className="block size-2 rounded-full border"
                  style={{ borderColor: "var(--lp-border)" }}
                />
              </div>
              <ExecutionMiniList />
            </div>
          </div>
        </UspBentoCard>

        {/* 5. Twin meetings — wide with avatars */}
        <UspBentoCard index={4} span="col-span-full lg:col-span-3">
          <div className="grid h-full pt-6 sm:grid-cols-2 px-6 pb-6">
            <div className="relative z-10 flex flex-col justify-between space-y-12 lg:space-y-6">
              <div
                className="relative flex aspect-square size-12 rounded-full border before:absolute before:-inset-2 before:rounded-full before:border"
                style={{ borderColor: "var(--lp-border)" }}
              >
                <ChatLines
                  width={20}
                  height={20}
                  strokeWidth={1.2}
                  className="m-auto"
                  style={{ color: "var(--lp-text)" }}
                />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold tracking-tight">
                  Run team meetings with twins
                </h3>
                <p
                  className="text-[13px] leading-snug"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  Ask one question. Watch the relevant twins debate and
                  converge.
                </p>
              </div>
            </div>
            <div
              className="relative mt-6 before:absolute before:inset-0 before:mx-auto before:w-px sm:-my-6 sm:-mr-6"
              style={{
                ["--color-border" as never]: "var(--lp-border)",
              }}
            >
              <div
                aria-hidden
                className="absolute inset-y-0 left-1/2 w-px"
                style={{ background: "var(--lp-border)" }}
              />
              <div className="relative flex h-full flex-col justify-center space-y-5 py-6">
                <MeetingAvatar side="right" name="Dana" message="Risk on launch?" />
                <MeetingAvatar side="left" name="Arie" message="DB migration blocks it." />
                <MeetingAvatar side="right" name="Noa" message="Defer to next sprint." />
              </div>
            </div>
          </div>
        </UspBentoCard>
      </div>
    </div>
  );
}

function MeetingAvatar({
  side,
  name,
  message,
}: {
  side: "left" | "right";
  name: string;
  message: string;
}) {
  const isRight = side === "right";
  return (
    <div
      className={cx(
        "relative flex items-center gap-2",
        isRight
          ? "w-[calc(50%+0.875rem)] justify-end"
          : "ml-[calc(50%-1rem)]",
      )}
    >
      {isRight && (
        <span
          className="block h-fit rounded border px-2 py-1 text-[11px] shadow-sm"
          style={{
            borderColor: "var(--lp-border)",
            background: "var(--lp-surface)",
          }}
        >
          {message}
        </span>
      )}
      <div
        className="ring-background flex size-7 items-center justify-center rounded-full border text-[11px] font-semibold ring-4"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
          color: "var(--lp-text)",
        }}
      >
        {name[0]}
      </div>
      {!isRight && (
        <span
          className="block h-fit rounded border px-2 py-1 text-[11px] shadow-sm"
          style={{
            borderColor: "var(--lp-border)",
            background: "var(--lp-surface)",
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
}

function ExecutionMiniList() {
  return (
    <div className="space-y-2 pt-4">
      {[
        "Drafted weekly summary",
        "Sent for review",
        "Posted to #general",
      ].map((label, i) => (
        <motion.div
          key={i}
          className="flex items-center gap-2"
          animate={{ opacity: [0.45, 0.45, 1, 1] }}
          transition={{
            duration: 4.5,
            times: [0, i * 0.25, i * 0.25 + 0.05, 1],
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <motion.span
            className="flex h-3 w-3 items-center justify-center rounded-[3px] border"
            style={{ borderColor: "var(--lp-border)" }}
            animate={{
              background: [
                "var(--lp-surface-alt)",
                "var(--lp-surface-alt)",
                "color-mix(in oklch, var(--lp-dot) 40%, var(--lp-surface-alt))",
                "color-mix(in oklch, var(--lp-dot) 40%, var(--lp-surface-alt))",
              ],
            }}
            transition={{
              duration: 4.5,
              times: [0, i * 0.25, i * 0.25 + 0.05, 1],
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <motion.svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--lp-text)" }}
              animate={{ opacity: [0, 0, 1, 1] }}
              transition={{
                duration: 4.5,
                times: [0, i * 0.25, i * 0.25 + 0.05, 1],
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <path d="M5 13l4 4L19 7" />
            </motion.svg>
          </motion.span>
          <span
            className="text-[11px] leading-tight"
            style={{ color: "var(--lp-text)" }}
          >
            {label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function OrgBrainHeroVisual() {
  const nodes = [
    { x: 50, y: 50, r: 5, hub: true },
    { x: 20, y: 22, r: 2.5 },
    { x: 78, y: 18, r: 2.8 },
    { x: 88, y: 50, r: 2.6 },
    { x: 80, y: 80, r: 2.4 },
    { x: 32, y: 86, r: 2.7 },
    { x: 12, y: 60, r: 2.3 },
    { x: 60, y: 18, r: 2 },
    { x: 28, y: 50, r: 2 },
    { x: 70, y: 65, r: 2.2 },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [0, 6],
    [0, 7],
    [0, 8],
    [0, 9],
    [1, 7],
    [3, 9],
    [4, 5],
    [6, 8],
  ];
  return (
    <div className="relative h-full w-full">
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        preserveAspectRatio="none"
      >
        {edges.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={nodes[a].x}
            y1={nodes[a].y}
            x2={nodes[b].x}
            y2={nodes[b].y}
            stroke="var(--lp-border)"
            strokeWidth="0.4"
            animate={{ opacity: [0.25, 0.7, 0.25] }}
            transition={{
              duration: 3,
              delay: i * 0.15,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
        {nodes.map((n, i) => (
          <g key={i}>
            {n.hub && (
              <motion.circle
                cx={n.x}
                cy={n.y}
                r={n.r * 2.4}
                fill="var(--lp-dot)"
                opacity={0.18}
                animate={{ r: [n.r * 2, n.r * 3, n.r * 2], opacity: [0.18, 0.32, 0.18] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <motion.circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={n.hub ? "var(--lp-text)" : "var(--lp-text)"}
              animate={n.hub ? undefined : { opacity: [0.45, 1, 0.45] }}
              transition={{
                duration: 2.4,
                delay: i * 0.2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </g>
        ))}
        {/* Pulse traveling along one edge */}
        {edges.slice(0, 6).map(([a, b], i) => (
          <motion.circle
            key={`pulse-${i}`}
            r="1.1"
            fill="var(--lp-dot)"
            animate={{
              cx: [nodes[a].x, nodes[b].x],
              cy: [nodes[a].y, nodes[b].y],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: 1.8,
              delay: i * 0.6,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </svg>
    </div>
  );
}

function TwinsGridVisual() {
  const seats = Array.from({ length: 8 });
  const activeIndex = 3;
  return (
    <div className="relative h-full w-full">
      <div className="grid h-full w-full grid-cols-4 grid-rows-2 gap-1.5">
        {seats.map((_, i) => {
          const isActive = i === activeIndex;
          return (
            <motion.div
              key={i}
              className="relative flex items-center justify-center overflow-hidden rounded-md border"
              style={{
                borderColor: "var(--lp-border)",
                background: isActive
                  ? "color-mix(in oklch, var(--lp-dot) 18%, var(--lp-surface-alt))"
                  : "var(--lp-surface-alt)",
              }}
              animate={
                isActive
                  ? {
                      boxShadow: [
                        "0 0 0 0 rgba(0,0,0,0)",
                        "0 0 0 3px color-mix(in oklch, var(--lp-dot) 35%, transparent)",
                        "0 0 0 0 rgba(0,0,0,0)",
                      ],
                    }
                  : undefined
              }
              transition={
                isActive
                  ? { duration: 2.2, repeat: Infinity, ease: "easeOut" }
                  : undefined
              }
            >
              <div
                className="h-3 w-3 rounded-full"
                style={{
                  background: isActive ? "var(--lp-text)" : "var(--lp-text-muted)",
                  opacity: isActive ? 1 : 0.5,
                }}
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function TwinChatVisual() {
  const msgs = [
    { side: "L", text: "Risk on launch?", delay: 0 },
    { side: "R", text: "DB migration blocks it.", delay: 0.5 },
    { side: "L", text: "We can defer to next sprint.", delay: 1.1 },
  ];
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-1.5 overflow-hidden">
      {msgs.map((m, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: m.side === "L" ? -10 : 10 }}
          animate={{ opacity: [0, 1, 1, 0.3], x: 0 }}
          transition={{
            duration: 3.5,
            delay: m.delay,
            repeat: Infinity,
            repeatDelay: 1,
            ease: "easeOut",
            times: [0, 0.15, 0.85, 1],
          }}
          className={cx("flex", m.side === "R" ? "justify-end" : "justify-start")}
        >
          <div
            className="max-w-[80%] rounded-2xl border px-2.5 py-1 text-[11px] leading-tight"
            style={{
              borderColor: "var(--lp-border)",
              background:
                m.side === "R"
                  ? "color-mix(in oklch, var(--lp-dot) 16%, var(--lp-surface-alt))"
                  : "var(--lp-surface-alt)",
              color: "var(--lp-text)",
            }}
          >
            {m.text}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ToolsRowVisual() {
  const tools = ["Gmail", "Slack", "GitHub", "Notion", "Linear", "Figma"];
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-2 overflow-hidden">
      <div
        aria-hidden
        className="absolute left-0 right-0 top-1/2 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, var(--lp-border), transparent)",
        }}
      />
      {tools.map((t, i) => (
        <motion.div
          key={t}
          className="relative flex h-7 items-center rounded-full border px-2.5 text-[10px] font-medium"
          style={{
            borderColor: "var(--lp-border)",
            background: "var(--lp-surface-alt)",
          }}
          animate={{ y: [0, -2, 0] }}
          transition={{
            duration: 2.6 + (i % 3) * 0.4,
            delay: i * 0.15,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <span
            className="mr-1.5 h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--lp-dot)" }}
          />
          {t}
        </motion.div>
      ))}
    </div>
  );
}

function TaskListExecutionVisual() {
  const tasks = [
    { label: "Drafted weekly summary", delay: 0 },
    { label: "Sent for review", delay: 1.2 },
    { label: "Posted to #general", delay: 2.4 },
  ];
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-2">
      {tasks.map((t, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <motion.div
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border"
            style={{
              borderColor: "var(--lp-border)",
              background: "var(--lp-surface-alt)",
            }}
            animate={{
              background: [
                "var(--lp-surface-alt)",
                "var(--lp-surface-alt)",
                "color-mix(in oklch, var(--lp-dot) 35%, var(--lp-surface-alt))",
                "color-mix(in oklch, var(--lp-dot) 35%, var(--lp-surface-alt))",
              ],
            }}
            transition={{
              duration: 4.5,
              times: [0, t.delay / 4.5, (t.delay + 0.3) / 4.5, 1],
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <motion.svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--lp-text)" }}
              animate={{ opacity: [0, 0, 1, 1] }}
              transition={{
                duration: 4.5,
                times: [0, t.delay / 4.5, (t.delay + 0.3) / 4.5, 1],
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <path d="M5 13l4 4L19 7" />
            </motion.svg>
          </motion.div>
          <motion.span
            className="text-[12px] leading-tight"
            animate={{ opacity: [0.5, 0.5, 1, 1] }}
            transition={{
              duration: 4.5,
              times: [0, t.delay / 4.5, (t.delay + 0.3) / 4.5, 1],
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{ color: "var(--lp-text)" }}
          >
            {t.label}
          </motion.span>
        </div>
      ))}
    </div>
  );
}

function CaptureVisual() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        className="absolute right-3 h-3 w-3 rounded-full"
        style={{ background: "var(--lp-text)", opacity: 0.85 }}
      />
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--lp-dot)" }}
          animate={{
            x: [-30 - i * 6, 30],
            y: [(i - 1) * 14, 0],
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: 2.6,
            delay: i * 0.4,
            repeat: Infinity,
            ease: "easeIn",
          }}
        />
      ))}
    </div>
  );
}

function SimulateVisual() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border"
          style={{
            borderColor: "var(--lp-dot)",
            width: 14 + i * 12,
            height: 14 + i * 12,
            opacity: 0.4,
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.55, 0.2] }}
          transition={{
            duration: 2.4,
            delay: i * 0.35,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
      <div
        className="relative h-2.5 w-2.5 rounded-full"
        style={{ background: "var(--lp-text)" }}
      />
    </div>
  );
}

function ExecuteVisual() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        className="absolute left-3 h-3 w-3 rounded-full"
        style={{ background: "var(--lp-text)", opacity: 0.85 }}
      />
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute flex items-center"
          animate={{
            x: [-12, 36],
            y: [(i - 1) * 14, (i - 1) * 14],
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: 2.4,
            delay: i * 0.4,
            repeat: Infinity,
            ease: "easeOut",
          }}
        >
          <svg width="20" height="8" viewBox="0 0 20 8" fill="none">
            <path
              d="M0 4 L16 4 M12 1 L16 4 L12 7"
              stroke="var(--lp-dot)"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>
      ))}
    </div>
  );
}

function PainCard({
  title,
  body,
  visual,
}: {
  title: string;
  body: string;
  visual: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className="group relative z-10 flex flex-col overflow-hidden rounded-[var(--lp-radius)] border p-6"
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, var(--pain-glow), transparent 60%)",
        }}
      />
      <div className="relative mb-5">{visual}</div>
      <h3 className="relative text-lg font-semibold tracking-tight">{title}</h3>
      <p
        className="relative mt-2 text-[15px] leading-relaxed"
        style={{ color: "var(--lp-text-muted)" }}
      >
        {body}
      </p>
    </motion.div>
  );
}

function KnowledgeLeavingVisual() {
  return (
    <div className="relative flex h-20 items-center justify-center">
      {/* Doorway */}
      <div
        className="absolute left-[28%] top-1/2 h-16 w-10 -translate-y-1/2 rounded-t-md border-2"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
        aria-hidden
      >
        <div
          className="absolute right-1 top-1/2 h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--lp-text-muted)" }}
        />
      </div>
      {/* Walking person */}
      <motion.div
        className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface)",
        }}
        animate={{ x: [0, 60, 60], opacity: [1, 1, 0] }}
        transition={{
          duration: 3.6,
          times: [0, 0.6, 1],
          repeat: Infinity,
          repeatDelay: 0.4,
          ease: "easeInOut",
        }}
      >
        <UserCircle
          width={20}
          height={20}
          strokeWidth={1.5}
          style={{ color: "var(--lp-text)" }}
        />
      </motion.div>
      {/* Trailing knowledge dots fading out */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute left-[18%] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full"
          style={{ background: "var(--lp-dot)" }}
          animate={{
            x: [0, 12, 24],
            opacity: [0.8, 0.4, 0],
          }}
          transition={{
            duration: 2,
            delay: i * 0.4,
            repeat: Infinity,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

function ScatteredFragmentsVisual() {
  const fragments = [
    { dx: -28, dy: -10, delay: 0 },
    { dx: 30, dy: -14, delay: 0.15 },
    { dx: -34, dy: 12, delay: 0.3 },
    { dx: 28, dy: 14, delay: 0.45 },
    { dx: -10, dy: -22, delay: 0.6 },
    { dx: 14, dy: 22, delay: 0.75 },
  ];
  return (
    <div className="relative flex h-20 items-center justify-center">
      <div
        className="absolute h-3 w-3 rounded-full"
        style={{ background: "var(--lp-text-muted)", opacity: 0.4 }}
        aria-hidden
      />
      {fragments.map((f, i) => (
        <motion.div
          key={i}
          className="absolute h-3 w-4 rounded-sm border"
          style={{
            borderColor: "var(--lp-border)",
            background: "var(--lp-surface-alt)",
          }}
          animate={{
            x: [0, f.dx, 0],
            y: [0, f.dy, 0],
            rotate: [0, (i % 2 === 0 ? -10 : 10), 0],
            opacity: [0.4, 1, 0.4],
          }}
          transition={{
            duration: 3.4,
            delay: f.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

function PassiveAssistantVisual() {
  return (
    <div className="relative flex h-20 items-center justify-center">
      <div
        className="relative flex items-center gap-1.5 rounded-2xl border px-4 py-2.5"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--lp-text-muted)" }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1.4,
              delay: i * 0.18,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      {/* Tail of bubble */}
      <div
        className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
        aria-hidden
      />
    </div>
  );
}

function HeroBackdrop() {
  const blobs = [
    {
      size: 520,
      top: "-10%",
      left: "-8%",
      from: "color-mix(in oklch, var(--lp-dot) 35%, transparent)",
      delay: 0,
      rotate: 12,
    },
    {
      size: 420,
      top: "8%",
      right: "-6%",
      from: "color-mix(in oklch, var(--lp-brand) 22%, transparent)",
      delay: 0.4,
      rotate: -10,
    },
    {
      size: 360,
      bottom: "-12%",
      left: "32%",
      from: "color-mix(in oklch, var(--lp-dot) 28%, transparent)",
      delay: 0.8,
      rotate: -18,
    },
    {
      size: 260,
      top: "55%",
      left: "-4%",
      from: "color-mix(in oklch, var(--lp-brand) 18%, transparent)",
      delay: 1.1,
      rotate: 24,
    },
    {
      size: 200,
      top: "20%",
      left: "42%",
      from: "color-mix(in oklch, var(--lp-dot) 22%, transparent)",
      delay: 1.4,
      rotate: -8,
    },
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {blobs.map((b, i) => {
        const positionStyle: React.CSSProperties = {
          width: b.size,
          height: b.size * 0.42,
          top: b.top,
          left: (b as { left?: string }).left,
          right: (b as { right?: string }).right,
          bottom: (b as { bottom?: string }).bottom,
        };
        return (
          <motion.div
            key={i}
            className="absolute rounded-full blur-2xl"
            style={{
              ...positionStyle,
              background: `radial-gradient(closest-side, ${b.from}, transparent 70%)`,
            }}
            initial={{ opacity: 0, y: -40, rotate: b.rotate - 8 }}
            animate={{ opacity: 1, y: 0, rotate: b.rotate }}
            transition={{
              duration: 1.8,
              delay: b.delay,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <motion.div
              className="absolute inset-0"
              animate={{ y: [0, 14, 0] }}
              transition={{
                duration: 9 + i * 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.div>
        );
      })}
      <div
        className="absolute inset-x-0 bottom-0 h-24"
        style={{
          background:
            "linear-gradient(to bottom, transparent, var(--lp-bg) 80%)",
        }}
      />
    </div>
  );
}

function BentoTile({
  span,
  eyebrow,
  title,
  body,
  visual,
}: {
  span: string;
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-[var(--lp-radius)] border p-5",
        span,
      )}
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, var(--bento-glow), transparent 60%)",
        }}
      />
      <div className="relative flex-1">{visual}</div>
      <div className="relative mt-4">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--lp-dot)" }}
        >
          {eyebrow}
        </p>
        <h3 className="mt-1 text-[18px] font-semibold tracking-tight">
          {title}
        </h3>
        <p
          className="mt-1 text-[13px] leading-snug"
          style={{ color: "var(--lp-text-muted)" }}
        >
          {body}
        </p>
      </div>
    </motion.div>
  );
}

function BrainVisual() {
  return (
    <div className="relative flex h-full min-h-[140px] items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border"
          style={{
            borderColor: "var(--lp-border)",
            width: `${50 + i * 30}%`,
            aspectRatio: "1 / 1",
          }}
          animate={{
            scale: [1, 1.06, 1],
            opacity: [0.3, 0.55, 0.3],
          }}
          transition={{
            duration: 3.6,
            delay: i * 0.6,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
      <motion.div
        className="absolute h-12 w-12 rounded-full"
        style={{
          background:
            "radial-gradient(circle, var(--lp-dot) 0%, transparent 70%)",
          filter: "blur(8px)",
        }}
        animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.2, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="relative h-3 w-3 rounded-full"
        style={{ background: "var(--lp-text)" }}
      />
      {[0, 60, 120, 180, 240, 300].map((deg, i) => (
        <motion.div
          key={deg}
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{
            background: "var(--lp-text)",
            opacity: 0.7,
            transform: `rotate(${deg}deg) translate(58px) rotate(-${deg}deg)`,
          }}
          animate={{ opacity: [0.3, 0.9, 0.3] }}
          transition={{
            duration: 2.8,
            delay: i * 0.3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

function ArtifactsVisual() {
  return (
    <div className="relative flex h-full min-h-[100px] items-center">
      <div
        className="relative w-full max-w-md rounded-2xl border px-4 py-3"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
      >
        <p
          className="text-[12px]"
          style={{ color: "var(--lp-text-muted)" }}
        >
          Generating the launch dashboard…
        </p>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <motion.div
              key={i}
              className="h-5 rounded-[3px]"
              style={{ background: "var(--lp-dot)" }}
              initial={{ opacity: 0.15, scaleY: 0.4 }}
              animate={{
                opacity: [0.15, 0.7, 0.15],
                scaleY: [0.4, 1, 0.4],
              }}
              transition={{
                duration: 2,
                delay: i * 0.12,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MentionVisual() {
  return (
    <div className="relative flex h-full min-h-[90px] items-center justify-center">
      <motion.span
        className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
        animate={{
          boxShadow: [
            "0 0 0 0 rgba(0,0,0,0)",
            "0 0 0 6px var(--bento-glow)",
            "0 0 0 0 rgba(0,0,0,0)",
          ],
        }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
      >
        @dana
      </motion.span>
      <motion.span
        className="mx-2 text-[14px]"
        style={{ color: "var(--lp-text-muted)" }}
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      >
        →
      </motion.span>
      <motion.span
        className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
        animate={{
          boxShadow: [
            "0 0 0 0 rgba(0,0,0,0)",
            "0 0 0 6px var(--bento-glow)",
            "0 0 0 0 rgba(0,0,0,0)",
          ],
        }}
        transition={{
          duration: 2.2,
          delay: 1.1,
          repeat: Infinity,
          ease: "easeOut",
        }}
      >
        @arie
      </motion.span>
    </div>
  );
}

function ApprovalVisual() {
  return (
    <div className="relative flex h-full min-h-[90px] items-center justify-center gap-2">
      <motion.div
        className="rounded-md border px-3 py-1.5 text-[12px] font-semibold"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
        }}
        animate={{
          background: [
            "var(--lp-surface-alt)",
            "color-mix(in oklch, var(--lp-dot) 20%, var(--lp-surface-alt))",
            "var(--lp-surface-alt)",
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      >
        ✓ Approve
      </motion.div>
      <div
        className="rounded-md border px-3 py-1.5 text-[12px]"
        style={{
          borderColor: "var(--lp-border)",
          background: "var(--lp-surface-alt)",
          color: "var(--lp-text-muted)",
        }}
      >
        ✕ Reject
      </div>
    </div>
  );
}

function ShiftLoopVisual() {
  return (
    <div className="relative flex h-full min-h-[90px] items-center gap-4">
      <motion.div
        className="relative h-12 w-12"
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      >
        <svg viewBox="0 0 48 48" className="h-full w-full">
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="var(--lp-border)"
            strokeWidth="2"
          />
          <path
            d="M24 4 a20 20 0 0 1 14 6"
            fill="none"
            stroke="var(--lp-dot)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full"
            style={{ background: "var(--lp-border)" }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ background: "var(--lp-dot)" }}
              animate={{ width: ["0%", "100%"] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--lp-text-muted)" }}
          >
            shift #142
          </span>
        </div>
        <p
          className="mt-2 text-[11px] leading-tight"
          style={{ color: "var(--lp-text-muted)" }}
        >
          Reading PRs · Drafting summary · Posting to Slack
        </p>
      </div>
    </div>
  );
}

function BudgetVisual() {
  return (
    <div className="relative flex h-full min-h-[90px] flex-col justify-center gap-2">
      <div className="flex items-baseline justify-between">
        <motion.span
          className="font-mono text-[22px] tracking-tight"
          animate={{ opacity: [1, 1, 1] }}
        >
          $<motion.span
            initial={{ display: "inline" }}
            animate={{}}
          />
          <BudgetCounter />
        </motion.span>
        <span
          className="text-[12px]"
          style={{ color: "var(--lp-text-muted)" }}
        >
          of $3.00 / day
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full"
        style={{ background: "var(--lp-border)" }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, var(--lp-dot), color-mix(in oklch, var(--lp-dot) 60%, transparent))",
          }}
          animate={{ width: ["6%", "85%", "85%", "6%"] }}
          transition={{
            duration: 5,
            times: [0, 0.6, 0.85, 1],
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>
    </div>
  );
}

function BudgetCounter() {
  return (
    <motion.span
      animate={{ opacity: 1 }}
      style={{ display: "inline-block", minWidth: "3.5ch" }}
    >
      <motion.span
        animate={{}}
        transition={{ duration: 5, repeat: Infinity }}
      >
        2.55
      </motion.span>
    </motion.span>
  );
}

function OrgBrainVisual() {
  const nodes = [
    { x: 20, y: 30 },
    { x: 75, y: 25 },
    { x: 50, y: 55 },
    { x: 25, y: 80 },
    { x: 80, y: 75 },
  ];
  const edges = [
    [0, 2],
    [1, 2],
    [2, 3],
    [2, 4],
    [0, 1],
  ];
  return (
    <div className="relative flex h-full min-h-[90px] items-center">
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {edges.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={nodes[a].x}
            y1={nodes[a].y}
            x2={nodes[b].x}
            y2={nodes[b].y}
            stroke="var(--lp-border)"
            strokeWidth="0.8"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 3,
              delay: i * 0.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
        {nodes.map((n, i) => (
          <motion.circle
            key={i}
            cx={n.x}
            cy={n.y}
            r={i === 2 ? 3.5 : 2.2}
            fill="var(--lp-text)"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{
              duration: 2.4,
              delay: i * 0.3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </svg>
    </div>
  );
}

function MarketplaceVisual() {
  const cards = ["Product Manager", "QA / E2E", "Tech Writer", "AI Eval"];
  return (
    <div className="relative flex h-full min-h-[90px] items-center">
      <div className="relative h-16 w-full">
        {cards.map((c, i) => (
          <motion.div
            key={c}
            className="absolute inset-y-0 left-0 flex w-44 items-center rounded-lg border px-3 text-[12px] font-medium"
            style={{
              borderColor: "var(--lp-border)",
              background: "var(--lp-surface-alt)",
              left: `${i * 16}px`,
              top: `${i * 4}px`,
              zIndex: cards.length - i,
            }}
            animate={{
              x: [0, 8, 0],
              opacity: [0.85, 1, 0.85],
            }}
            transition={{
              duration: 3.6,
              delay: i * 0.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            {c}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function PrimaryCta({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-[48px] items-center justify-center rounded-[var(--lp-radius-sm)] px-6 text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: "var(--lp-brand)",
        color: "var(--lp-bg)",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryCta({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[48px] items-center justify-center rounded-[var(--lp-radius-sm)] border px-6 text-[15px] font-semibold transition-colors"
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
        color: "var(--lp-text)",
      }}
    >
      {children}
    </button>
  );
}

function SurfaceCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx("rounded-[var(--lp-radius)] border", className)}
      style={{
        borderColor: "var(--lp-border)",
        background: "var(--lp-surface)",
        boxShadow: "0 1px 0 rgba(22,19,17,0.04)",
      }}
    >
      {children}
    </div>
  );
}

function useSectionView(
  event: "integration_section_viewed" | "execution_section_viewed",
) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const obs = new IntersectionObserver(
      (entries) => {
        if (done) return;
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.2)) {
          done = true;
          trackLandingEvent(event);
          obs.disconnect();
        }
      },
      { threshold: [0, 0.2, 0.35] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [event]);
  return ref;
}

export function LandingPage() {
  const formId = useId();
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("compare")) setShowCompare(true);
  }, []);

  const openCompare = useCallback(() => {
    setShowCompare(true);
    const url = new URL(window.location.href);
    url.searchParams.set("compare", "cabinet");
    window.history.pushState({}, "", url.toString());
  }, []);

  const closeCompare = useCallback(() => {
    setShowCompare(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("compare");
    window.history.pushState({}, "", url.toString());
  }, []);

  const [formStarted, setFormStarted] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const uspViewed = useRef(new Set<number>());
  const uspSectionRef = useRef<HTMLDivElement>(null);
  const integrationRef = useSectionView("integration_section_viewed");
  const executionRef = useSectionView("execution_section_viewed");

  useEffect(() => {
    trackLandingEvent("landing_viewed");
  }, []);

  // Section reveal on scroll-into-view (subtle fade-up, inline-applied)
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("main > section"),
    );
    if (!sections.length) return;
    const TRANSITION =
      "opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)";
    const reveal = (el: HTMLElement) => {
      el.style.setProperty("opacity", "1", "important");
      el.style.setProperty("transform", "translateY(0)", "important");
    };
    const hide = (el: HTMLElement) => {
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("transform", "translateY(18px)", "important");
    };
    sections.forEach((s) => {
      s.style.transition = TRANSITION;
      s.style.willChange = "opacity, transform";
      const r = s.getBoundingClientRect();
      const inView = r.top < window.innerHeight - 40 && r.bottom > 80;
      if (inView) reveal(s);
      else hide(s);
    });
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            reveal(e.target as HTMLElement);
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const root = uspSectionRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.uspIndex);
          if (!Number.isFinite(idx) || uspViewed.current.has(idx)) continue;
          uspViewed.current.add(idx);
          trackLandingEvent("usp_card_viewed", { index: idx });
        }
      },
      { threshold: 0.45 },
    );
    root.querySelectorAll("[data-usp-card]").forEach((c) => obs.observe(c));
    return () => obs.disconnect();
  }, []);

  const scrollToWaitlist = useCallback(() => {
    trackLandingEvent("hero_cta_clicked");
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollToHow = useCallback(() => {
    trackLandingEvent("secondary_cta_clicked");
    document
      .getElementById("features")
      ?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const [installCopied, setInstallCopied] = useState(false);
  const copyInstall = useCallback(async () => {
    try {
      await navigator.clipboard.writeText("npx employee001 setup");
      trackLandingEvent("install_copied");
      setInstallCopied(true);
      setTimeout(() => setInstallCopied(false), 2000);
    } catch {
      // clipboard blocked — silently fail; user can still read the command
    }
  }, []);

  const markFormStarted = useCallback(() => {
    if (!formStarted) {
      setFormStarted(true);
      trackLandingEvent("waitlist_form_started");
    }
  }, [formStarted]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    const fd = new FormData(e.currentTarget);
    const payload = {
      fullName: String(fd.get("fullName") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      companyName: String(fd.get("companyName") ?? "").trim(),
      roleTitle: String(fd.get("roleTitle") ?? "").trim(),
      companySize: String(fd.get("companySize") ?? "").trim(),
      useCase: String(fd.get("useCase") ?? "").trim(),
      toolsUsed: String(fd.get("toolsUsed") ?? "").trim(),
    };
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Something went wrong");
        trackLandingEvent("waitlist_form_error", { status: res.status });
        return;
      }
      setStatus("success");
      trackLandingEvent("waitlist_form_submitted");
      e.currentTarget.reset();
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
      trackLandingEvent("waitlist_form_error", { reason: "network" });
    }
  }

  return (
    <div className="landing-root">
      <header className="pointer-events-none fixed inset-x-0 top-4 z-50 px-4 sm:top-5 sm:px-6">
        <nav
          className="pointer-events-auto mx-auto flex w-fit items-center gap-2 rounded-full border px-2 py-1.5 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl backdrop-saturate-150"
          style={{
            borderColor: "color-mix(in oklch, var(--lp-border) 70%, transparent)",
            background: "color-mix(in oklch, var(--lp-bg) 62%, transparent)",
          }}
          aria-label="Main"
        >
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full pl-2 pr-3 no-underline"
          >
            <Image
              src="/logo.svg"
              alt=""
              width={26}
              height={26}
              className="landing-logo-mark shrink-0"
              priority
            />
            <span className="text-[14px] font-semibold tracking-tight">
              Employee001
            </span>
          </Link>

          <div
            className="mx-1 hidden h-5 w-px md:block"
            style={{ background: "color-mix(in oklch, var(--lp-border) 80%, transparent)" }}
            aria-hidden
          />

          <div className="hidden items-center md:flex">
            {[
              { label: "Features", href: "#features" },
              { label: "Stack", href: "#stack" },
              { label: "Integrations", href: "#integrations" },
              { label: "Premium", href: "#premium" },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3 py-1.5 text-[13px] font-medium no-underline transition-colors hover:text-[var(--lp-text)]"
                style={{ color: "var(--lp-text-muted)" }}
              >
                {label}
              </a>
            ))}
          </div>

          <div className="ml-1 flex items-center gap-1.5">
            <LandingThemeToggle />
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-[13px] font-semibold no-underline"
              style={{
                background: "var(--lp-brand)",
                color: "var(--lp-bg)",
              }}
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero — full-bleed AI Grid canvas */}
        <section
          id="hero"
          className="relative min-h-[88vh] overflow-hidden bg-black text-white"
        >
          <HeroCanvas />
          <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-[var(--lp-max)] flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
              className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60"
            >
              Agent twins · Organizational intelligence
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="text-balance text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.75rem]"
              style={{
                fontFamily:
                  "var(--font-instrument-serif), 'Instrument Serif', serif",
                fontWeight: 400,
                letterSpacing: "-0.015em",
                textShadow: "0 4px 30px rgba(0,0,0,0.7)",
              }}
            >
              Your company&rsquo;s
              <br />
              organizational brain.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.45 }}
              className="mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-white/75"
            >
              Runs on your Mac mini. Your data never leaves the building.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
              className="mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <button
                type="button"
                onClick={copyInstall}
                aria-label="Copy install command to clipboard"
                className="group inline-flex min-h-[48px] items-center gap-3 rounded-[var(--lp-radius-sm)] bg-white px-5 text-[15px] font-medium text-black transition-opacity hover:opacity-90"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              >
                <span className="text-black/40">$</span>
                <span>npx employee001 setup</span>
                <span
                  className="ml-1 inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: installCopied ? "#1f7a3a" : "rgba(0,0,0,0.4)" }}
                >
                  {installCopied ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Copy
                    </>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={scrollToWaitlist}
                className="inline-flex min-h-[48px] items-center justify-center rounded-[var(--lp-radius-sm)] border border-white/20 bg-white/5 px-6 text-[15px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/10"
              >
                Talk to us
              </button>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.75 }}
              className="mt-8 flex flex-wrap justify-center gap-2"
            >
              {[
                "MIT licensed",
                "100% local",
                "No telemetry",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-medium text-white/70 backdrop-blur-sm"
                >
                  {t}
                </span>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Twin meetings */}
        <section
          className="border-t px-4 py-16 sm:px-6"
          style={{ borderColor: "var(--lp-border)", background: "var(--lp-surface-alt)" }}
        >
          <div className="mx-auto max-w-[var(--lp-max)]">
            <SectionTitle title="Ask one question. Let the right twins meet." />
            <p
              className="mb-10 max-w-3xl text-pretty text-[17px] leading-relaxed"
              style={{ color: "var(--lp-text-muted)" }}
            >
              Drop one question into a council. Watch the relevant twins
              think, debate, and converge — live, the same way they do
              inside the product.
            </p>
            <TwinCouncilDemo />
          </div>
        </section>

        {/* Execution */}
        <section ref={executionRef} id="execution"
          className="border-t px-4 py-16 sm:px-6"
          style={{ borderColor: "var(--lp-border)", background: "var(--lp-surface-alt)" }}
        >
          <div className="mx-auto max-w-[var(--lp-max)]">
            <SectionTitle title="Not just answers. Work delivered." />
            <p
              className="mb-10 max-w-3xl text-pretty text-[17px] leading-relaxed"
              style={{ color: "var(--lp-text-muted)" }}
            >
              Twins draft, post, file, and follow up — directly inside the
              tools your team already lives in. These are real outputs, not
              chat replies.
            </p>
            <OutputGallery />
            <div className="mt-10 flex justify-center">
              <PrimaryCta onClick={scrollToWaitlist}>Join the waitlist</PrimaryCta>
            </div>
          </div>
        </section>

        {/* Stack — what it's built on */}
        <section
          id="stack"
          className="border-t px-4 py-16 sm:px-6"
          style={{
            borderColor: "var(--lp-border)",
            background: "var(--lp-surface-alt)",
          }}
        >
          <div className="mx-auto max-w-[var(--lp-max)]">
            <SectionTitle
              eyebrow="The stack"
              title="Built on the open agentic stack."
            />
            <p
              className="mb-10 max-w-3xl text-pretty text-[17px] leading-relaxed"
              style={{ color: "var(--lp-text-muted)" }}
            >
              Employee001 stands on two pillars: Anthropic’s Claude Agent SDK
              for reasoning and autonomous execution, and Composio’s MCP layer
              for connecting twins to the tools your team already uses. No
              proprietary black box — every piece is inspectable.
            </p>

            <div className="grid gap-6 lg:grid-cols-2">
              <SurfaceCard className="p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full border"
                    style={{
                      borderColor: "var(--lp-border)",
                      background: "var(--lp-surface)",
                    }}
                  >
                    <Sparks
                      width={20}
                      height={20}
                      style={{ color: "var(--lp-dot)" }}
                      strokeWidth={1.5}
                    />
                  </div>
                  <div>
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: "var(--lp-text-muted)" }}
                    >
                      Reasoning &amp; execution
                    </p>
                    <h3 className="text-lg font-semibold">
                      Claude Agent SDK
                    </h3>
                  </div>
                </div>
                <p
                  className="mt-4 text-[15px] leading-relaxed"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  Anthropic’s official agent runtime. Streaming responses,
                  sub-agents, permission prompts, tool-use orchestration, and
                  long-running task loops — all powered by Claude Opus and
                  Sonnet.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {[
                    "@anthropic-ai/claude-agent-sdk",
                    "@anthropic-ai/sdk",
                    "Streaming",
                    "Sub-agents",
                    "MCP-aware",
                  ].map((t) => (
                    <span
                      key={t}
                      className="rounded-full border px-2.5 py-1 text-[12px]"
                      style={{
                        borderColor: "var(--lp-border)",
                        background: "var(--lp-surface)",
                        color: "var(--lp-text-muted)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full border"
                    style={{
                      borderColor: "var(--lp-border)",
                      background: "var(--lp-surface)",
                    }}
                  >
                    <Network
                      width={20}
                      height={20}
                      style={{ color: "var(--lp-dot)" }}
                      strokeWidth={1.5}
                    />
                  </div>
                  <div>
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: "var(--lp-text-muted)" }}
                    >
                      Tool integrations
                    </p>
                    <h3 className="text-lg font-semibold">Composio MCP</h3>
                  </div>
                </div>
                <p
                  className="mt-4 text-[15px] leading-relaxed"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  The integration layer that gives twins real hands. Composio
                  exposes hundreds of apps — Gmail, Slack, Notion, GitHub,
                  Salesforce, Jira, and more — to the agent over the Model
                  Context Protocol with proper auth and per-action permissions.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {[
                    "@composio/core",
                    "@composio/claude-agent-sdk",
                    "MCP",
                    "OAuth per user",
                    "Tool policies",
                  ].map((t) => (
                    <span
                      key={t}
                      className="rounded-full border px-2.5 py-1 text-[12px]"
                      style={{
                        borderColor: "var(--lp-border)",
                        background: "var(--lp-surface)",
                        color: "var(--lp-text-muted)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </SurfaceCard>
            </div>

            <div className="mt-10">
              <h3
                className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--lp-text-muted)" }}
              >
                And the rest of the stack
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[
                  { label: "Next.js 16", sub: "App Router, RSC" },
                  { label: "React 19", sub: "Server + client components" },
                  { label: "TypeScript 5", sub: "End-to-end typed" },
                  { label: "Tailwind CSS v4", sub: "Design tokens & layers" },
                  { label: "Three.js", sub: "3D org-brain visualization" },
                  { label: "React Flow", sub: "Twin graph & workflows" },
                  { label: "Framer Motion", sub: "Interactions" },
                  { label: "promptfoo", sub: "Eval-driven prompts" },
                ].map(({ label, sub }) => (
                  <SurfaceCard key={label} className="px-4 py-3">
                    <p className="text-[14px] font-semibold">{label}</p>
                    <p
                      className="mt-1 text-[12px] leading-snug"
                      style={{ color: "var(--lp-text-muted)" }}
                    >
                      {sub}
                    </p>
                  </SurfaceCard>
                ))}
              </div>
            </div>

            <p
              className="mt-8 text-[12px]"
              style={{ color: "var(--lp-text-muted)" }}
            >
              Versions reflect the current package.json. SQLite + Docker
              single-tenant deploy on the Mac mini ships with the first
              enterprise release.
            </p>
          </div>
        </section>

        {/* Integrations — Composio orbit */}
        <section
          ref={integrationRef}
          id="integrations"
          className="mx-auto max-w-[var(--lp-max)] px-4 py-16 sm:px-6"
        >
          <SectionTitle title="Connected to the tools your team already uses." />
          <p
            className="mb-10 max-w-3xl text-pretty text-[17px] leading-relaxed"
            style={{ color: "var(--lp-text-muted)" }}
          >
            Every twin is wired to your real work environments through{" "}
            <span style={{ color: "var(--lp-text)", fontWeight: 600 }}>
              Composio MCP
            </span>{" "}
            — hundreds of apps, real OAuth per user, fine-grained tool policies.
            Not a wrapper around your inbox.
          </p>

          <IntegrationsOrbit />

          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
            {INTEGRATIONS.map(({ label, Icon }) => (
              <SurfaceCard
                key={label}
                className="flex items-center gap-3 p-4 sm:p-5"
              >
                <Icon
                  width={22}
                  height={22}
                  className="shrink-0"
                  style={{ color: "var(--lp-text-muted)" }}
                  strokeWidth={1.35}
                />
                <span className="text-[14px] font-medium leading-snug">
                  {label}
                </span>
              </SurfaceCard>
            ))}
          </div>
        </section>


        {/* What you get */}
        <section
          id="features"
          className="border-t px-4 py-16 sm:px-6"
          style={{ borderColor: "var(--lp-border)", background: "var(--lp-surface-alt)" }}
        >
          <div className="mx-auto max-w-[var(--lp-max)]">
            <SectionTitle
              eyebrow="What you get"
              title="Six capabilities that change how companies work."
            />
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  Icon: UserCircle,
                  eyebrow: "Twins",
                  title: "Agent twins for every employee",
                  body: "An always-on AI twin for each employee — trained on their role, context, work style, and real work history.",
                },
                {
                  Icon: Group,
                  eyebrow: "Twin Meetings",
                  title: "Council meetings on demand",
                  body: "Ask one question. The right twins debate, challenge, and converge — just like a real cross-functional meeting.",
                },
                {
                  Icon: TaskList,
                  eyebrow: "Execution",
                  title: "Real tool execution",
                  body: "Twins draft Slack messages, file Linear tickets, send emails, and push code — directly in the tools your team uses.",
                },
                {
                  Icon: Database,
                  eyebrow: "Org Brain",
                  title: "Shared organizational memory",
                  body: "One knowledge graph every twin reads from. What one twin learns, the rest inherit — the company gets smarter over time.",
                },
                {
                  Icon: Network,
                  eyebrow: "Deployment",
                  title: "On-prem by design",
                  body: "Runs on your Mac mini via Docker. Single-tenant, zero cloud dependency. Your data never leaves the building.",
                },
                {
                  Icon: Shield,
                  eyebrow: "Governance",
                  title: "Human-controlled autonomy",
                  body: "Every sensitive action hits an approval gate. Editable args, then approve or reject — before anything runs.",
                },
              ].map(({ Icon, eyebrow, title, body }) => (
                <SurfaceCard key={title} className="p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
                      style={{
                        borderColor: "var(--lp-border)",
                        background: "var(--lp-surface)",
                      }}
                    >
                      <Icon
                        width={20}
                        height={20}
                        style={{ color: "var(--lp-dot)" }}
                        strokeWidth={1.5}
                      />
                    </div>
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: "var(--lp-text-muted)" }}
                    >
                      {eyebrow}
                    </p>
                  </div>
                  <h3 className="text-[17px] font-semibold leading-snug">{title}</h3>
                  <p
                    className="mt-2 text-[15px] leading-relaxed"
                    style={{ color: "var(--lp-text-muted)" }}
                  >
                    {body}
                  </p>
                </SurfaceCard>
              ))}
            </div>

            <div className="mt-10">
              <p
                className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--lp-text-muted)" }}
              >
                + 20 more surfaces shipping today
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "Twin Builder",
                  "Twin Versions",
                  "Scratch Notes",
                  "Persistent Chat",
                  "Twin-to-Twin Handoff",
                  "Parallel Subagents",
                  "Hidden Intent Planner",
                  "Brain Builder Agent",
                  "Trigger-based Recall",
                  "Org-wide Custom MCP",
                  "Focus Prefetch",
                  "Shift Routines + Cron",
                  "Task Templates",
                  "Input Editing on Approval",
                  "Error Recovery",
                  "Audit Log",
                  "Live Cockpit",
                  "Org Feed & Inbox",
                  "Streaming Tool Progress",
                  "Task Event Log",
                ].map((t) => (
                  <span
                    key={t}
                    className="rounded-full border px-3 py-1 text-[12px]"
                    style={{
                      borderColor: "var(--lp-border)",
                      background: "var(--lp-surface)",
                      color: "var(--lp-text-muted)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
        {/* Trust */}
        <section id="trust" className="mx-auto max-w-[var(--lp-max)] px-4 py-16 sm:px-6">
          <SectionTitle title="Built for trust, context, and control." />
          <div className="grid gap-6 md:grid-cols-2">
            {[
              {
                title: "Permission-aware context",
                body: "Twins access information consistent with what each user is allowed to access.",
              },
              {
                title: "Human-controlled execution",
                body: "Sensitive actions are designed for review and approval before they run.",
              },
              {
                title: "Transparent reasoning trails",
                body: "Outputs can surface context, sources, or decision basis when possible.",
              },
              {
                title: "Workspace-level governance",
                body: "Admins get visibility into connected sources, twins, permissions, and activity.",
              },
            ].map(({ title, body }) => (
              <SurfaceCard key={title} className="p-6">
                <h3 className="text-lg font-semibold">{title}</h3>
                <p
                  className="mt-2 text-[15px] leading-relaxed"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  {body}
                </p>
              </SurfaceCard>
            ))}
          </div>
        </section>

        {/* Open-core / Premium services */}
        <section
          id="premium"
          className="border-t px-4 py-16 sm:px-6"
          style={{ borderColor: "var(--lp-border)" }}
        >
          <div className="mx-auto max-w-[var(--lp-max)]">
            <SectionTitle
              eyebrow="Open-core"
              title="The whole product is open source. Pay for help, not features."
            />
            <p
              className="mb-10 max-w-3xl text-pretty text-[17px] leading-relaxed"
              style={{ color: "var(--lp-text-muted)" }}
            >
              100% of the code in this repo is MIT-licensed and free. Every feature
              you see in the product is yours to run, fork, and modify. There is no
              feature gate, no license key, no premium tier of the binary.
            </p>

            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  eyebrow: "Free forever",
                  title: "The whole app",
                  body: "Twins, councils, MCP execution, Org Brain, approval gates. Everything in the product. MIT licensed.",
                  cta: { label: "Install with npx", action: copyInstall },
                },
                {
                  eyebrow: "Premium service",
                  title: "Professional onboarding",
                  body: "We come in, install it on your Mac mini, wire up your MCPs, train your team, and stay on a dedicated Slack channel.",
                  cta: { label: "Get a quote", action: scrollToWaitlist },
                },
                {
                  eyebrow: "Premium service",
                  title: "SLA support",
                  body: "Production support contract with response-time SLA and custom integrations on request.",
                  cta: { label: "Talk to us", action: scrollToWaitlist },
                },
              ].map(({ eyebrow, title, body, cta }) => (
                <SurfaceCard key={title} className="flex flex-col p-6">
                  <p
                    className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: "var(--lp-dot)" }}
                  >
                    {eyebrow}
                  </p>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p
                    className="mt-2 flex-1 text-[15px] leading-relaxed"
                    style={{ color: "var(--lp-text-muted)" }}
                  >
                    {body}
                  </p>
                  <button
                    type="button"
                    onClick={cta.action}
                    className="mt-5 inline-flex items-center gap-1 self-start text-[14px] font-semibold no-underline transition-opacity hover:opacity-70"
                    style={{ color: "var(--lp-text)" }}
                  >
                    {cta.label}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </button>
                </SurfaceCard>
              ))}
            </div>
          </div>
        </section>

        {/* Waitlist + final CTA */}
        <section
          id="waitlist"
          className="border-t px-4 py-16 sm:px-6"
          style={{ borderColor: "var(--lp-border)", background: "var(--lp-surface-alt)" }}
        >
          <div className="mx-auto max-w-[var(--lp-max)]">
            <div className="mx-auto max-w-xl text-center">
              <h2
                className="text-balance text-4xl tracking-tight sm:text-5xl"
                style={{
                  fontFamily: "var(--font-instrument-serif), 'Instrument Serif', serif",
                  fontWeight: 400,
                  letterSpacing: "-0.01em",
                }}
              >
                Want us to set it up for you?
              </h2>
              <p
                className="mt-4 text-pretty text-[17px] leading-relaxed"
                style={{ color: "var(--lp-text-muted)" }}
              >
                The app is free to install yourself with{" "}
                <code
                  className="rounded px-1.5 py-0.5 text-[14px]"
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    background: "var(--lp-surface)",
                    border: "1px solid var(--lp-border)",
                  }}
                >
                  npx employee001
                </code>
                . Drop your email if you&rsquo;d like a quote for professional onboarding, MCP wiring, and SLA support.
              </p>
              <p
                className="mt-2 text-[13px] font-medium"
                style={{ color: "var(--lp-dot)" }}
              >
                Premium services · response within 24h
              </p>
            </div>

            <div className="mx-auto mt-10 max-w-md">
              {status === "success" ? (
                <div
                  className="rounded-[var(--lp-radius)] border px-6 py-8 text-center"
                  style={{
                    borderColor: "var(--lp-border)",
                    background: "var(--lp-surface)",
                  }}
                  role="status"
                >
                  <div
                    className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                    style={{
                      background:
                        "color-mix(in oklch, var(--lp-dot) 18%, transparent)",
                      color: "var(--lp-text)",
                    }}
                    aria-hidden
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-[17px] font-medium">
                    You&rsquo;re on the list.
                  </p>
                  <p
                    className="mt-1 text-[14px]"
                    style={{ color: "var(--lp-text-muted)" }}
                  >
                    We&rsquo;ll be in touch soon.
                  </p>
                </div>
              ) : (
                <form onSubmit={onSubmit} noValidate>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label htmlFor={`${formId}-email`} className="sr-only">
                      Work email
                    </label>
                    <input
                      id={`${formId}-email`}
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@company.com"
                      onFocus={markFormStarted}
                      className="h-12 flex-1 rounded-full border px-5 text-[15px] outline-none transition-colors focus:border-current"
                      style={{
                        borderColor: "var(--lp-border)",
                        background: "var(--lp-surface)",
                        color: "var(--lp-text)",
                      }}
                    />
                    <button
                      type="submit"
                      disabled={status === "loading"}
                      className="h-12 rounded-full px-6 text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        background: "var(--lp-brand)",
                        color: "var(--lp-bg)",
                      }}
                    >
                      {status === "loading" ? "Joining…" : "Join waitlist"}
                    </button>
                  </div>
                  {status === "error" ? (
                    <p
                      className="mt-3 text-center text-[14px] font-medium"
                      style={{ color: "var(--danger, #A04B3D)" }}
                      role="alert"
                    >
                      {errorMsg}
                    </p>
                  ) : null}
                  <p
                    className="mt-3 text-center text-[12px]"
                    style={{ color: "var(--lp-text-muted)" }}
                  >
                    No spam. Unsubscribe anytime.
                  </p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer
        className="border-t px-4 py-10 sm:px-6"
        style={{ borderColor: "var(--lp-border)" }}
      >
        <div
          className="mx-auto flex max-w-[var(--lp-max)] flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left"
        >
          <p className="text-[14px]" style={{ color: "var(--lp-text-muted)" }}>
            © {new Date().getFullYear()} Employee001. Organizational intelligence
            for modern teams.
          </p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={openCompare}
              className="text-[14px] font-medium no-underline transition-colors hover:opacity-70"
              style={{ color: "var(--lp-text-muted)" }}
            >
              How we compare
            </button>
            <Link
              href="/login"
              className="text-[14px] font-medium no-underline"
              style={{ color: "var(--lp-text)" }}
            >
              Sign in to workspace
            </Link>
          </div>
        </div>

      {/* Comparison modal — accessible via ?compare=cabinet */}
      <AnimatePresence>
        {showCompare ? (
          <motion.div
            key="compare-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) closeCompare(); }}
          >
            <motion.div
              key="compare-panel"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[var(--lp-radius)] border shadow-2xl"
              style={{
                borderColor: "var(--lp-border)",
                background: "var(--lp-bg)",
              }}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4 backdrop-blur-md"
                style={{ borderColor: "var(--lp-border)", background: "color-mix(in oklch, var(--lp-bg) 90%, transparent)" }}
              >
                <p className="text-[13px] font-semibold" style={{ color: "var(--lp-text-muted)" }}>
                  How we compare
                </p>
                <button
                  type="button"
                  onClick={closeCompare}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/10"
                  style={{ color: "var(--lp-text-muted)" }}
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 sm:p-8">
                <SectionTitle
                  eyebrow="How we’re different"
                  title="Employee001 vs. Cabinet."
                />
                <p
                  className="mb-10 max-w-3xl text-pretty text-[17px] leading-relaxed"
                  style={{ color: "var(--lp-text-muted)" }}
                >
                  Cabinet is a personal AI knowledge base that runs on one founder’s laptop. Employee001 is an organizational brain — twins of your real employees, on real infrastructure, working as a team.
                </p>

                <SurfaceCard className="overflow-hidden p-0">
                  <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr_1fr]">
                    <div
                      className="hidden border-b px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.08em] md:block"
                      style={{ borderColor: "var(--lp-border)", color: "var(--lp-text-muted)", background: "var(--lp-surface-alt)" }}
                    >Dimension</div>
                    <div
                      className="border-b px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.08em]"
                      style={{ borderColor: "var(--lp-border)", background: "var(--lp-surface-alt)", color: "var(--lp-text-muted)" }}
                    >Cabinet</div>
                    <div
                      className="border-b px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.08em]"
                      style={{ borderColor: "var(--lp-border)", background: "color-mix(in oklch, var(--lp-dot) 12%, var(--lp-surface-alt))", color: "var(--lp-text)" }}
                    >Employee001</div>

                    {[
                      {
                        axis: "Who the agent represents",
                        cabinet: "Generic role templates (“CEO Agent”, “Marketer Agent”) you pick from a wizard.",
                        us: "A digital twin of a real, named employee — their tone, decisions, prior work, and (soon) their voice.",
                      },
                      {
                        axis: "Who it’s for",
                        cabinet: "A single founder on their own laptop. No multi-user, no shared org context.",
                        us: "An entire company on one shared brain. Every twin reads the same Org Brain and stays in sync.",
                      },
                      {
                        axis: "Autonomy model",
                        cabinet: "Wraps a Claude Code CLI in a terminal window — you watch it type.",
                        us: "Native Claude Agent SDK: streaming, sub-agents, MCP tools, headless tasks that run while you sleep.",
                      },
                      {
                        axis: "Deployment",
                        cabinet: "Electron app or `npx` install on one machine. Cloud waitlist for hosted.",
                        us: "Single-tenant install on the customer’s own Mac mini via Docker. Your data never leaves the building.",
                      },
                      {
                        axis: "Org-wide knowledge",
                        cabinet: "Personal notebook of markdown files on one disk.",
                        us: "Org Brain shared across every twin — what one twin learns, the rest inherit.",
                      },
                    ].map(({ axis, cabinet, us }, i, arr) => (
                      <div key={axis} className="contents">
                        <div className="px-6 py-5 text-[14px] font-semibold md:border-r"
                          style={{ borderColor: "var(--lp-border)", borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomStyle: "solid", borderBottomColor: "var(--lp-border)" }}
                        >{axis}</div>
                        <div className="px-6 py-5 text-[14px] leading-relaxed md:border-r"
                          style={{ color: "var(--lp-text-muted)", borderColor: "var(--lp-border)", borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomStyle: "solid", borderBottomColor: "var(--lp-border)" }}
                        >{cabinet}</div>
                        <div className="px-6 py-5 text-[14px] font-medium leading-relaxed"
                          style={{ color: "var(--lp-text)", background: "color-mix(in oklch, var(--lp-dot) 6%, transparent)", borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomStyle: "solid", borderBottomColor: "var(--lp-border)" }}
                        >{us}</div>
                      </div>
                    ))}
                  </div>
                </SurfaceCard>

                <p className="mt-8 text-center text-[12px]" style={{ color: "var(--lp-text-muted)" }}>
                  Comparison reflects public information about Cabinet (hilash/cabinet, MIT-licensed) as of May 2026.
                </p>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      </footer>
    </div>
  );
}