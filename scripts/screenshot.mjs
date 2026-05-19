// One-off script: capture Employee001 screenshots via Playwright.
// Run: node scripts/screenshot.mjs
// Requires: npx playwright install chromium
//
// Two output sets:
//
//   docs/screenshots/         — the 4 PNGs the public README references.
//                               Names locked: 01-welcome, 02-employees,
//                               03-flow, 04-settings.
//   docs/local/screenshots/   — the expanded gallery for demos and Show HN
//                               (gitignored, internal). Adds profile,
//                               marketplace, council, cockpit, routines,
//                               audit, inbox, and per-twin variants.

import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const README_OUT = join(HERE, "..", "docs", "screenshots");
const DEMO_OUT = join(HERE, "..", "docs", "local", "screenshots");
const BASE = "http://localhost:3001";

// The /flow page ignores ?employee= and picks readyEmployees[0] (sorted by
// lastActiveAt). To screenshot a specific twin we have to click their chip
// in the EmployeePickerBar after the page loads. selectTwin() does that
// — chips render `<first-name>` text, so a text locator is enough.
function selectTwin(firstName) {
  return async (page) => {
    // The picker bar at top has one button per ready twin. Click the one
    // whose visible label matches the first name.
    try {
      await page.getByRole("button", { name: new RegExp(`^${firstName}$`, "i") }).first().click({ timeout: 4000 });
    } catch {
      // Fall back to a text selector if accessibility role isn't found.
      await page.locator(`button:has-text("${firstName}")`).first().click({ timeout: 4000 }).catch(() => {});
    }
    // Wait for the chat pane to reload that twin's history.
    await page.waitForTimeout(1500);
  };
}

// Pages that ship in the public README — overwrite these on every run.
const README_PAGES = [
  { path: "/welcome", file: "01-welcome.png", wait: 4000 },
  { path: "/employees", file: "02-employees.png", wait: 2500 },
  { path: "/flow", file: "03-flow.png", wait: 3000, after: selectTwin("Maya") },
  { path: "/settings", file: "04-settings.png", wait: 2500 },
];

// Expanded gallery for /docs/local/screenshots/. Each entry can optionally
// run a Playwright action before the shot (e.g. click a tab).
const DEMO_PAGES = [
  { path: "/welcome", file: "01-welcome.png", wait: 4000 },
  { path: "/launchpad", file: "02-launchpad.png", wait: 2500 },
  { path: "/employees", file: "03-employees-roster.png", wait: 2500 },
  { path: "/marketplace", file: "04-marketplace.png", wait: 2500 },

  // Twin chat — one per persona so the README gallery can show variety.
  { path: "/flow", file: "05-flow-maya.png", wait: 3000, after: selectTwin("Maya") },
  { path: "/flow", file: "06-flow-daniel.png", wait: 3000, after: selectTwin("Daniel") },
  { path: "/flow", file: "07-flow-yael.png", wait: 3000, after: selectTwin("Yael") },
  { path: "/flow", file: "08-flow-tom.png", wait: 3000, after: selectTwin("Tom") },

  // Profile — Overview tab + Files tab (click after load).
  {
    path: "/profile?employee=maya-chen",
    file: "09-profile-overview.png",
    wait: 3000,
    after: async (page) => {
      // Scroll until the Authoritative domains section is in view. The
      // page uses multiple `.scrollbar` containers, so a targeted
      // scrollIntoView is more reliable than scrollBy.
      try {
        await page.locator("text=Authoritative domains").first().scrollIntoViewIfNeeded({ timeout: 3000 });
      } catch {
        // Fallback: scroll all scrollable containers.
        await page.evaluate(() => {
          document.querySelectorAll(".scrollbar").forEach((el) => el.scrollBy(0, 900));
        });
      }
      await page.waitForTimeout(800);
    },
  },
  {
    path: "/profile?employee=maya-chen",
    file: "10-profile-files.png",
    wait: 2500,
    after: async (page) => {
      // Files tab button — text-based locator.
      try {
        await page.getByRole("button", { name: /^Files$/i }).first().click({ timeout: 3000 });
        await page.waitForTimeout(1500);
      } catch {
        // Fallback — locate by text only.
        try { await page.locator("button:has-text('Files')").first().click({ timeout: 3000 }); } catch {}
        await page.waitForTimeout(1500);
      }
    },
  },

  // Operational pages.
  { path: "/cockpit", file: "11-cockpit.png", wait: 2500 },
  { path: "/routines", file: "12-routines.png", wait: 2500 },
  { path: "/audit", file: "13-audit.png", wait: 2500 },
  { path: "/inbox", file: "14-inbox.png", wait: 2500 },
  { path: "/council", file: "15-council.png", wait: 2500 },
  { path: "/settings", file: "16-settings.png", wait: 2500 },
];

async function capture(set, outDir, label) {
  await mkdir(outDir, { recursive: true });
  console.log(`\n=== ${label} → ${outDir.replace(process.cwd() + "/", "")}/ ===`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // Force light theme — the brand reads better there for marketing assets.
    colorScheme: "light",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  let okCount = 0;
  let failCount = 0;

  for (const entry of set) {
    const { path: urlPath, file, wait, after } = entry;
    process.stdout.write(`  → ${urlPath.padEnd(46)} `);
    try {
      await page.goto(`${BASE}${urlPath}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(wait);
      if (after) await after(page);
      await page.screenshot({ path: join(outDir, file), fullPage: false });
      process.stdout.write(`✓ ${file}\n`);
      okCount += 1;
    } catch (err) {
      process.stdout.write(`✗ ${err.message}\n`);
      failCount += 1;
    }
  }

  await browser.close();
  console.log(`  ${okCount} ok · ${failCount} failed`);
}

await capture(README_PAGES, README_OUT, "README screenshots");
await capture(DEMO_PAGES, DEMO_OUT, "Demo gallery");
console.log("\nDone.");
