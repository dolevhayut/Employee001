import type { ReactNode } from "react";
import { Shell } from "@/components/ex/shell";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
