import type { Metadata } from "next";
import { Manrope, Instrument_Serif } from "next/font/google";
import { LandingPage } from "@/components/landing/LandingPage";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  display: "swap",
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

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

export default function Home() {
  return (
    <div className={`${manrope.className} ${instrumentSerif.variable} landing-root`}>
      <LandingPage />
    </div>
  );
}
