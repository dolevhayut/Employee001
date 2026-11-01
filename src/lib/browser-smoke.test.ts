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

  it("uses CHROME_PATH when it is set", () => {
    expect(chromePath({ CHROME_PATH: "/opt/chrome" } as unknown as NodeJS.ProcessEnv)).toBe("/opt/chrome");
  });
});
