import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning style={{ height: "100%" }}>
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
