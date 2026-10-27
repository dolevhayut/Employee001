"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Markdown } from "@/components/ex/markdown";

/**
 * A tool call's arguments, readable. Every field the tool will receive is
 * shown (an approval must never hide what it approves), but as a card
 * instead of JSON: Roomate tasks as task cards, long text as Markdown,
 * lists as chips. The raw JSON is one click away.
 */
export function ApprovalArgs({ input }: { input: Record<string, unknown> }) {
  const [raw, setRaw] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <div
        className="scrollbar"
        style={{
          maxHeight: 360,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-10)",
          paddingInlineEnd: 2,
        }}
      >
        {raw ? (
          <pre style={rawStyle}>{JSON.stringify(input, null, 2)}</pre>
        ) : (
          <Fields value={input} depth={0} />
        )}
      </div>
      <button
        type="button"
        onClick={() => setRaw((v) => !v)}
        aria-pressed={raw}
        style={linkButton}
      >
        {raw ? "Show as a card" : "Show raw JSON"}
      </button>
    </div>
  );
}

const rawStyle: CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  background: "var(--bg-sunken)",
  borderRadius: 8,
  fontSize: "var(--fs-meta)",
  fontFamily: "var(--font-mono, monospace)",
  color: "var(--text-muted)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  lineHeight: 1.55,
};

const linkButton: CSSProperties = {
  alignSelf: "flex-start",
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--text-muted)",
  fontSize: "var(--fs-meta)",
  textDecoration: "underline",
  textUnderlineOffset: 3,
  cursor: "pointer",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "acceptanceCriteria" → "Acceptance criteria", "file_path" → "File path". */
const ACRONYMS: Record<string, string> = { url: "URL", uri: "URI", id: "ID", ids: "IDs", api: "API", mcp: "MCP", html: "HTML", json: "JSON", cc: "CC", bcc: "BCC" };

function humanize(key: string): string {
  if (ACRONYMS[key.toLowerCase()]) return ACRONYMS[key.toLowerCase()];
  const spaced = key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Fields that read best as Markdown when they hold more than a line. */
const PROSE_KEYS = /^(description|body|content|text|message|note|notes|summary|context|context_md|spec|spec_md|rationale|question|problem|reason|prompt)$/i;
/** Short status-like fields shown as badges next to a title. */
const BADGE_KEYS = ["kind", "type", "size", "priority", "risk", "stage", "status"];

function Fields({ value, depth }: { value: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {entries.map(([key, v]) =>
        key === "tasks" && Array.isArray(v) && v.every(isRecord) ? (
          <Section key={key} label={`${v.length === 1 ? "Task" : `${v.length} tasks`}`}>
            {v.map((task, i) => (
              <TaskCard key={i} task={task as Record<string, unknown>} />
            ))}
          </Section>
        ) : (
          <Field key={key} name={key} value={v} depth={depth} />
        )
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

const labelStyle: CSSProperties = {
  fontSize: "var(--fs-2xs)",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-subtle)",
};

function Field({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  if (value === undefined || value === null || value === "") {
    return (
      <Row label={humanize(name)}>
        <span style={{ color: "var(--text-subtle)" }}>(empty)</span>
      </Row>
    );
  }
  if (typeof value === "string") {
    const long = value.length > 120 || value.includes("\n");
    if (long && PROSE_KEYS.test(name)) {
      return (
        <Section label={humanize(name)}>
          <div style={proseBox}>
            <Markdown>{value}</Markdown>
          </div>
        </Section>
      );
    }
    return (
      <Row label={humanize(name)}>
        <bdi style={{ wordBreak: "break-word", whiteSpace: long ? "pre-wrap" : undefined }}>{value}</bdi>
      </Row>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <Row label={humanize(name)}>
        <span>{String(value)}</span>
      </Row>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <Row label={humanize(name)}>
          <span style={{ color: "var(--text-subtle)" }}>(none)</span>
        </Row>
      );
    }
    if (value.every((x) => typeof x === "string" || typeof x === "number")) {
      const short = value.every((x) => String(x).length <= 48);
      return short ? (
        <Row label={humanize(name)}>
          <Chips items={value.map(String)} mono={/path|area|file|glob|url/i.test(name)} />
        </Row>
      ) : (
        <Section label={humanize(name)}>
          <ol style={listStyle}>
            {value.map((x, i) => (
              <li key={i}><bdi>{String(x)}</bdi></li>
            ))}
          </ol>
        </Section>
      );
    }
    return (
      <Section label={humanize(name)}>
        {value.map((x, i) =>
          isRecord(x) ? (
            <div key={i} style={nestedBox}>
              <Fields value={x} depth={depth + 1} />
            </div>
          ) : (
            <Field key={i} name={`${name} ${i + 1}`} value={x} depth={depth + 1} />
          )
        )}
      </Section>
    );
  }
  if (isRecord(value)) {
    return (
      <Section label={humanize(name)}>
        <div style={nestedBox}>
          <Fields value={value} depth={depth + 1} />
        </div>
      </Section>
    );
  }
  return (
    <Row label={humanize(name)}>
      <span>{String(value)}</span>
    </Row>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(88px, 132px) 1fr", gap: "var(--sp-10)", alignItems: "baseline", fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>
      <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-meta)" }}>{label}</span>
      <span style={{ color: "var(--text)", minWidth: 0 }}>{children}</span>
    </div>
  );
}

function Chips({ items, mono = false }: { items: string[]; mono?: boolean }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--sp-4)" }}>
      {items.map((item, i) => (
        <span
          key={i}
          style={{
            padding: "1px 8px",
            borderRadius: 999,
            border: "1px solid var(--hairline)",
            background: "var(--surface)",
            fontSize: "var(--fs-meta)",
            color: "var(--text)",
            fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
          }}
        >
          <bdi>{item}</bdi>
        </span>
      ))}
    </span>
  );
}

const proseBox: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  background: "var(--bg-sunken)",
  fontSize: "var(--fs-sm)",
};

