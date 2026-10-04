import type { ReactNode } from "react";
import { Shell } from "@/components/ex/shell";
import { DemoBanner } from "@/components/ex/demo-banner";
import { loadDemoRecording } from "@/lib/demo-replay";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const isDemo = process.env.EMPLOYEE001_DEMO === "1";
  let question = "What should Lumen Labs prioritize this quarter?";
  if (isDemo) {
    try {
      question = (await loadDemoRecording()).question;
    } catch {
      // The meeting itself will surface a recording configuration error.
    }
  }
  return <Shell>{isDemo && <DemoBanner question={question} live={process.env.EMPLOYEE001_DEMO_LIVE === "1"} />}{children}</Shell>;
}
