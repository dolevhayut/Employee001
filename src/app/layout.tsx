import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

// Load the brand fonts once at the root so every page — welcome, join,
// workspace — has access to them via CSS variables. Individual pages
// reference --font-geist / --font-geist-mono / --font-instrument-serif
// (or the --font / --font-mono / --font-serif tokens) rather than re-importing.
// Geist and Geist Mono are variable fonts, so every weight is available.

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  display: "swap",
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "Employee001",
  description: "Your team, always available.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const themeScript = `(function(){try{var s=localStorage.getItem('em001-theme');var t=(s==='dark'||s==='light'||s==='cool')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      style={{ height: "100%" }}
    >
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body style={{ height: "100%", margin: 0 }}>{children}</body>
    </html>
  );
}
