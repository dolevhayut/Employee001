import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ex/logo";
import { ThemeInit } from "@/components/ex/theme-init";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ThemeInit />
      <header
        style={{
          padding: "24px 32px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-8)",
            textDecoration: "none",
            color: "var(--text)",
            fontSize: "var(--fs-body)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          <Logo size={24} />
          Employee001
        </Link>
      </header>

      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 24px 48px",
        }}
      >
        {children}
      </main>

      <footer
        style={{
          padding: "20px 32px",
          fontSize: "var(--fs-meta)",
          color: "var(--text-subtle)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        © Employee001
      </footer>
    </div>
  );
}
