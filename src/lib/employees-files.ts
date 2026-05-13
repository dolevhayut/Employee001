import fs from "fs";
import path from "path";
import { snapshotFile } from "./twin-versions";
import type { TwinFileName } from "./twin-builder-types";

const EMPLOYEES_DATA_DIR = path.join(process.cwd(), "data", "employees");

const PROFILE_FILE_NAMES = [
  "EXPERTISE.md",
  "TONE.md",
  "CONTEXT.md",
  "DECISIONS.md",
  "PREFERENCES.md",
  "PEOPLE.md",
  "PROJECTS.md",
  "BOUNDARIES.md",
  "EMPLOYMENT.md",
] as const;

export type ProfileFileName = (typeof PROFILE_FILE_NAMES)[number];

/** Read one markdown file for an employee. Returns empty string if not found. */
export function readEmployeeFile(employeeId: string, filename: string): string {
  const filePath = path.join(EMPLOYEES_DATA_DIR, employeeId, filename);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Read all 8 profile files for an employee, keyed by filename. */
export function readAllEmployeeFiles(
  employeeId: string
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of PROFILE_FILE_NAMES) {
    const content = readEmployeeFile(employeeId, name);
    if (content) {
      result[name] = content;
    }
  }
  return result;
}

/**
 * Write the body of a profile file, preserving the existing frontmatter block
 * if one is present. The frontmatter is left untouched — only the markdown body
 * after the second `---` is replaced. If the file has no frontmatter, the
 * entire file is replaced with `body`.
 *
 * Returns the new full file contents (frontmatter + body) on success, or null
 * if the employee directory or filename is invalid.
 */
export function writeEmployeeFileBody(
  employeeId: string,
  filename: string,
  body: string
): string | null {
  // Hard-allowlist filenames so a query param can't traverse directories.
  if (!(PROFILE_FILE_NAMES as readonly string[]).includes(filename)) return null;

  const dir = path.join(EMPLOYEES_DATA_DIR, employeeId);
  if (!fs.existsSync(dir)) return null;

  const filePath = path.join(dir, filename);
  let prevRaw = "";
  try {
    prevRaw = fs.readFileSync(filePath, "utf-8");
  } catch {
    /* new file */
  }

  // Preserve frontmatter if present
  const fmRe = /^---\s*\n[\s\S]*?\n---\s*\n/;
  const fmMatch = prevRaw.match(fmRe);
  const frontmatter = fmMatch ? fmMatch[0] : "";
  const next = frontmatter + body.replace(/^\n+/, "").replace(/\s+$/, "") + "\n";

  // Snapshot the *prior* body before overwriting so the user can undo this
  // edit later. The new body is just the live root state — no point storing
  // a copy of it. Best-effort: never block the write itself.
  if (prevRaw) {
    try {
      snapshotFile(employeeId, filename as TwinFileName, prevRaw, "manual");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[twin-versions] manual-edit snapshot skipped: ${message}`);
    }
  }

  fs.writeFileSync(filePath, next, "utf-8");

  return next;
}

/** Check whether real profile files exist on disk for an employee. */
export function hasEmployeeFiles(employeeId: string): boolean {
  const dir = path.join(EMPLOYEES_DATA_DIR, employeeId);
  try {
    return (
      fs.existsSync(dir) &&
      fs.readdirSync(dir).some((f) => f.endsWith(".md"))
    );
  } catch {
    return false;
  }
}
