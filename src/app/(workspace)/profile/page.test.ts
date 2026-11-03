import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Deleting a twin or revoking its consent on /profile removes it from disk,
// but the Shell keeps its roster across client-side navigation. Each handler
// must refetch the shared roster before leaving, or the sidebar and pickers
// keep showing the deleted twin until a reload. The page is a large client
// component, so this guard reads its source instead of rendering it.

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "page.tsx"), "utf8");

/** The body of `async function <name>()` up to its closing brace at 2-space indent. */
function handlerBody(name: string): string {
  const start = PAGE.indexOf(`async function ${name}(`);
  expect(start, `${name} not found in profile/page.tsx`).toBeGreaterThan(-1);
  const end = PAGE.indexOf("\n  }\n", start);
  expect(end).toBeGreaterThan(start);
  return PAGE.slice(start, end);
}

describe("profile page roster refresh", () => {
  it.each(["deleteTwin", "revokeConsent"])("%s refetches the roster before navigating away", (name) => {
    const body = handlerBody(name);
    expect(body).toContain('method: "DELETE"');
    const refresh = body.indexOf("refreshRoster();");
    const leave = body.indexOf('router.push("/employees")');
    expect(refresh).toBeGreaterThan(-1);
    expect(leave).toBeGreaterThan(refresh);
  });
});
