// Server-only. Read employee records from data/employees/ on disk and
// materialise them as EmployeeWithTwin objects. Lives in its own module so
// nothing pulls `fs` into the client bundle through the shared employees.ts.

import "server-only";
import fs from "fs/promises";
import { randomUUID } from "node:crypto";
import path from "path";
import type { ClaudeModel, EmployeeConsent, EmployeeWithTwin, RetentionConsent, TwinLifecycle } from "./employees";
import { TWIN_MODEL_OPUS, TWIN_MODEL_PRIMARY } from "./sdk-defaults";
import { withSidecarLock } from "./sidecar-lock";
import { dataDir } from "./app-home";
import { pendingInviteTokens } from "./invites";
import { appendAuditEntry } from "./audit-log";
import { daysBetween, type ProfileFileAge } from "./profile-age";

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
  nameHe?: string;
  role?: string | null;
  createdAt?: string;
  department?: string;
  integrations?: string[];
  lastActiveAt?: string;
  questionsThisWeek?: number;
  weekOf?: string; // ISO week string e.g. "2026-W20"
  /** Recorded by the invite wizard (version, scopes, timestamp). */
  consent?: EmployeeConsent;
  /** Legacy single-model records apply the selected model to both workflows. */
  model?: ClaudeModel;
  seedModel?: ClaudeModel;
  refreshModel?: ClaudeModel;
  answerSlackWithoutAsking?: boolean;
  /** Relay lifecycle; missing = active. */
  lifecycle?: TwinLifecycle;
  handoverStartedAt?: string;
  retiredAt?: string;
  retention?: RetentionConsent;
  /** Synthetic demo-fixture twin: not a person, consent doesn't apply. */
  synthetic?: boolean;
  /**
   * Set when materialised from an invite before the employee finished the
   * consent wizard. Such records have placeholder markdown that would
   * otherwise score as "ready" and surface in /employees + org chart as a
   * ghost row. Skipped in `loadEmployeesFromDisk` until the wizard clears
   * the flag.
   */
  pendingProfile?: boolean;
  via?: { invite?: string };
  /** When the owner last clicked "Still true" on each profile file (ISO). */
  profileConfirmedAt?: Record<string, string>;
};

/** Returns the ISO week string for a given date, e.g. "2026-W20". */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Increment questionsThisWeek for an employee and update lastActiveAt.
 * Resets the counter when the ISO week has rolled over since the last write.
 * Fire-and-forget: errors are swallowed so a disk hiccup never breaks a chat.
 */
export async function bumpActivityOnDisk(employeeId: string): Promise<void> {
  const sidecarPath = dataDir("employees", employeeId, "employee.json");
  try {
    await withSidecarLock(employeeId, async () => {
    const raw = await fs.readFile(sidecarPath, "utf8");
    const sidecar: DiskSidecar = JSON.parse(raw);
    const thisWeek = isoWeek(new Date());
    const count =
      sidecar.weekOf === thisWeek ? (sidecar.questionsThisWeek ?? 0) + 1 : 1;
    // Temp file + rename: lifecycle checks read this file without the lock.
    const tmp = `${sidecarPath}.${randomUUID()}.tmp`;
    await fs.writeFile(
      tmp,
      JSON.stringify(
        { ...sidecar, lastActiveAt: new Date().toISOString(), questionsThisWeek: count, weekOf: thisWeek },
        null,
        2,
      ),
      "utf8",
    );
    await fs.rename(tmp, sidecarPath);
    });
  } catch {
    // Non-critical — never crash the chat for a stats write failure.
  }
}

function validEmployeeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(id);
}

/**
 * Age of each profile file that exists. The age counts from the later of the
 * file's last write and the owner's last "Still true", so a file that was
 * never confirmed shows its last-written age rather than a blank.
 */
export async function profileFileAges(employeeId: string, nowMs: number = Date.now()): Promise<ProfileFileAge[]> {
  if (!validEmployeeId(employeeId)) return [];
  const dir = dataDir("employees", employeeId);
  let confirmed: Record<string, string> = {};
  try {
    const sidecar = JSON.parse(await fs.readFile(path.join(dir, "employee.json"), "utf8")) as DiskSidecar;
    confirmed = sidecar.profileConfirmedAt ?? {};
  } catch {
    // no sidecar: every file shows its written age
  }
  const ages: ProfileFileAge[] = [];
  for (const base of PROFILE_BASES) {
    const file = `${base}.md`;
    let writtenMs: number;
    try {
      writtenMs = (await fs.stat(path.join(dir, file))).mtimeMs;
    } catch {
      continue; // missing file: nothing to age
    }
    const confirmedMs = Date.parse(confirmed[file] ?? "");
    const useConfirmed = Number.isFinite(confirmedMs) && confirmedMs > writtenMs;
    const atMs = useConfirmed ? confirmedMs : writtenMs;
    ages.push({
      file,
      days: daysBetween(atMs, nowMs),
      basis: useConfirmed ? "confirmed" : "written",
      at: new Date(atMs).toISOString(),
    });
  }
  return ages;
}

