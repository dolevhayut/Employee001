// Storage layer for CEO-authored custom task templates.
// Built-in templates live in src/lib/task-templates.ts and are immutable.
// Custom templates persist to data/custom-templates.json so they survive restarts.
//
// SERVER-ONLY — uses fs. Do not import from client components.

import fs from "fs";
import path from "path";
import type { TaskTemplate } from "./task-templates";

const FILE = path.join(process.cwd(), "data", "custom-templates.json");

export type CustomTemplate = TaskTemplate & {
  /** ISO timestamp when this template was first saved. */
  createdAt: string;
  /** ISO timestamp of the most recent edit. */
  updatedAt: string;
};

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(): CustomTemplate[] {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomTemplate[]) : [];
  } catch {
    return [];
  }
}

function writeAll(templates: CustomTemplate[]): void {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(templates, null, 2), "utf8");
}

let _counter = 0;
function makeId(name: string): string {
  // Slug-ish id. Append counter to avoid collision with built-ins.
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "custom";
  _counter++;
  return `custom-${slug}-${Date.now().toString(36)}-${_counter}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function listCustomTemplates(): CustomTemplate[] {
  return readAll();
}

export function getCustomTemplate(id: string): CustomTemplate | null {
  return readAll().find((t) => t.id === id) ?? null;
}

export type CustomTemplateInput = {
  name: string;
  description?: string;
  task: string;
  category?: string;
  appliesTo?: "all" | string[];
  requiresToolkits?: string[];
};

export function createCustomTemplate(
  input: CustomTemplateInput
): CustomTemplate {
  const now = new Date().toISOString();
  const tpl: CustomTemplate = {
    id: makeId(input.name),
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    task: input.task.trim(),
    category: input.category?.trim() || "Custom",
    appliesTo: input.appliesTo ?? "all",
    requiresToolkits: input.requiresToolkits ?? [],
    createdAt: now,
    updatedAt: now,
  };
  const all = readAll();
  all.unshift(tpl);
  writeAll(all);
  return tpl;
}

export function updateCustomTemplate(
  id: string,
  patch: Partial<CustomTemplateInput>
): CustomTemplate | null {
  const all = readAll();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const current = all[idx];
  const updated: CustomTemplate = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined
      ? { description: patch.description.trim() }
      : {}),
    ...(patch.task !== undefined ? { task: patch.task.trim() } : {}),
    ...(patch.category !== undefined
      ? { category: patch.category.trim() || "Custom" }
      : {}),
    ...(patch.appliesTo !== undefined ? { appliesTo: patch.appliesTo } : {}),
    ...(patch.requiresToolkits !== undefined
      ? { requiresToolkits: patch.requiresToolkits }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  all[idx] = updated;
  writeAll(all);
  return updated;
}

export function deleteCustomTemplate(id: string): boolean {
  const all = readAll();
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}
