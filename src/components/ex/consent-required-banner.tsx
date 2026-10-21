"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Twin = { id: string; name: string };

// Deny-by-default consent: twins whose employee hasn't recorded consent run
// with no personal tools, transcripts or actions and can't be trained. This
// banner says so and links to each profile's re-consent invite.
export function ConsentRequiredBanner() {
  const [twins, setTwins] = useState<Twin[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/consent/required", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ twins: Twin[] }>) : null))
      .then((value) => {
        if (!cancelled && value) setTwins(value.twins);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!twins.length) return null;
  const shown = twins.slice(0, 3);
  return (
    <aside
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-10)",
        padding: "9px 18px",
        background: "color-mix(in oklch, var(--warn) 12%, var(--surface))",
        borderBottom: "1px solid color-mix(in oklch, var(--warn) 40%, var(--hairline))",
        color: "var(--text)",
        flexWrap: "wrap",
        fontSize: "var(--fs-sm)",
      }}
    >
      <strong style={{ fontWeight: 650 }}>
        {twins.length === 1 ? "1 twin needs its employee's consent." : `${twins.length} twins need their employees' consent.`}
      </strong>
      <span style={{ color: "var(--text-muted)" }}>
        Until consent is recorded they can&apos;t be trained, use the employee&apos;s tools or transcripts, or act for them.
      </span>
      {shown.map((t) => (
        <Link
          key={t.id}
          href={`/profile?employee=${encodeURIComponent(t.id)}`}
          style={{ color: "var(--accent-deep)", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          Request consent from {t.name} →
        </Link>
      ))}
      {twins.length > shown.length && <span style={{ color: "var(--text-muted)" }}>+{twins.length - shown.length} more on Employees</span>}
    </aside>
  );
}
