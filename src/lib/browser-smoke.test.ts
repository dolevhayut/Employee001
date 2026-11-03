import { describe, expect, it } from "vitest";
import { chromePath, pageProblems } from "../../scripts/browser-smoke.mjs";

describe("browser smoke", () => {
  it("fails a page on an uncaught exception or an error screen, and passes a clean one", () => {
    expect(pageProblems({ exceptions: [], bodyText: "Dana Katz · Security Lead" })).toEqual([]);
    expect(pageProblems({ exceptions: ["TypeError: Cannot read properties of null (reading 'state')"], bodyText: "" })).toEqual([
      "uncaught: TypeError: Cannot read properties of null (reading 'state')",
    ]);
    expect(pageProblems({ exceptions: [], bodyText: "This page couldn’t load. Reload to try again, or go back." })).toEqual(["the page shows an error screen"]);
    expect(pageProblems({ exceptions: [], bodyText: "Application error: a client-side exception has occurred" })).toHaveLength(1);
  });

  it("fails a page that didn't load at all (Chrome's own error page)", () => {
    expect(pageProblems({ exceptions: [], bodyText: "This site can’t be reached", href: "chrome-error://chromewebdata/" })).toEqual([
      "the page didn't load (chrome-error:)",
    ]);
    expect(pageProblems({ exceptions: [], bodyText: "ok", href: "http://127.0.0.1:3001/ask" })).toEqual([]);
  });

  it("uses CHROME_PATH when it is set", () => {
    expect(chromePath({ CHROME_PATH: "/opt/chrome" } as unknown as NodeJS.ProcessEnv)).toBe("/opt/chrome");
  });
});
