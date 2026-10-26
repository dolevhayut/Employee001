import "server-only";

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { dataDir } from "./app-home";
import { appendAuditEntry } from "./audit-log";
import { MAX_KNOWLEDGE_FOLDERS } from "./knowledge-folder-shared";
import { withSidecarLock } from "./sidecar-lock";

export { MAX_KNOWLEDGE_FOLDERS };

export type KnowledgeFolder = { path: string; label: string; addedAt: string };

/** Who added or removed a folder, for the audit log: a session user id, or
 * nothing in no-accounts local mode. */
export type KnowledgeFolderActor = { userId?: string | null };

const MAX_LABEL_LENGTH = 120;
const EXAMPLE_FOLDER = "~/Documents/project";

function sidecarPath(employeeId: string): string {
  return dataDir("employees", employeeId, "employee.json");
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Names a twin never reads inside a configured folder: secrets, keys,
 * git internals and dependencies. */
const BLOCKED_NAME = /^(?:\.env[^/]*|\.dev\.vars|\.npmrc|\.netrc|\.pypirc|\.git|node_modules|id_(?:rsa|dsa|ecdsa|ed25519)[^/]*|credentials[^/]*|.*\.(?:pem|key|p12|pfx|keystore|jks))$/i;

/** A ripgrep glob that leaves out every name BLOCKED_NAME covers. A Grep
 * over a whole configured folder runs with it, so search covers the folder
 * without reading secrets, keys, git internals or dependencies. */
export const SECRET_EXCLUDE_GLOB =
  "!{**/.env*,**/.dev.vars,**/.npmrc,**/.netrc,**/.pypirc,**/.git/**,**/node_modules/**,**/id_rsa*,**/id_dsa*,**/id_ecdsa*,**/id_ed25519*,**/credentials*,**/*.pem,**/*.key,**/*.p12,**/*.pfx,**/*.keystore,**/*.jks}";

const BLOCKED_EXTENSIONS = new Set(["pem", "key", "p12", "pfx", "keystore", "jks", "env"]);

/** Is this Grep glob an extension filter ("*.ts", "**\/*.{ts,tsx}") that
 * can't match a blocked name? Those are kept as the twin wrote them. */
export function isSafeExtensionGlob(glob: string): boolean {
  const m = /^(?:\*\*\/)?\*\.(?:([A-Za-z0-9]+)|\{([A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)\})$/.exec(glob.trim());
  if (!m) return false;
  const exts = (m[1] ?? m[2]).split(",").map((e) => e.toLowerCase());
  return exts.every((e) => !BLOCKED_EXTENSIONS.has(e));
}

export function isBlockedFolderName(name: string): boolean {
  return BLOCKED_NAME.test(name);
}

export function hasBlockedFolderSegment(value: string): boolean {
  return value.split(/[\\/]/).some((part) => part !== "" && isBlockedFolderName(part));
}

const SENSITIVE_HOME_DIRS = [".ssh", ".claude", ".aws", ".config", ".gnupg", ".kube", ".docker", ".azure", ".gcloud"];

/** Why a folder can't be a knowledge source, or null when it can: root, the
 * home folder or anything above it, credential folders, and the app's own
 * data. A folder that merely contains the data dir (the repo in dev) is
 * allowed: reads that land in data/ keep the normal twin rules. Each reason
 * names the cause and one next step. */
function forbiddenReason(folder: string): string | null {
  const home = canonical(os.homedir());
  if (folder === path.parse(folder).root) {
    return `That is the top of the disk. Pick a subfolder such as ${EXAMPLE_FOLDER} instead.`;
  }
  if (folder === home) {
    return `Pick a subfolder such as ${EXAMPLE_FOLDER}, not your whole home folder.`;
  }
  if (isInside(home, folder)) {
    return `That folder contains your whole home folder. Pick a subfolder such as ${EXAMPLE_FOLDER} instead.`;
  }
  for (const dir of SENSITIVE_HOME_DIRS) {
    if (isInside(folder, canonical(path.join(home, dir)))) {
      return `~/${dir} holds keys and app settings, so twins can't read it. Pick a folder with work documents instead.`;
    }
  }
  if (isInside(folder, canonical(dataDir()))) {
    return "That is Employee001's own data folder. Pick a folder outside it, or upload the files on the twin's Files tab instead.";
  }
  return null;
}

function forbiddenPath(folder: string): boolean {
  return forbiddenReason(folder) !== null;
}

/** Accepts "~/x" as shorthand for the home folder. The expanded path still
 * goes through every check. */
function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** The folder's own name, used when no label is given. */
function defaultLabel(rawPath: string, resolved: string): string {
  const name = path.basename(rawPath) || path.basename(resolved) || resolved;
  return name.slice(0, MAX_LABEL_LENGTH);
}

const NOT_FOUND = "That folder doesn't exist or this app can't open it. Check the path for typos, or pick a folder your user account can read.";

export function validateKnowledgeFolder(input: { path?: unknown; label?: unknown }):
  | { ok: true; folder: KnowledgeFolder }
  | { ok: false; error: string } {
  const rawPath = expandHome(typeof input.path === "string" ? input.path.trim() : "");
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!rawPath) return { ok: false, error: `Enter the folder's full path, such as ${EXAMPLE_FOLDER}.` };
  if (!path.isAbsolute(rawPath)) {
    return { ok: false, error: `"${rawPath}" is a relative path. Enter the folder's full path, such as ${EXAMPLE_FOLDER}.` };
  }
  if (label.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `The label is ${label.length} characters long. Shorten it to ${MAX_LABEL_LENGTH} or fewer, or leave it empty to use the folder's name.` };
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(rawPath);
  } catch {
    return { ok: false, error: NOT_FOUND };
  }
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return { ok: false, error: "That path is a file, not a folder. Enter the folder that contains it instead." };
    }
  } catch {
    return { ok: false, error: NOT_FOUND };
  }
  const reason = forbiddenReason(resolved);
  if (reason) return { ok: false, error: reason };
  return { ok: true, folder: { path: resolved, label: label || defaultLabel(rawPath, resolved), addedAt: new Date().toISOString() } };
}

