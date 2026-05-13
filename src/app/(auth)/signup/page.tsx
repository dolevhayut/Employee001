"use client";

import { useState, useMemo, type CSSProperties, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
  children,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  children?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: "var(--sp-16)" }}>
      <label style={labelStyle}>{label}</label>
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
      {children}
    </div>
  );
}

function scorePassword(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length === 0) return { score: 0, label: "", color: "var(--hairline-strong)" };
  if (score <= 1) return { score: 1, label: "Weak", color: "var(--danger)" };
  if (score === 2) return { score: 2, label: "Fair", color: "var(--warn)" };
  if (score === 3) return { score: 3, label: "Good", color: "var(--accent)" };
  return { score: 4, label: "Strong", color: "var(--success)" };
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");

  const strength = useMemo(() => scorePassword(password), [password]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    router.push("/setup");
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: "var(--sp-28)" }}>
        <h1 style={{ fontSize: "var(--fs-h3)", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          Create your account
        </h1>
        <p style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", margin: "6px 0 0" }}>
          Start your team workspace in under a minute.
        </p>
      </div>

      <form onSubmit={onSubmit}>
        <Field
          label="Full name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Cooper"
          autoComplete="name"
        />
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
          placeholder="At least 8 characters"
          autoComplete="new-password"
        >
          <div style={{ marginTop: "var(--sp-8)" }}>
            <div
              style={{
                display: "flex",
                gap: "var(--sp-4)",
                marginBottom: "var(--sp-4)",
              }}
            >
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 3,
                    borderRadius: 2,
                    background:
                      i < strength.score ? strength.color : "var(--hairline)",
                    transition: "background .15s",
                  }}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: "var(--fs-meta)",
                color: strength.label ? strength.color : "var(--text-subtle)",
                minHeight: 14,
              }}
            >
              {strength.label || "Use 8+ characters with letters, numbers, and a symbol."}
            </div>
          </div>
        </Field>

        <Field
          label="Company name"
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Acme Inc."
          autoComplete="organization"
        />

        <button
          type="submit"
          className="btn primary lg"
          style={{ width: "100%", justifyContent: "center", marginTop: "var(--sp-8)" }}
        >
          Create account
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
        Already have an account?{" "}
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
