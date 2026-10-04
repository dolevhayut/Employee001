"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useT } from "@/components/ex/i18n-context";

export function DemoBanner({ question, live = false }: { question: string; live?: boolean }) {
  const { t } = useT();
  return (
    <motion.aside
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-12)",
        padding: "9px 18px",
        background: "color-mix(in oklch, var(--accent) 12%, var(--surface))",
        borderBottom: "1px solid color-mix(in oklch, var(--accent) 35%, var(--hairline))",
        color: "var(--text)",
        flexWrap: "wrap",
        position: "relative",
        zIndex: 20,
      }}
    >
      <span style={{ fontSize: "var(--fs-xs)", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)" }}>
        {t("demo.banner.label")}
      </span>
      <span style={{ fontSize: "var(--fs-sm)", fontWeight: 650 }}>
        {t(live ? "demo.banner.live" : "demo.banner.replay")}
      </span>
      <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>{t("demo.banner.body")}</span>
      {!live && (
        <Link
          href={`/council?q=${encodeURIComponent(question)}`}
          style={{ fontSize: "var(--fs-sm)", color: "var(--accent)", fontWeight: 650, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          {t("demo.banner.ask")} →
        </Link>
      )}
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)", flex: "1 1 330px" }}>{t("demo.banner.upgrade")}</span>
    </motion.aside>
  );
}
