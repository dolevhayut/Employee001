"use client";

import { useEffect } from "react";

export function ThemeInit() {
  useEffect(() => {
    const saved = localStorage.getItem("em001-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved === "dark" || saved === "light" ? saved : prefersDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

  return null;
}
