import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guard against a regression that shipped twice: a diagnostic logger that
// wrote CEO questions and twin prompts to data/council-debug.log with no
// retention and no purge path. Debug output belongs on the console.

const SRC = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(abs));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** Files allowed to name the legacy debug log: the code that deletes it. */
const LEGACY_CLEANUP = new Set(["lib/employee-purge.ts", "lib/legacy-cleanup.ts"]);

describe("no debug logs on disk", () => {
  const files = sourceFiles(SRC).map((abs) => ({ rel: path.relative(SRC, abs), text: fs.readFileSync(abs, "utf8") }));

  it("never writes a *debug* file", () => {
    const writer = /(?:appendFile|writeFile|createWriteStream|appendFileSync|writeFileSync)\s*\([^;]*debug/i;
    const offenders = files.filter((f) => writer.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("never points a data path at a debug log", () => {
    const debugPath = /dataDir\([^)]*debug/i;
    const offenders = files.filter((f) => !LEGACY_CLEANUP.has(f.rel) && debugPath.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("names council-debug.log only in the code that removes it", () => {
    const offenders = files
      .filter((f) => !LEGACY_CLEANUP.has(f.rel))
      .filter((f) => /council-debug\.log/.test(f.text.replace(/\/\/.*$/gm, "")))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
