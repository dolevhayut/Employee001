import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Open_Sans } from "next/font/google";
import { I18nProvider } from "@/components/ex/i18n-context";
import "./globals.css";

// Load the brand fonts once at the root so every page — welcome, join,
// workspace — has access to them via CSS variables. Individual pages
// reference --font-geist / --font-geist-mono / --font-instrument-serif
// (or the --font / --font-mono / --font-serif tokens) rather than re-importing.
// Geist and Geist Mono are variable fonts, so every weight is available.
//
// Hebrew uses Open Sans (SIL OFL), Hebrew subset only, self-hosted by
// next/font at build time and exposed as --font-he. It's a variable font
// (300–800). globals.css puts it first in --font only when html[lang="he"];
// Latin characters in Hebrew text still fall through to Geist.
// preload is off so English sessions don't fetch the Hebrew faces.
// adjustFontFallback is off so the Hebrew stack stays Open Sans, then Geist,
// then system-ui — not an Arial metric override in front of Geist.

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const openSansHebrew = Open_Sans({
  subsets: ["hebrew"],
  display: "swap",
  variable: "--font-he",
  preload: false,
  adjustFontFallback: false,
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
  // Blocking, before paint — same idea as the theme script. Default is English.
  // Hebrew sets lang=he and dir=rtl so the sidebar mirrors and --font picks
  // up Open Sans Hebrew with no flash of LTR/Geist.
  const bootScript = `(function(){try{var s=localStorage.getItem('em001-theme');var t=(s==='dark'||s==='light'||s==='cool')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}try{var l=localStorage.getItem('em001-lang');var lang=l==='he'?'he':'en';var el=document.documentElement;el.lang=lang;el.dir=lang==='he'?'rtl':'ltr';}catch(e){}})();`;
  return (
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable} ${openSansHebrew.variable}`}
      style={{ height: "100%" }}
    >
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: bootScript }}
        />
      </head>
      <body style={{ height: "100%", margin: 0 }}>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
