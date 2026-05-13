import type { CSSProperties, ReactNode } from "react";
import { Icons, type IconName } from "@/components/ex/icons";

type Props = {
  icon: IconName | ReactNode;
  title: string;
  subtitle: string;
  style?: CSSProperties;
};

export function PageHead({ icon, title, subtitle, style }: Props) {
  const isIconName = (v: unknown): v is IconName =>
    typeof v === "string" && v in Icons;

  return (
    <div
      style={{
        background: "var(--surface-soft)",
        border: "1px solid var(--hairline)",
        borderRadius: 14,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-18)",
        ...style,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 11,
          background: "var(--accent-soft)",
          color: "var(--accent-deep)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isIconName(icon) ? (() => {
          const Icon = Icons[icon];
          return <Icon size={20} />;
        })() : icon}
      </div>
      <div>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text)", marginBottom: "var(--sp-3)" }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

