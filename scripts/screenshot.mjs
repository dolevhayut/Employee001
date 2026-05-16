// One-off script: capture README screenshots via Playwright.
// Run: node scripts/screenshot.mjs
// Requires: npx playwright install chromium

import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "docs", "screenshots");
const BASE = "http://localhost:3001";

const PAGES = [
  { path: "/welcome",   file: "01-welcome.png",   wait: 4000 },
  { path: "/employees", file: "02-employees.png",  wait: 2000 },
  { path: "/flow",      file: "03-flow.png",       wait: 2000 },
  { path: "/settings",  file: "04-settings.png",   wait: 2000 },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: "dark",
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

for (const { path, file, wait } of PAGES) {
  console.log(`→ ${path}`);
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: join(OUT, file), fullPage: false });
    console.log(`  ✓ saved ${file}`);
  } catch (err) {
    console.error(`  ✗ ${path}: ${err.message}`);
  }
}

await browser.close();
console.log("\nDone. Files in docs/screenshots/");
