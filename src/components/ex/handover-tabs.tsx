"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/ex/i18n-context";
import type { MessageKey } from "@/lib/i18n/messages";

// Handover (Labs) is one sidebar entry with two tabs: the scripted export and
// the live interview. Same pill look as the Schedules / Focus tabs.
const TABS: { href: string; labelKey: MessageKey }[] = [
  { href: "/handover", labelKey: "nav.handover" },
  { href: "/handover/live", labelKey: "handover.live" },
];

export function HandoverTabs() {
  const pathname = usePathname();
  const { t } = useT();

  return (
    <nav aria-label={t("nav.handover")} style={{ display: "flex", gap: "var(--sp-6)" }}>
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
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