const nestedBox: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--hairline)",
  background: "var(--bg-sunken)",
};

const listStyle: CSSProperties = {
  margin: 0,
  paddingInlineStart: "var(--sp-18)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.55,
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-4)",
};

/** A Roomate task (or any { title, … } item): title, badges, then the rest. */
function TaskCard({ task }: { task: Record<string, unknown> }) {
  const title = typeof task.title === "string" ? task.title : undefined;
  const badges = BADGE_KEYS.filter((k) => typeof task[k] === "string" || typeof task[k] === "number");
  const criteria = task.acceptanceCriteria ?? task.acceptance_criteria;
  const rest = Object.fromEntries(
    Object.entries(task).filter(([k]) => k !== "title" && !badges.includes(k) && k !== "acceptanceCriteria" && k !== "acceptance_criteria")
  );
  const criteriaTexts = Array.isArray(criteria)
    ? criteria.map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : typeof c === "string" ? c : JSON.stringify(c)))
    : [];
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--hairline)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-10)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-8)", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", fontSize: "var(--fs-ui)", fontWeight: 600, color: "var(--text)", lineHeight: 1.35 }}>
          <bdi>{title ?? "(no title)"}</bdi>
        </div>
        {badges.length > 0 && (
          <span style={{ display: "inline-flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            {badges.map((k) => (
              <span
                key={k}
                title={humanize(k)}
                style={{
                  padding: "1px 8px",
                  borderRadius: 999,
                  fontSize: "var(--fs-2xs)",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: k === "priority" && /urgent|high|critical/i.test(String(task[k])) ? "var(--warn)" : "var(--text-muted)",
                  background: "color-mix(in oklch, var(--text) 6%, transparent)",
                }}
              >
                {String(task[k])}
              </span>
            ))}
          </span>
        )}
      </div>
      {Object.keys(rest).length > 0 && <Fields value={rest} depth={1} />}
      {criteriaTexts.length > 0 && (
        <Section label="Acceptance criteria">
          <ul style={{ ...listStyle, listStyle: "none", paddingInlineStart: 0 }}>
            {criteriaTexts.map((c, i) => (
              <li key={i} style={{ display: "flex", gap: "var(--sp-6)" }}>
                <span aria-hidden style={{ color: "var(--success)" }}>✓</span>
                <bdi>{c}</bdi>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
