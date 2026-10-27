// Server-only. Read employee records from data/employees/ on disk and
// materialise them as EmployeeWithTwin objects. Lives in its own module so
// nothing pulls `fs` into the client bundle through the shared employees.ts.

import "server-only";
import fs from "fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "path";
import { EMPLOYEE_ID, VOICE_CONSENT_TEXT } from "./employees";
import type { ClaudeModel, EmployeeConsent, EmployeeWithTwin, RetentionConsent, TwinLifecycle, VoiceConsent } from "./employees";
import { appendAuditEntry } from "./audit-log";
import { TWIN_MODEL_OPUS, TWIN_MODEL_PRIMARY } from "./sdk-defaults";
import { withSidecarLock } from "./sidecar-lock";
import { dataDir } from "./app-home";
import { pendingInviteTokens } from "./invites";

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
  voiceConsent?: VoiceConsent;
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
      ...(sidecar.voiceConsent ? { voiceConsent: sidecar.voiceConsent } : {}),
    });
  }

  results.sort((a, b) =>
    (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""),
  );
  return results;
}

export const voiceConsentDigest = () => createHash("sha256").update(VOICE_CONSENT_TEXT).digest("hex");

/** The person's recorded voice consent, or null. A record that can't be read
 *  counts as no consent: a cloned voice is never used on a guess. */
export async function loadVoiceConsent(employeeId: string): Promise<VoiceConsent | null> {
  try {
    const sidecar = JSON.parse(await fs.readFile(dataDir("employees", employeeId, "employee.json"), "utf8")) as DiskSidecar;
    const c = sidecar.voiceConsent;
    return c && typeof c.voiceId === "string" && c.voiceId ? c : null;
  } catch {
    return null;
  }
}

/**
 * Record, or withdraw, a person's consent to use the given voice for their twin.
 * Granting stores who/when/wording digest/IP/user agent next to the voice id.
 * Withdrawing deletes the whole record (the voice id with it). Both are audited.
 */
export async function recordVoiceConsent(
  employeeId: string,
  args: { agree: boolean; voiceId: string; onBehalf: boolean; actor?: { userId?: string }; headers?: Headers },
): Promise<{ ok: true; voiceConsent: VoiceConsent | null } | { ok: false; error: string; status: number }> {
  if (!EMPLOYEE_ID.test(employeeId)) return { ok: false, error: "Twin not found", status: 404 };
  if (args.agree && !/^[A-Za-z0-9]{1,64}$/.test(args.voiceId)) return { ok: false, error: "voiceId is required to give consent", status: 400 };
  const sidecarPath = dataDir("employees", employeeId, "employee.json");
  return withSidecarLock(employeeId, async () => {
    let sidecar: DiskSidecar;
    try {
      sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8")) as DiskSidecar;
    } catch {
      return { ok: false as const, error: "Twin not found", status: 404 };
    }
    const forwarded = args.headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = (forwarded || args.headers?.get("x-real-ip") || "").slice(0, 64);
    const userAgent = (args.headers?.get("user-agent") ?? "").slice(0, 300);
    const textDigest = voiceConsentDigest();
    const updated: DiskSidecar = { ...sidecar };
    let voiceConsent: VoiceConsent | null = null;
    let withdrawnVoiceId: string | undefined;
    if (args.agree) {
      voiceConsent = {
        voiceId: args.voiceId,
        grantedAt: new Date().toISOString(),
        textDigest,
        locale: "en",
        ...(args.onBehalf ? { onBehalf: true } : {}),
        ip,
        userAgent,
      };
      updated.voiceConsent = voiceConsent;
    } else {
      withdrawnVoiceId = sidecar.voiceConsent?.voiceId;
      delete updated.voiceConsent;
    }
    // Temp file + rename: lifecycle checks read this file without the lock.
    const tmp = `${sidecarPath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(updated, null, 2), "utf8");
    await fs.rename(tmp, sidecarPath);

    const toolName = args.agree ? "voice.consentGranted" : "voice.consentWithdrawn";
    const audited = appendAuditEntry({
      runId: `voice-${Date.now()}`,
      employeeId,
      employeeName: sidecar.name ?? employeeId,
      toolName,
      bareName: toolName,
      input: { voiceId: args.agree ? args.voiceId : (withdrawnVoiceId ?? null), onBehalf: args.onBehalf, consentTextSha256: textDigest, ip, userAgent },
      verdict: "executed",
      approvalChannel: "ui",
      ...(args.actor?.userId ? { requesterId: args.actor.userId } : {}),
    });
    if (!audited) console.error(`[voice-consent] audit entry not written for ${toolName} (${employeeId})`);
    return { ok: true as const, voiceConsent };
  });
}