function foldersFrom(value: unknown): KnowledgeFolder[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.label !== "string" || typeof record.addedAt !== "string") return [];
    let resolved: string;
    try {
      resolved = fs.realpathSync(record.path);
      if (!fs.statSync(resolved).isDirectory() || forbiddenPath(resolved)) return [];
    } catch {
      return [];
    }
    return [{ path: resolved, label: record.label, addedAt: record.addedAt }];
  });
}

export function listKnowledgeFolders(employeeId: string): KnowledgeFolder[] {
  try {
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath(employeeId), "utf8")) as { knowledgeFolders?: unknown };
    return foldersFrom(sidecar.knowledgeFolders);
  } catch {
    return [];
  }
}

/** Writes the folder list and returns the twin's display name for the audit row. */
async function writeFolders(employeeId: string, folders: KnowledgeFolder[]): Promise<string> {
  const file = sidecarPath(employeeId);
  const sidecar = JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, unknown>;
  sidecar.knowledgeFolders = folders;
  await fsp.writeFile(file, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  return typeof sidecar.name === "string" && sidecar.name.trim() ? sidecar.name : employeeId;
}

/** Adding or removing a folder changes what the twin can read and send to the
 * model provider, so each change lands in the hash-chained audit log. */
function auditFolderChange(
  employeeId: string,
  employeeName: string,
  action: "add" | "remove",
  folder: KnowledgeFolder,
  actor: KnowledgeFolderActor,
): void {
  const toolName = action === "add" ? "knowledgeFolder.add" : "knowledgeFolder.remove";
  appendAuditEntry({
    runId: `knowledge-folder-${Date.now()}`,
    employeeId,
    employeeName,
    toolName,
    bareName: toolName,
    input: { employeeId, path: folder.path, label: folder.label },
    verdict: "executed",
    approvalChannel: "ui",
    ...(actor.userId ? { requesterId: actor.userId } : {}),
  });
}

export async function addKnowledgeFolder(
  employeeId: string,
  input: { path?: unknown; label?: unknown },
  actor: KnowledgeFolderActor = {},
): Promise<{ folder?: KnowledgeFolder; error?: string }> {
  const result = validateKnowledgeFolder(input);
  if (!result.ok) return { error: result.error };
  return withSidecarLock(employeeId, async () => {
    if (!fs.existsSync(sidecarPath(employeeId))) {
      return { error: "That twin wasn't found. Reload the page and open the twin again." };
    }
    const folders = listKnowledgeFolders(employeeId);
    if (folders.some((folder) => folder.path === result.folder.path)) {
      return { error: "That folder is already added to this twin. Pick a different folder, or remove it first to add it again with a new label." };
    }
    if (folders.length >= MAX_KNOWLEDGE_FOLDERS) {
      return { error: `A twin can have at most ${MAX_KNOWLEDGE_FOLDERS} folders. Remove one before adding another.` };
    }
    const employeeName = await writeFolders(employeeId, [...folders, result.folder]);
    auditFolderChange(employeeId, employeeName, "add", result.folder, actor);
    return { folder: result.folder };
  });
}

export async function removeKnowledgeFolder(
  employeeId: string,
  folderPath: string,
  actor: KnowledgeFolderActor = {},
): Promise<boolean> {
  return withSidecarLock(employeeId, async () => {
    const folders = listKnowledgeFolders(employeeId);
    const removed = folders.find((folder) => folder.path === folderPath);
    if (!removed) return false;
    const employeeName = await writeFolders(employeeId, folders.filter((folder) => folder !== removed));
    auditFolderChange(employeeId, employeeName, "remove", removed, actor);
    return true;
  });
}

export function knowledgeFoldersIndexMarkdown(employeeId: string): string {
  const lines: string[] = [];
  for (const folder of listKnowledgeFolders(employeeId)) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(folder.path).filter((name) => !isBlockedFolderName(name)).sort().slice(0, 40); } catch { /* unavailable folders stay visible */ }
    lines.push(`- **${folder.label}** — \`${folder.path}\`${entries.length ? `\n  Top level: ${entries.map((entry) => `\`${entry}\``).join(", ")}` : "\n  Top level: (unavailable or empty)"}`);
  }
  return lines.join("\n");
}
