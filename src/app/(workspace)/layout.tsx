import type { ReactNode } from "react";
import { Shell } from "@/components/ex/shell";
import { DemoBanner } from "@/components/ex/demo-banner";
import { ConsentRequiredBanner } from "@/components/ex/consent-required-banner";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <DemoBanner />
      <ConsentRequiredBanner />
      {children}
    </Shell>
  );
}

