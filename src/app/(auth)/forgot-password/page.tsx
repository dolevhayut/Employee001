"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { Icons } from "@/components/ex/icons";

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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [focused, setFocused] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={cardStyle}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "var(--accent-soft)",
            color: "var(--accent-deep)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "var(--sp-20)",
          }}
        >
          <Icons.CheckCircle size={18} />
        </div>
        <h1 style={{ fontSize: "var(--fs-h3)", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          Check your inbox
        </h1>
        <p style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", margin: "8px 0 0", lineHeight: 1.55 }}>
          We sent a reset link to{" "}
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{email || "your email"}</span>.
          The link expires in 30 minutes.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)", marginTop: "var(--sp-28)" }}>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="btn lg"
            style={{ width: "100%", justifyContent: "center" }}
          >
            Use a different email
          </button>
          <Link
            href="/login"
            className="btn ghost lg"
            style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: "var(--sp-28)" }}>
        <h1 style={{ fontSize: "var(--fs-h3)", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          Forgot your password?
        </h1>
        <p style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", margin: "6px 0 0", lineHeight: 1.55 }}>
          Enter your work email and we&apos;ll send you a link to reset it.
        </p>
      </div>

      <form onSubmit={onSubmit}>
        <div style={{ marginBottom: "var(--sp-16)" }}>
          <label style={labelStyle}>Work email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            required
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              ...baseInputStyle,
              borderColor: focused ? "var(--text)" : "var(--hairline-strong)",
            }}
          />
        </div>

        <button
          type="submit"
          className="btn primary lg"
          style={{ width: "100%", justifyContent: "center", marginTop: "var(--sp-8)" }}
        >
          Send reset link
        </button>
      </form>

      <p
        style={{
          marginTop: "var(--sp-24)",
          fontSize: "var(--fs-sm)",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        Remembered it?{" "}
        <Link
          href="/login"
          style={{ color: "var(--text)", fontWeight: 500, textDecoration: "none" }}
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
