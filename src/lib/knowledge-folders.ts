import "server-only";

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { appHome, dataDir } from "./app-home";
import { withSidecarLock } from "./sidecar-lock";

export type KnowledgeFolder = { path: string; label: string; addedAt: string };

const MAX_KNOWLEDGE_FOLDERS = 5;

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

function forbiddenPath(folder: string): boolean {
  const home = canonical(os.homedir());
  const install = canonical(appHome());
  const data = canonical(dataDir());
  const forbidden = [
    path.parse(folder).root,
    home,
    path.join(home, ".ssh"),
    path.join(home, ".claude"),
    path.join(home, ".aws"),
    path.join(home, ".config"),
    install,
    data,
  ].map(canonical);
  return folder === path.parse(folder).root || forbidden.slice(1).some((p) => isInside(folder, p));
}

export function validateKnowledgeFolder(input: { path?: unknown; label?: unknown }):
  | { ok: true; folder: KnowledgeFolder }
  | { ok: false; error: string } {
  const rawPath = typeof input.path === "string" ? input.path.trim() : "";
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!rawPath || !path.isAbsolute(rawPath)) return { ok: false, error: "Folder path must be absolute." };
  if (!label || label.length > 120) return { ok: false, error: "Folder label is required and must be 120 characters or fewer." };
  let resolved: string;
  try {
    resolved = fs.realpathSync(rawPath);
    if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: "Folder path must point to a directory." };
  } catch {
    return { ok: false, error: "Folder path does not exist or is not accessible." };
  }
  if (forbiddenPath(resolved)) return { ok: false, error: "That folder is not allowed as a knowledge source." };
  return { ok: true, folder: { path: resolved, label, addedAt: new Date().toISOString() } };
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

async function writeFolders(employeeId: string, folders: KnowledgeFolder[]): Promise<void> {
  const file = sidecarPath(employeeId);
  const sidecar = JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, unknown>;
  sidecar.knowledgeFolders = folders;
  await fsp.writeFile(file, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
}

export async function addKnowledgeFolder(employeeId: string, input: { path?: unknown; label?: unknown }): Promise<{ folder?: KnowledgeFolder; error?: string }> {
  const result = validateKnowledgeFolder(input);
  if (!result.ok) return { error: result.error };
  return withSidecarLock(employeeId, async () => {
    const folders = listKnowledgeFolders(employeeId);
    if (folders.length >= MAX_KNOWLEDGE_FOLDERS) return { error: `A twin can have at most ${MAX_KNOWLEDGE_FOLDERS} folders.` };
    if (folders.some((folder) => folder.path === result.folder.path)) return { error: "That folder is already configured." };
    await writeFolders(employeeId, [...folders, result.folder]);
    return { folder: result.folder };
  });
}

export async function removeKnowledgeFolder(employeeId: string, folderPath: string): Promise<boolean> {
  return withSidecarLock(employeeId, async () => {
    const folders = listKnowledgeFolders(employeeId);
    const next = folders.filter((folder) => folder.path !== folderPath);
    if (next.length === folders.length) return false;
    await writeFolders(employeeId, next);
    return true;
  });
}

export function knowledgeFoldersIndexMarkdown(employeeId: string): string {
  const lines: string[] = [];
  for (const folder of listKnowledgeFolders(employeeId)) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(folder.path).sort().slice(0, 40); } catch { /* unavailable folders stay visible */ }
    lines.push(`- **${folder.label}** — \`${folder.path}\`${entries.length ? `\n  Top level: ${entries.map((entry) => `\`${entry}\``).join(", ")}` : "\n  Top level: (unavailable or empty)"}`);
  }
  return lines.join("\n");
}
