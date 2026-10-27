// What a chat/meeting twin may read from the data root with Read/Glob/Grep.
//
// The twin's cwd is data/ so it can reach its own profile, peer profiles and
// the company brain. Everything else under data/ (other twins' memory and chat
// history, invites, audit log, settings, relay transcripts, run logs) is
// need-to-know and must stay out of reach: a prompt-injected twin (say, from an
// email it was asked to handle) could otherwise read it and pass it on.
//
// Allowed:
//   employees/<self>/**                  own profile, knowledge, scratch notes
//   employees/<peer>/<PROFILE>.md        a colleague's 9 profile files only
//   org-brain/**, org-skills/**          company knowledge and playbooks
//   scratch/<self>/**                    own scratch notes
// Glob may also list names under employees/ (file names, not content).
// Grep over employees/ is allowed only with a glob naming profile files one
// level down ("*/EXPERTISE.md", "*/{CONTEXT.md,PEOPLE.md}"): ripgrep anchors a
// glob containing "/" and its "*" doesn't cross "/", so scratch/ and
// knowledge/ notes inside a colleague's folder stay out.

import path from "path";
import fs from "fs";
import { dataDir } from "./app-home";
import { SECRET_EXCLUDE_GLOB, hasBlockedFolderSegment, isSafeExtensionGlob, listKnowledgeFolders } from "./knowledge-folders";

export const PEER_PROFILE_FILES = new Set([
  "CONTEXT.md",
  "EXPERTISE.md",
  "PROJECTS.md",
  "PEOPLE.md",
  "DECISIONS.md",
  "PREFERENCES.md",
  "TONE.md",
  "BOUNDARIES.md",
  "EMPLOYMENT.md",
]);

const SHARED_ROOTS = ["org-brain", "org-skills"];

/** Data-root paths no twin reads, whatever else the rules say: every twin's
 *  memory, sign-in state, invite tokens and stored secrets. A trailing "/"
 *  marks a directory. The hook below already refuses them (they are outside
 *  the allowlist); sdk-defaults.ts also passes them to Claude Code as native
 *  deny rules, so they stay refused if this hook regresses. */
export const TWIN_DENIED_DATA_PATHS: readonly string[] = [
  "memory/",
  "auth/",
  "invites.json",
  "org/custom-mcp.json",
  "telegram-approval-secret",
  ".audit-pseudonym-key",
];

/** Is this data-relative path one of TWIN_DENIED_DATA_PATHS or inside one? */
export function isDeniedDataPath(rel: string): boolean {
  return TWIN_DENIED_DATA_PATHS.some((entry) =>
    entry.endsWith("/") ? underRoot(rel, entry.slice(0, -1)) : rel === entry,
  );
}

/** ok may carry a rewritten tool input (a Grep over a folder runs with the
 *  secret-excluding glob). */
export type ReadScopeDecision = { ok: true; updatedInput?: Record<string, unknown> } | { ok: false; reason: string };

/** Data-root-relative POSIX path, or null if it points outside the data root.
 *  Relative paths resolve against the agent's cwd (the data root by default). */
