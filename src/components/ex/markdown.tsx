"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import { useRoster } from "@/components/ex/roster-context";
import { isSafeImageSrc } from "@/lib/safe-image-src";

/** Turn `@FirstName` for the given people into mention links Markdown renders as chips. */
export function linkMentions(text: string, people: { id: string; firstName: string }[]): string {
  if (!people.length) return text;
  const byName = new Map(people.map((p) => [p.firstName.toLowerCase(), p.id]));
  const names = people.map((p) => p.firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`(^|[^\\w\\[])@(${names})\\b`, "gi"), (m, pre: string, name: string) => {
    const id = byName.get(name.toLowerCase());
    return id ? `${pre}[@${name}](#mention-${id})` : m;
  });
}

/** An @mention of a twin: avatar + name on the accent tint. */
function MentionChip({ id, children }: { id: string; children?: ReactNode }) {
  const emp = useRoster().find((e) => e.id === id);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 7px 0 2px",
        margin: "0 1px",
        borderRadius: 999,
        verticalAlign: "baseline",
        fontWeight: 600,
        fontSize: "0.92em",
        lineHeight: 1.55,
        color: "var(--accent-deep)",
        background: "color-mix(in oklab, var(--accent) 14%, transparent)",
        border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)",
        whiteSpace: "nowrap",
      }}
    >
      {emp && (
        <span style={{ width: 16, height: 16, borderRadius: "50%", display: "inline-grid", placeItems: "center", fontSize: 8, fontWeight: 700, color: "var(--text)", background: emp.avatarColor }}>
          {emp.initials}
        </span>
      )}
      {children}
    </span>
  );
}

type Props = {
  children: string;
};

/**
 * Rich markdown renderer for twin chat bubbles.
 * Supports GFM tables, lists, bold, code, blockquotes, headings.
 * Styled to match the warm cream design system.
 */
export function Markdown({ children }: Props) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Remote images would load as soon as the reply renders (an exfil
          // channel that skips approvals); show them as text instead.
          img: ({ src, alt }: { src?: unknown; alt?: string }) =>
            isSafeImageSrc(src) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={alt ?? ""} style={{ maxWidth: "100%" }} />
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "0.92em" }}>
                [image not loaded{alt ? `: ${alt}` : ""}{typeof src === "string" ? ` (${src.slice(0, 120)})` : ""}]
              </span>
            ),
          // Render as <div> instead of <p> — react-markdown can produce
          // <pre>/<table>/<ul> as children of <p> during streaming, which is
          // invalid HTML and triggers a hydration error. <div> accepts any block.
          p: ({ children }: { children?: ReactNode }) => (
            <div dir="auto" style={{ margin: "0 0 8px", lineHeight: 1.65 }}>{children}</div>
          ),
          h1: ({ children }: { children?: ReactNode }) => (
            <h1
              dir="auto"
              style={{
                fontSize: "var(--fs-lg)",
                fontWeight: 700,
                margin: "12px 0 6px",
                lineHeight: 1.3,
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }: { children?: ReactNode }) => (
            <h2
              dir="auto"
              style={{
                fontSize: "var(--fs-base)",
                fontWeight: 700,
                margin: "10px 0 4px",
                lineHeight: 1.3,
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }: { children?: ReactNode }) => (
            <h3
              dir="auto"
              style={{
                fontSize: "var(--fs-ui)",
                fontWeight: 600,
                margin: "10px 0 4px",
                color: "var(--text)",
              }}
            >
              {children}
            </h3>
          ),
          ul: ({ children }: { children?: ReactNode }) => (
            <ul
              dir="auto"
              style={{
                margin: "0 0 8px",
                paddingInlineStart: "var(--sp-18)",
                lineHeight: 1.6,
              }}
            >
              {children}
            </ul>
          ),
          ol: ({ children }: { children?: ReactNode }) => (
            <ol
              dir="auto"
              style={{
                margin: "0 0 8px",
                paddingInlineStart: "var(--sp-22)",
                lineHeight: 1.6,
              }}
            >
              {children}
            </ol>
          ),
          li: ({ children }: { children?: ReactNode }) => (
            <li style={{ marginBottom: "var(--sp-2)" }}>{children}</li>
          ),
          strong: ({ children }: { children?: ReactNode }) => (
            <strong style={{ fontWeight: 700, color: "var(--text)" }}>
              {children}
            </strong>
          ),
          em: ({ children }: { children?: ReactNode }) => (
            <em style={{ fontStyle: "italic" }}>{children}</em>
          ),
          // react-markdown no longer passes `inline`: a fenced block has a
          // language class or spans lines; anything else is inline code.
          code: ({ className, children }: { className?: string; children?: ReactNode }) =>
            /language-/.test(className ?? "") || String(children ?? "").includes("\n") ? (
              <pre
                style={{
                  background: "var(--bg-sunken)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 6,
                  padding: "var(--sp-10)",
                  overflowX: "auto",
                  fontSize: "var(--fs-sm)",
                  lineHeight: 1.5,
                  margin: "8px 0",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }}
              >
                <code>{children}</code>
              </pre>
            ) : (
              <code
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: "0.88em",
                  background: "var(--bg-sunken)",
                  padding: "1px 5px",
                  borderRadius: 3,
                  border: "1px solid var(--hairline)",
                }}
              >
                {children}
              </code>
            ),
          // The block styling lives on `code`; keep `pre` from adding a second box.
          pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
          blockquote: ({ children }: { children?: ReactNode }) => (
            <blockquote
              dir="auto"
              style={{
                borderInlineStart: "3px solid var(--accent-soft)",
                margin: "8px 0",
                padding: "2px 0 2px 10px",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }: { children?: ReactNode }) => (
            <div
              style={{
                margin: "10px 0",
                overflowX: "auto",
                border: "1px solid var(--hairline)",
                borderRadius: 6,
              }}
            >
              <table
                dir="auto"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "var(--fs-ui)",
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }: { children?: ReactNode }) => (
            <th
              style={{
                background: "var(--bg-sunken)",
                fontWeight: 600,
                textAlign: "start",
                padding: "6px 10px",
                borderBottom: "1px solid var(--hairline)",
                fontSize: "var(--fs-sm)",
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }: { children?: ReactNode }) => (
            <td
              style={{
                padding: "6px 10px",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              {children}
            </td>
          ),
          hr: () => (
            <hr
              style={{
                border: "none",
                borderTop: "1px solid var(--hairline)",
                margin: "10px 0",
              }}
            />
          ),
          // `[@Name](#mention-<employeeId>)` (see linkMentions) renders as a chip.
          a: ({ href, children }: { href?: string; children?: ReactNode }) =>
            href?.startsWith("#mention-") ? (
              <MentionChip id={href.slice("#mention-".length)}>{children}</MentionChip>
            ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--accent-deep)",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {children}
            </a>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
