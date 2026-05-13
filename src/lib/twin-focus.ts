import fs from "fs";
import path from "path";

const DATA_ROOT = path.join(process.cwd(), "data", "employees");

export type FocusPrefetch = {
  label: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  maxItems?: number;
  cacheTtlMs?: number;
};

export type FocusConfig = {
  prefetches: FocusPrefetch[];
};

function focusFile(employeeId: string): string {
  return path.join(DATA_ROOT, employeeId, ".shift", "focus.json");
}

function ensureDir(p: string): void {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getFocusConfig(employeeId: string): FocusConfig {
  const fp = focusFile(employeeId);
  if (!fs.existsSync(fp)) return { prefetches: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as Partial<FocusConfig>;
    return { prefetches: Array.isArray(parsed.prefetches) ? parsed.prefetches : [] };
  } catch (err) {
    console.warn("[twin-focus] read failed:", err);
    return { prefetches: [] };
  }
}

export function setFocusConfig(employeeId: string, config: FocusConfig): void {
  const fp = focusFile(employeeId);
  ensureDir(fp);
  fs.writeFileSync(fp, JSON.stringify(config, null, 2), "utf8");
}
