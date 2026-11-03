// Browser smoke for the release gate: load pages in headless Chrome and fail
// on a client-side crash. The gate's "page smoke" step only checks the
// server's HTTP status, so a page that renders on the server and then throws
// in the browser passed three releases in a row (/profile, 0.11.0–0.13.0).
//
// No dependencies, same approach as scripts/screenshot.mjs: Chrome over the
// DevTools protocol with Node's built-in WebSocket. CHROME_PATH overrides the
// browser (default: Google Chrome on macOS, then chromium on PATH).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** What the app or Next shows when a page fails in the browser. */
export const CRASH_TEXT = [/application error: a client-side exception has occurred/i, /this page couldn.t load/i];

export function chromePath(env = process.env) {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  if (existsSync(MAC_CHROME)) return MAC_CHROME;
  return null;
}

/** Problems found on one page: it didn't load, uncaught exceptions, then
 *  crash text in the body. */
export function pageProblems({ exceptions, bodyText, href }) {
  // Chrome shows its own error page (chrome-error://) when nothing answers:
  // no app code runs there, so no exception and no crash text either.
  if (href && !/^https?:/.test(href)) return [`the page didn't load (${href.split("/")[0]})`];
  const problems = exceptions.map((e) => `uncaught: ${e}`);
  if (CRASH_TEXT.some((re) => re.test(bodyText ?? ""))) problems.push("the page shows an error screen");
  return problems;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Load each path and collect problems. Resolves with { path: problems[] } for
 * every path that had any; an empty object means every page loaded cleanly.
 */
export async function browserSmoke(baseUrl, paths, { chrome = chromePath(), settleMs = 4000, port = 9342 } = {}) {
  if (!chrome) throw new Error("no Chrome found: set CHROME_PATH to run the browser smoke");
  const profile = mkdtempSync(join(tmpdir(), "e001-smoke-"));
  const proc = spawn(chrome, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
    }
    const page = targets?.find((t) => t.type === "page");
    if (!page) throw new Error("Chrome started without a page target");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("could not connect to Chrome")), { once: true });
    });
    let id = 0;
    const pending = new Map();
    let exceptions = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        exceptions.push((d.exception?.description ?? d.text ?? "exception").split("\n")[0]);
      }
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Page.enable");
    await send("Runtime.enable");

    const failures = {};
    for (const path of paths) {
      exceptions = [];
      await send("Page.navigate", { url: baseUrl + path });
      await sleep(settleMs);
      const res = await send("Runtime.evaluate", { expression: "JSON.stringify({ href: location.href, text: document.body ? document.body.innerText : '' })", returnByValue: true });
      const page = JSON.parse(res.result?.result?.value ?? "{}");
      const problems = pageProblems({ exceptions, bodyText: page.text, href: page.href });
      if (problems.length) failures[path] = problems;
    }
    ws.close();
    return failures;
  } finally {
    // Chrome keeps writing its profile for a moment after the kill.
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await Promise.race([exited, sleep(3000)]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // a temp folder left behind is harmless
    }
  }
}
