"use client";

// Shown when an operator page's data fetch fails: a panel with Try again
// before anything has loaded, a quiet line once a stale view is on screen.

export function LoadErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "var(--sp-10)",
        maxWidth: 420,
        padding: "var(--sp-12) var(--sp-14)",
        border: "1px solid var(--hairline)",
        borderRadius: 8,
        background: "color-mix(in oklch, var(--danger) 12%, transparent)",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "var(--fs-ui)",
          fontWeight: 600,
          color: "var(--danger)",
          lineHeight: 1.45,
        }}
      >
        {message}
      </p>
      <button type="button" className="btn sm" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function RefreshMiss() {
  return (
    <p
      style={{
        margin: "0 0 var(--sp-12)",
        fontSize: "var(--fs-sm)",
        color: "var(--text-muted)",
      }}
    >
      {"Couldn't refresh"}
    </p>
  );
}
