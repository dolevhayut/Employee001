import { Topbar } from "./shell";
import { Icons } from "./icons";

export function ComingSoon({
  crumbs,
  title,
  stage,
  description,
}: {
  crumbs: string[];
  title: string;
  stage: string;
  description: string;
}) {
  return (
    <>
      <Topbar crumbs={crumbs} />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "grid",
          placeItems: "center",
          padding: "var(--sp-40)",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 16px",
              color: "var(--text-subtle)",
            }}
          >
            <Icons.Clock size={20} />
          </div>
          <span className="badge accent" style={{ marginBottom: "var(--sp-12)" }}>
            {stage}
          </span>
          <h1
            style={{
              fontSize: "var(--fs-h3)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "10px 0 6px",
            }}
          >
            {title}
          </h1>
          <p className="muted" style={{ fontSize: "var(--fs-ui)", lineHeight: 1.55, margin: 0 }}>
            {description}
          </p>
        </div>
      </div>
    </>
  );
}
