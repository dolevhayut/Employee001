import type { CSSProperties, ReactNode } from "react";

// Static pieces for the sign-in, setup and account pages (usable from
// server components).

export const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "var(--surface)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "var(--sp-36)",
};

export function Heading({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--sp-28)" }}>
      <h1 style={{ fontSize: "var(--fs-h3)", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>{title}</h1>
      {sub && <p style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", margin: "6px 0 0", lineHeight: 1.5 }}>{sub}</p>}
    </div>
  );
}

export function ErrorLine({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" style={{ fontSize: "var(--fs-sm)", color: "var(--danger, #b42318)", marginBottom: "var(--sp-12)" }}>
      {children}
    </div>
  );
}