/**
 * "Still true": record that the owner re-confirmed a profile file. The file's
 * content and modified time are left alone; the confirmation lives in the
 * sidecar and is appended to the audit log. Returns the new age, or null for
 * an unknown employee or file; throws when the record can't be saved.
 */
export async function confirmProfileFile(
  employeeId: string,
  file: string,
  actor?: { id?: string },
  nowMs: number = Date.now(),
): Promise<ProfileFileAge | null> {
  if (!validEmployeeId(employeeId)) return null;
  if (!PROFILE_BASES.some((b) => `${b}.md` === file)) return null;
  const dir = dataDir("employees", employeeId);
  const sidecarPath = path.join(dir, "employee.json");
  try {
    await fs.stat(path.join(dir, file));
  } catch {
    return null;
  }
  const at = new Date(nowMs).toISOString();
  // Throws if the sidecar can't be read or written, or the audit entry can't
  // be appended. The row is written after the rename, so it never records a
  // confirmation that didn't land; a failed row is reported as a failure.
  const confirmed = await withSidecarLock(employeeId, async () => {
    const sidecar: DiskSidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8"));
    // Retired twins are read-only (checked under the lock retirement also takes).
    if (sidecar.lifecycle === "retired") return false;
    const tmp = `${sidecarPath}.${randomUUID()}.tmp`;
    await fs.writeFile(
      tmp,
      JSON.stringify({ ...sidecar, profileConfirmedAt: { ...sidecar.profileConfirmedAt, [file]: at } }, null, 2),
      "utf8",
    );
    await fs.rename(tmp, sidecarPath);
    const audited = appendAuditEntry({
      runId: `profile-confirm-${nowMs}-${randomUUID().slice(0, 8)}`,
      employeeId,
      employeeName: sidecar.name || employeeId,
      toolName: "confirmProfileFile",
      bareName: "confirmProfileFile",
      input: { file },
      verdict: "executed",
      ...(actor?.id ? { approvedBy: actor.id, approvalChannel: "ui" as const } : {}),
    });
    if (!audited) throw new Error("the confirmation was saved but could not be written to the audit log");
    return true;
  });
  if (!confirmed) return null;
  return { file, days: 0, basis: "confirmed", at };
}

export async function loadEmployeesFromDisk(): Promise<EmployeeWithTwin[]> {
  const root = dataDir("employees");

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const results: EmployeeWithTwin[] = [];
  let pending: Set<string> | undefined;
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
    // Invite materialised the directory before consent — skip until the
    // wizard reconciles the sidecar (drops pendingProfile + rewrites the
    // markdown). Otherwise the placeholder content scores as "ready" and
    // shows a ghost row in /employees and the org chart.
    // `via.invite` covers materializations written before pendingProfile was
    // consistently set for named invites.
    if (sidecar.pendingProfile || (typeof sidecar.via?.invite === "string" && (pending ??= pendingInviteTokens()).has(sidecar.via.invite))) continue;

    let complete = 0;
    for (const base of PROFILE_BASES) {
      // A retired twin's private files moved to retired-withheld/ (twin-lifecycle.ts).
      const candidates = sidecar.lifecycle === "retired"
        ? [path.join(root, id, `${base}.md`), path.join(root, id, "retired-withheld", `${base}.md`)]
        : [path.join(root, id, `${base}.md`)];
      for (const file of candidates) {
        try {
          if ((await fs.readFile(file, "utf8")).trim().length > 16) {
            complete++;
            break;
          }
        } catch {
          // missing file — don't count
        }
      }
    }

    results.push({
      id: sidecar.id || id,
      name: sidecar.name,
      nameHe: sidecar.nameHe,
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
      questionsThisWeek:
        sidecar.weekOf === isoWeek(new Date()) ? (sidecar.questionsThisWeek ?? 0) : 0,
      skills: [],
      orgSkillIds: [],
      seedModel: sidecar.seedModel ?? sidecar.model ?? TWIN_MODEL_OPUS,
      refreshModel: sidecar.refreshModel ?? sidecar.model ?? TWIN_MODEL_PRIMARY,
      ttsVoiceId: "EXAVITQu4vr4xnSDxMaL",
      ...(sidecar.consent ? { consent: sidecar.consent } : {}),
      ...(sidecar.synthetic === true ? { synthetic: true } : {}),
      answerSlackWithoutAsking: sidecar.answerSlackWithoutAsking === true,
      ...(sidecar.lifecycle && sidecar.lifecycle !== "active" ? { lifecycle: sidecar.lifecycle } : {}),
      ...(sidecar.retiredAt ? { retiredAt: sidecar.retiredAt } : {}),
      ...(sidecar.retention ? { retention: sidecar.retention } : {}),
    });
  }

  results.sort((a, b) =>
    (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""),
  );
  return results;
}
