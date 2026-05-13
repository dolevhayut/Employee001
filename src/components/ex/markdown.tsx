"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

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
          // Render as <div> instead of <p> — react-markdown can produce
          // <pre>/<table>/<ul> as children of <p> during streaming, which is
          // invalid HTML and triggers a hydration error. <div> accepts any block.
          p: ({ children }: { children?: ReactNode }) => (
            <div style={{ margin: "0 0 8px", lineHeight: 1.65 }}>{children}</div>
          ),
          h1: ({ children }: { children?: ReactNode }) => (
            <h1
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
              style={{
                margin: "0 0 8px",
                paddingLeft: "var(--sp-18)",
                lineHeight: 1.6,
              }}
            >
              {children}
            </ul>
          ),
          ol: ({ children }: { children?: ReactNode }) => (
            <ol
              style={{
                margin: "0 0 8px",
                paddingLeft: "var(--sp-22)",
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
          code: ({
            inline,
            children,
          }: {
            inline?: boolean;
            children?: ReactNode;
          }) =>
            inline ? (
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
            ) : (
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
            ),
          blockquote: ({ children }: { children?: ReactNode }) => (
            <blockquote
              style={{
                borderLeft: "3px solid var(--accent-soft)",
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
                textAlign: "left",
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
          a: ({ href, children }: { href?: string; children?: ReactNode }) => (
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
