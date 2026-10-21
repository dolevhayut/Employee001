"use client";

import { useState, type CSSProperties, type ChangeEvent, type ReactNode } from "react";

export { cardStyle, ErrorLine, Heading } from "./auth-ui";

// Interactive pieces for the sign-in, setup and account pages.

const labelStyle: CSSProperties = {
  fontSize: "var(--fs-meta)",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-subtle)",
  marginBottom: "var(--sp-6)",
  display: "block",
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  fontSize: "var(--fs-ui)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 4,
  background: "var(--surface)",
  outline: "none",
  width: "100%",
  color: "var(--text)",
  transition: "border-color .12s",
};

export function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  inputMode,
  autoFocus,
  hint,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "email" | "text";
  autoFocus?: boolean;
  hint?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: "var(--sp-16)" }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...inputStyle, borderColor: focused ? "var(--text)" : "var(--hairline-strong)" }}
      />
      {hint && <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-subtle)", marginTop: "var(--sp-6)" }}>{hint}</div>}
    </div>
  );
}

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, data };
}
