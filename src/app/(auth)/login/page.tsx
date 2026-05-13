"use client";

import { useState, type CSSProperties, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Glyphs } from "@/components/ex/glyphs";

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "var(--surface)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "var(--sp-36)",
};

const labelStyle: CSSProperties = {
  fontSize: "var(--fs-meta)",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-subtle)",
  marginBottom: "var(--sp-6)",
  display: "block",
};

const baseInputStyle: CSSProperties = {
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

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  trailing,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  trailing?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: "var(--sp-16)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label style={labelStyle}>{label}</label>
        {trailing}
      </div>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...baseInputStyle,
          borderColor: focused ? "var(--text)" : "var(--hairline-strong)",
        }}
      />
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    router.push("/workspace");
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: "var(--sp-28)" }}>
        <h1 style={{ fontSize: "var(--fs-h3)", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          Sign in to Employee001
        </h1>
        <p style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", margin: "6px 0 0" }}>
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <form onSubmit={onSubmit}>
        <Field
          label="Work email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          trailing={
            <Link
              href="/forgot-password"
              style={{
                fontSize: "var(--fs-meta)",
                color: "var(--accent-deep)",
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              Forgot password?
            </Link>
          }
        />

        <button
          type="submit"
          className="btn primary lg"
          style={{ width: "100%", justifyContent: "center", marginTop: "var(--sp-8)" }}
        >
          Sign in
        </button>
      </form>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-12)",
          margin: "24px 0",
          color: "var(--text-subtle)",
          fontSize: "var(--fs-meta)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <div style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
        or
        <div style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
        <button
          type="button"
          className="btn lg"
          style={{ width: "100%", justifyContent: "center" }}
        >
          <Glyphs.gmail size={16} />
          Continue with Google
        </button>
        <button
          type="button"
          className="btn lg"
          style={{ width: "100%", justifyContent: "center" }}
        >
          <Glyphs.outlook size={16} />
          Continue with Microsoft
        </button>
      </div>

      <p
        style={{
          marginTop: "var(--sp-24)",
          fontSize: "var(--fs-sm)",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          style={{ color: "var(--text)", fontWeight: 500, textDecoration: "none" }}
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
