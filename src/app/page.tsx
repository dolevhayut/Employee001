import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Employee001 — Organizational brain for modern companies",
  description:
    "Agent twins for every employee, connected to real work environments. Ask, meet, decide, and execute through one living intelligence layer.",
  openGraph: {
    title: "Employee001 — Your company’s organizational brain",
    description:
      "Agent twins, twin meetings, connected context, and execution workflows for modern teams.",
    type: "website",
  },
};

// Fonts (Manrope + Instrument Serif) are loaded at the root layout and
// exposed as CSS variables — see src/app/layout.tsx.
export default function Home() {
  return (
    <div className="landing-root">
      <LandingPage />
    </div>
  );
}
