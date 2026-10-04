import type { ReactNode } from "react";
import { Shell } from "@/components/ex/shell";
import { DemoBanner } from "@/components/ex/demo-banner";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <DemoBanner />
      {children}
    </Shell>
  );
}

