import fs from "fs";
import path from "path";

const DATA_ROOT = path.join(process.cwd(), "data", "employees");

const CAPS = {
  context: 20,
  decisions: 100,
  learnings: 200,
} as const;

function shiftDir(employeeId: string): string {
  return path.join(DATA_ROOT, employeeId, ".shift");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function logPath(employeeId: string, file: "context" | "decisions" | "learnings"): string {
  return path.join(shiftDir(employeeId), `${file}.md`);
}

/** Split a markdown file into individual entries separated by `---`. */
function splitEntries(content: string): string[] {
  return content
    .split(/\n---\n/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/** Join entries back with HR separators. */
function joinEntries(entries: string[]): string {
  return entries.join("\n\n---\n\n") + (entries.length > 0 ? "\n" : "");
}

function prependEntry(employeeId: string, file: "context" | "decisions" | "learnings", entry: string, cap: number): void {
  const dir = shiftDir(employeeId);
  ensureDir(dir);
  const filePath = logPath(employeeId, file);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const entries = splitEntries(existing);
  entries.unshift(entry);
  const capped = entries.slice(0, cap);
  fs.writeFileSync(filePath, joinEntries(capped), "utf8");
}

function ts(): string {
  return new Date().toISOString();
}

export function appendContext(employeeId: string, entry: string, runId: string): void {
  const block = `**[${ts()}]** run=${runId}\n\n${entry}`;
  prependEntry(employeeId, "context", block, CAPS.context);
}

export function appendDecision(
  employeeId: string,
  entry: { text: string; rationale?: string },
  runId: string
): void {
  const body = entry.rationale ? `${entry.text}\n\n_Rationale: ${entry.rationale}_` : entry.text;
  const block = `**[${ts()}]** run=${runId}\n\n${body}`;
  prependEntry(employeeId, "decisions", block, CAPS.decisions);
}

export function appendLearning(employeeId: string, entry: string, runId: string): void {
  const block = `**[${ts()}]** run=${runId}\n\n${entry}`;
  prependEntry(employeeId, "learnings", block, CAPS.learnings);
}

export function readShiftLog(employeeId: string): {
  context: string;
  decisions: string;
  learnings: string;
} {
  function read(file: "context" | "decisions" | "learnings"): string {
    const p = logPath(employeeId, file);
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8").trim();
  }
  return {
    context: read("context"),
    decisions: read("decisions"),
    learnings: read("learnings"),
  };
}
