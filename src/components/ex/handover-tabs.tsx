"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Handover (Labs) is one sidebar entry with two tabs: the scripted export and
// the live interview. Same pill look as the Schedules / Focus tabs.
const TABS = [
  { href: "/handover", label: "Handover" },
  { href: "/handover/live", label: "Live interview" },
];

export function HandoverTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Handover" style={{ display: "flex", gap: "var(--sp-6)" }}>
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            style={{
              padding: "5px 12px",
              fontSize: "var(--fs-sm)",
              fontWeight: active ? 600 : 500,
              borderRadius: 999,
              border: "1px solid var(--hairline)",
              background: active ? "var(--text)" : "var(--surface)",
              color: active ? "var(--bg)" : "var(--text-muted)",
              textDecoration: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
