import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/app-home";
import {
  BUILTIN_PLAYBOOKS,
  PlaybookSchema,
  type Playbook,
  type PlaybookRecord,
} from "./types";

const file = () => dataDir("playbooks.json");
function readCustom(): PlaybookRecord[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const { createdAt, updatedAt, ...playbook } = record;
      const parsed = PlaybookSchema.safeParse(playbook);
      return parsed.success
        ? [
            {
              ...parsed.data,
              kind: "custom" as const,
              createdAt: typeof createdAt === "string" ? createdAt : undefined,
              updatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
function writeCustom(items: PlaybookRecord[]) {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify(
      items.map((item) => {
        const { kind, ...persisted } = item;
        void kind;
        return persisted;
      }),
      null,
      2,
    ) + "\n",
    "utf8",
  );
}
function makeId(name: string) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 32) || "playbook";
  return `custom-${slug}-${Date.now().toString(36)}`;
}
export function listPlaybooks(): PlaybookRecord[] {
  return [
    ...BUILTIN_PLAYBOOKS.map((p) => ({ ...p, kind: "builtin" as const })),
    ...readCustom(),
  ];
}
export function getPlaybook(id: string): PlaybookRecord | undefined {
  return listPlaybooks().find((p) => p.id === id);
}
export function createCustomPlaybook(
  input: Omit<Playbook, "id">,
): PlaybookRecord {
  const now = new Date().toISOString();
  const playbook = PlaybookSchema.parse({ ...input, id: makeId(input.name) });
  const item: PlaybookRecord = {
    ...playbook,
    kind: "custom",
    createdAt: now,
    updatedAt: now,
  };
  const all = readCustom();
  all.unshift(item);
  writeCustom(all);
  return item;
}
export function updateCustomPlaybook(
  id: string,
  patch: Partial<Omit<Playbook, "id">>,
): PlaybookRecord | undefined {
  const all = readCustom();
  const index = all.findIndex((p) => p.id === id);
  if (index < 0) return undefined;
  const { kind, createdAt, updatedAt, ...current } = all[index];
  void kind;
  const updated = PlaybookSchema.parse({ ...current, ...patch, id });
  const record: PlaybookRecord = {
    ...updated,
    kind: "custom",
    createdAt,
    updatedAt: new Date().toISOString(),
  };
  void updatedAt;
  all[index] = record;
  writeCustom(all);
  return record;
}
export function deleteCustomPlaybook(id: string): boolean {
  const all = readCustom();
  const next = all.filter((p) => p.id !== id);
  if (all.length === next.length) return false;
  writeCustom(next);
  return true;
}
