// README screenshots: docs/screenshots/{ask,relay,team-meeting,build-my-twin}.png.
// Captured from the keyless demo (Lumen Labs, invented people), at 1440x900
// and 2x, dark theme, with the demo banner hidden. No dependencies: headless
// Chrome over the DevTools protocol with Node's built-in WebSocket.
//
//   npx employee001 demo --no-open --port 3141     # or: node bin/cli.mjs demo …
//   node scripts/screenshot.mjs [http://127.0.0.1:3141] [--gallery]
//
// --gallery: the Product Hunt gallery size, 1270x760 at 2x, written to
// docs/local/marketing/product-hunt/gallery/ instead of the README folder.
//
// CHROME_PATH overrides the browser (default: Google Chrome on macOS).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GALLERY = process.argv.includes("--gallery");
const BASE = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:3141").replace(/\/$/, "");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = GALLERY ? join(ROOT, "docs", "local", "marketing", "product-hunt", "gallery") : join(ROOT, "docs", "screenshots");
const [WIDTH, HEIGHT] = GALLERY ? [1270, 760] : [1440, 900];
mkdirSync(OUT, { recursive: true });
const PORT = 9341;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "e001-shots-"))}`,
  `--window-size=${WIDTH},${HEIGHT}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let info;
for (let i = 0; i < 50 && !info; i++) { try { info = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(200); } }
const page = info.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

const HIDE_BANNER = `for (const a of document.querySelectorAll("aside")) if (a.textContent.includes("no AI calls")) a.style.display = "none";`;
// The gallery shows the meeting from its question, once every twin has answered.
const SCROLL_MEETING_TOP = `for (const d of document.querySelectorAll("div")) if (d.scrollHeight > d.clientHeight + 50 && getComputedStyle(d).overflowY !== "visible") d.scrollTop = 0;`;
const setInput = (sel, value) => `{ const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); }`;

async function shot(name, path, actions, waitMs, after = "") {
  await send("Page.navigate", { url: BASE + path });
  await sleep(4000);
  if (actions) console.log(name, "action:", await evalJs(actions));
  await sleep(waitMs);
  await evalJs(HIDE_BANNER + after + " return 'ok';");
  await sleep(600);
  const { result } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
  console.log("saved", name);
}

const NOTES = "I run Customer Success: renewals, onboarding and the health score. I approve renewal discounts up to 10%; anything above goes to the CEO. A free month only with an annual renewal, never on monthly plans.\n\nThe question I get most: is this account at risk? Under 5 logins in 30 days plus 2 open tickets means red.\n\nHow I write: 'Quick one: Acme wants 15% off. I can do 10. Are you ok with 12 if they sign for two years?'";
await shot("ask", "/ask?twin=marcus-reed", `const nc=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="New conversation"); nc?.click(); await new Promise(r=>setTimeout(r,1500)); const b=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Is SSO ready")); b?.click(); return (nc?"new+":"")+(b ? "clicked" : "missing");`, 16000);
await shot("relay", "/ask?twin=theo-lindqvist", `const nc=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="New conversation"); nc?.click(); await new Promise(r=>setTimeout(r,1500)); const b=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Who approves a 20% discount")); b?.click(); return b ? "clicked" : "missing";`, 14000);
await shot("team-meeting", "/council", `const el=[...document.querySelectorAll("button, div, p")].filter(e=>e.textContent.trim().startsWith("Should Lumen Labs move")).pop(); el?.click(); return el ? "clicked" : "missing";`, GALLERY ? 90000 : 32000, GALLERY ? SCROLL_MEETING_TOP : "");
await shot("build-my-twin", "/build-my-twin", `${setInput("#self-name", "Maya Ortiz")} ${setInput("#self-role", "Head of Customer Success")} ${setInput("#notes", NOTES)} return "filled";`, 1500);

ws.close(); chrome.kill();