export function toDataRelative(rawPath: string, dataRoot: string, cwd: string = dataRoot): string | null {
  const cleaned = rawPath.replace(/\\/g, "/").trim();
  const abs = path.resolve(cwd, cleaned || ".");
  const rel = path.relative(dataRoot, abs).split(path.sep).join("/");
  if (rel === "") return "";
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

function underRoot(rel: string, root: string): boolean {
  return rel === root || rel.startsWith(`${root}/`);
}

function realPath(value: string): string | null {
  try { return fs.realpathSync(value); } catch { return null; }
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Own configured folders are deliberately checked from the sidecar here,
 * rather than accepted from a caller, so one twin cannot name another's. */
function configuredFolderDecision(rawPath: string, employeeId: string, cwd: string, toolName: string, input?: Record<string, unknown>): ReadScopeDecision | null {
  const resolved = realPath(path.resolve(cwd, rawPath || "."));
  if (!resolved) return null;
  // The app's data dir keeps the normal twin rules, even inside a folder.
  const data = realPath(dataDir());
  if (data && isWithin(resolved, data)) return null;
  const folder = listKnowledgeFolders(employeeId).find((entry) => {
    const configured = realPath(entry.path);
    return configured !== null && isWithin(resolved, configured);
  });
  if (!folder) return null;
  const relative = path.relative(folder.path, resolved);
  if (hasBlockedFolderSegment(relative)) return { ok: false, reason: `${toolName} cannot access sensitive files in configured folders.` };
  try {
    const stat = fs.statSync(resolved);
    if (stat.isFile() && stat.size > 1024 * 1024) return { ok: false, reason: `${toolName} cannot access files larger than 1 MB.` };
    // Grep reads file contents recursively, so over a directory it would
    // search .env and key files too. Allow it only with a glob that can't
    // match them: the twin's own extension filter, or the exclusion glob.
    if (toolName === "Grep" && stat.isDirectory()) {
      const glob = typeof input?.glob === "string" ? input.glob : "";
      if (glob && !isSafeExtensionGlob(glob)) {
        return { ok: false, reason: 'Inside a configured folder, Grep a directory with no glob or an extension glob such as "*.ts" or "**/*.{ts,tsx}".' };
      }
      return glob ? { ok: true } : { ok: true, updatedInput: { ...(input ?? {}), glob: SECRET_EXCLUDE_GLOB } };
    }
  } catch { return { ok: false, reason: `${toolName} could not verify this configured-folder path.` }; }
  return { ok: true };
}

/** May the twin read file contents at this data-relative path? */
export function canReadPath(rel: string, employeeId: string): boolean {
  if (isDeniedDataPath(rel)) return false;
  if (SHARED_ROOTS.some((root) => underRoot(rel, root))) return true;
  if (underRoot(rel, `employees/${employeeId}`)) return true;
  if (underRoot(rel, `scratch/${employeeId}`)) return true;
  const parts = rel.split("/");
  return parts.length === 3 && parts[0] === "employees" && PEER_PROFILE_FILES.has(parts[2]);
}

function deny(tool: string, rawPath: string, employeeId: string): ReadScopeDecision {
  return {
    ok: false,
    reason:
      `${tool} is limited to your own folder (employees/${employeeId}/), colleagues' profile .md files, ` +
      `org-brain/ and org-skills/. "${rawPath || "(data root)"}" is outside that scope.`,
  };
}

/** The configured-folder rules on their own, for runs that otherwise read
 * freely (the twin builder): secret names, git internals and dependencies are
 * denied everywhere, and inside a folder Grep works one file at a time. */
export function checkConfiguredFolderRead(
  toolName: string,
  input: Record<string, unknown> | undefined,
  employeeId: string,
  cwd: string,
): ReadScopeDecision {
  const str = (key: string) => (typeof input?.[key] === "string" ? (input[key] as string) : "");
  const raw = toolName === "Read" ? str("file_path") : str("path");
  const extra = toolName === "Glob" ? str("pattern") : toolName === "Grep" ? str("glob") : "";
  if (hasBlockedFolderSegment(raw) || hasBlockedFolderSegment(extra)) {
    return { ok: false, reason: `${toolName} cannot access secrets, git internals or dependencies.` };
  }
  // A path that sits inside a configured folder but resolves outside it is a
  // symlink leading out: chat runs fall back to the normal twin rules there,
  // but this check is the builder's only one, so refuse it here.
  const absolute = path.resolve(cwd, raw || ".");
  // Canonicalize the parent only, so /var vs /private/var still compares,
  // while the last segment (the possible link) is kept as written.
  const parent = realPath(path.dirname(absolute));
  const lexical = parent ? path.join(parent, path.basename(absolute)) : absolute;
  const resolved = realPath(absolute);
  for (const folder of listKnowledgeFolders(employeeId)) {
    const configured = realPath(folder.path) ?? folder.path;
    const viaFolder = [absolute, lexical].some((p) => isWithin(p, folder.path) || isWithin(p, configured));
    if (viaFolder && resolved && !isWithin(resolved, configured)) {
      return { ok: false, reason: `${toolName} cannot follow a link out of a configured folder.` };
    }
  }
  return configuredFolderDecision(raw, employeeId, cwd, toolName, input) ?? { ok: true };
}

export function checkTwinRead(
  toolName: string,
  input: Record<string, unknown> | undefined,
  employeeId: string,
  dataRoot: string,
  cwd: string = dataRoot,
): ReadScopeDecision {
  const relOf = (raw: string) => toDataRelative(raw, dataRoot, cwd);
  const str = (key: string) => (typeof input?.[key] === "string" ? (input[key] as string) : "");

  if (toolName === "Read") {
    const raw = str("file_path");
    if (hasBlockedFolderSegment(raw)) return deny("Read", raw, employeeId);
    const folderDecision = configuredFolderDecision(raw, employeeId, cwd, "Read");
    if (folderDecision) return folderDecision;
    const rel = relOf(raw);
    return rel !== null && rel !== "" && canReadPath(rel, employeeId)
      ? { ok: true }
      : deny("Read", raw, employeeId);
  }

  if (toolName === "Glob") {
    const raw = str("path");
    const pattern = str("pattern");
    // A pattern that climbs out (../) or is absolute is judged on its own.
    if (pattern.includes("..") || path.isAbsolute(pattern) || hasBlockedFolderSegment(pattern)) return deny("Glob", pattern, employeeId);
    const folderDecision = configuredFolderDecision(raw, employeeId, cwd, "Glob");
    if (folderDecision) return folderDecision;
    const rel = relOf(raw);
    if (rel === null) return deny("Glob", raw, employeeId);
    // Glob returns names only, so listing peers under employees/ is fine.
    const base = rel === "" ? firstSegment(pattern) : rel;
    if (base === "employees" || underRoot(base, "employees")) return { ok: true };
    return canReadPath(base, employeeId) ? { ok: true } : deny("Glob", raw || pattern, employeeId);
  }

  if (toolName === "Grep") {
    const raw = str("path");
    if (hasBlockedFolderSegment(str("glob"))) return deny("Grep", str("glob"), employeeId);
    const folderDecision = configuredFolderDecision(raw, employeeId, cwd, "Grep", input);
    if (folderDecision) return folderDecision;
    const rel = relOf(raw);
    if (rel === null || rel === "") return deny("Grep", raw, employeeId);
    if (canReadPath(rel, employeeId)) return { ok: true };
    // Searching across colleagues' profiles: only markdown files.
    if (rel === "employees" && isPeerProfileGlob(str("glob"))) return { ok: true };
    return deny("Grep", raw, employeeId);
  }

  return { ok: true };
}

function firstSegment(pattern: string): string {
  return pattern.replace(/^\.\//, "").split("/")[0] ?? "";
}

function isPeerProfileGlob(glob: string): boolean {
  const m = /^\*\/(?:\{([^{}]+)\}|([^/{},*?[\]]+))$/.exec(glob);
  if (!m) return false;
  const names = m[1] ? m[1].split(",") : [m[2]];
  return names.every((n) => PEER_PROFILE_FILES.has(n.trim()));
}
