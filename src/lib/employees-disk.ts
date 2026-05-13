// Server-only. Read employee records from data/employees/ on disk and
// materialise them as EmployeeWithTwin objects. Lives in its own module so
// nothing pulls `fs` into the client bundle through the shared employees.ts.

import "server-only";
import fs from "fs/promises";
import path from "path";
import type { EmployeeWithTwin } from "./employees";

const AVATAR_PALETTE = [
  "#A8B4C4", "#C4A8B8", "#B8C4A8", "#A8C4B8", "#C4B8A8",
  "#B8A8C4", "#C4C4A8", "#A8C4C4", "#C4A8A8", "#A8A8C4",
];

const PROFILE_BASES = [
  "EXPERTISE", "DECISIONS", "CONTEXT", "PEOPLE", "PROJECTS",
  "PREFERENCES", "TONE", "BOUNDARIES", "EMPLOYMENT",
];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pickColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

type DiskSidecar = {
  id: string;
  name: string;
  role?: string | null;
  createdAt?: string;
  department?: string;
  integrations?: string[];
  lastActiveAt?: string;
};

export async function loadEmployeesFromDisk(): Promise<EmployeeWithTwin[]> {
  const root = path.join(process.cwd(), "data", "employees");

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const results: EmployeeWithTwin[] = [];
  for (const id of entries) {
    if (id.startsWith(".")) continue;
    const sidecarPath = path.join(root, id, "employee.json");
    let sidecar: DiskSidecar | undefined;
    try {
      const raw = await fs.readFile(sidecarPath, "utf8");
      sidecar = JSON.parse(raw) as DiskSidecar;
    } catch {
      continue;
    }
    if (!sidecar?.name) continue;

    let complete = 0;
    for (const base of PROFILE_BASES) {
      try {
        const txt = await fs.readFile(
          path.join(root, id, `${base}.md`),
          "utf8",
        );
        if (txt.trim().length > 16) complete++;
      } catch {
        // missing file — don't count
      }
    }

    results.push({
      id: sidecar.id || id,
      name: sidecar.name,
      firstName: firstNameOf(sidecar.name),
      role: sidecar.role || "—",
      department: sidecar.department || "General",
      initials: initialsFor(sidecar.name),
      avatarColor: pickColor(sidecar.id || id),
      integrations: sidecar.integrations ?? [],
      twinStatus: complete >= 6 ? "ready" : complete > 0 ? "building" : "pending",
      twinConfidence: complete >= 6 ? Math.min(1, complete / 9) : 0,
      profileFilesComplete: complete,
      lastActiveAt: sidecar.lastActiveAt,
      questionsThisWeek: 0,
      skills: [],
      orgSkillIds: [],
      seedModel: "claude-opus-4-7",
      refreshModel: "claude-sonnet-4-6",
      ttsVoiceId: "EXAVITQu4vr4xnSDxMaL",
    });
  }

  results.sort((a, b) =>
    (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""),
  );
  return results;
}
