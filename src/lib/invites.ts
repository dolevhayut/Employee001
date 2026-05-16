// Invite-link store. The CEO creates an invite, gets back a copyable URL,
// shares it with the employee on the LAN. The employee opens the URL and
// self-onboards. No mail server. No external dependencies.
//
// The invite token also serves as a LAN-token bypass for the /join and
// /onboarding routes — without it, employees on the LAN can't reach the
// app at all (they don't have the shared EMPLOYEE001_TOKEN).

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export type Invite = {
  token: string;
  /** Optional name hint shown to the employee on /join. */
  name?: string;
  /** Optional role hint shown to the employee. */
  role?: string;
  createdAt: string;
  /** ISO timestamp when an employee finished onboarding through this invite. */
  completedAt?: string;
  /** Employee id produced by the onboarding flow. Empty until completion. */
  employeeId?: string;
  /** Invitations expire 14 days after creation if unused. */
  expiresAt: string;
  /**
   * How many days of historical signal the twin-builder should pull when
   * training the employee's twin. CEO picks this per-invite; clamped to
   * [30, 360]. Cost and training time scale roughly linearly with this.
   */
  lookbackDays: number;
};

const INVITE_EXPIRY_DAYS = 14;
const LOOKBACK_MIN = 30;
const LOOKBACK_MAX = 360;
const LOOKBACK_DEFAULT = 90;

/** Clamp a lookback value into the allowed window; non-integers/garbage default. */
export function clampLookbackDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return LOOKBACK_DEFAULT;
  const i = Math.round(n);
  if (i < LOOKBACK_MIN) return LOOKBACK_MIN;
  if (i > LOOKBACK_MAX) return LOOKBACK_MAX;
  return i;
}

/** Apply the in-memory default for invites persisted before this field existed. */
function withLookbackDefault(i: Invite): Invite {
  if (typeof (i as { lookbackDays?: unknown }).lookbackDays === "number") return i;
  return { ...i, lookbackDays: LOOKBACK_DEFAULT };
}

function file(): string {
  return path.join(process.cwd(), "data", "invites.json");
}

function ensureDir(): void {
  const dir = path.dirname(file());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(): Invite[] {
  try {
    if (!fs.existsSync(file())) return [];
    const raw = fs.readFileSync(file(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: Invite[]): void {
  ensureDir();
  fs.writeFileSync(file(), JSON.stringify(list, null, 2), "utf8");
}

export function listInvites(): Invite[] {
  // Return newest first, scrub anything that was created with a bad shape.
  return readAll()
    .filter((i): i is Invite => typeof i?.token === "string")
    .map(withLookbackDefault)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createInvite(input: {
  name?: string;
  role?: string;
  lookbackDays?: number;
}): Invite {
  const token = `inv_${randomBytes(20).toString("hex")}`;
  const now = new Date();
  const expires = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 86400_000);
  const invite: Invite = {
    token,
    name: input.name?.trim() || undefined,
    role: input.role?.trim() || undefined,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    lookbackDays: clampLookbackDays(
      input.lookbackDays === undefined ? LOOKBACK_DEFAULT : input.lookbackDays,
    ),
  };
  const list = readAll();
  list.push(invite);
  writeAll(list);
  return invite;
}

export function findInvite(token: string): Invite | undefined {
  if (!token.startsWith("inv_")) return undefined;
  const i = readAll().find((x) => x.token === token);
  return i ? withLookbackDefault(i) : undefined;
}

/**
 * Returns the invite if it's valid for use right now (exists, unexpired,
 * not already completed). Used by both the proxy (for LAN bypass) and the
 * /join page (to render a welcome view).
 */
export function isInviteRedeemable(token: string): Invite | undefined {
  const i = findInvite(token);
  if (!i) return undefined;
  if (i.completedAt) return undefined;
  if (new Date(i.expiresAt).getTime() < Date.now()) return undefined;
  return i;
}

export function revokeInvite(token: string): boolean {
  const list = readAll();
  const next = list.filter((i) => i.token !== token);
  if (next.length === list.length) return false;
  writeAll(next);
  return true;
}

/**
 * Bind an `employeeId` to an invite without marking it completed.
 * Used by `materializeEmployeeFromInvite` so subsequent GET
 * /api/invites/<token>/connections requests can resolve the employee
 * before consent has been finalised. Idempotent — re-binding the same
 * id is a no-op; binding a different id is rejected.
 */
export function bindInviteEmployee(token: string, employeeId: string): boolean {
  const list = readAll();
  const idx = list.findIndex((i) => i.token === token);
  if (idx < 0) return false;
  const inv = list[idx];
  if (inv.employeeId === employeeId) return true;
  if (inv.employeeId && inv.employeeId !== employeeId) return false;
  list[idx] = { ...inv, employeeId };
  writeAll(list);
  return true;
}

export function markInviteCompleted(
  token: string,
  employeeId: string,
): Invite | undefined {
  const list = readAll();
  const idx = list.findIndex((i) => i.token === token);
  if (idx === -1) return undefined;
  list[idx] = {
    ...list[idx],
    completedAt: new Date().toISOString(),
    employeeId,
  };
  writeAll(list);
  return list[idx];
}

/**
 * Classify why a token is not currently redeemable. Used by the complete
 * endpoint to surface a precise UI message (already redeemed / expired /
 * not found) instead of a generic 410.
 */
export type InviteUnavailableReason = "not_found" | "used" | "expired";

export function classifyInvite(
  token: string,
): { ok: true; invite: Invite } | { ok: false; reason: InviteUnavailableReason; invite?: Invite } {
  const i = findInvite(token);
  if (!i) return { ok: false, reason: "not_found" };
  if (i.completedAt) return { ok: false, reason: "used", invite: i };
  if (new Date(i.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "expired", invite: i };
  }
  return { ok: true, invite: i };
}

/**
 * Atomically claim an invite token for completion. Uses an O_EXCL lockfile
 * so only one concurrent request can win — the rest see `already_claimed`.
 * Caller must call `releaseInviteClaim` after `markInviteCompleted` (or on
 * failure, to free the lock so a retry isn't blocked).
 */
export function tryClaimInvite(token: string): { claimed: true } | { claimed: false; reason: "already_claimed" | "not_found" | "used" | "expired" } {
  const cls = classifyInvite(token);
  if (!cls.ok) return { claimed: false, reason: cls.reason };
  ensureDir();
  const lockPath = path.join(path.dirname(file()), `.invite-${token}.lock`);
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    // Re-check after acquiring lock — another request may have already
    // marked the token completed between classify and lock.
    const recheck = classifyInvite(token);
    if (!recheck.ok) {
      // If completion already happened, surface that specifically.
      try { fs.unlinkSync(lockPath); } catch {}
      return { claimed: false, reason: recheck.reason };
    }
    return { claimed: true };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === "EEXIST") return { claimed: false, reason: "already_claimed" };
    throw err;
  }
}

// ─── Employee materialization (extracted from /api/invites/[token]/complete) ──
//
// The original "complete" route did all of this at the very end of the wizard.
// With employee-side OAuth, we need a real employee directory on disk BEFORE
// the consent submit so Composio has a stable user_id to bind the connection
// to. This function is idempotent: if the directory + employee.json already
// exist, it returns the existing employeeId without overwriting any content.

const PROFILE_FILES_LITERAL = [
  "EXPERTISE",
  "DECISIONS",
  "CONTEXT",
  "PEOPLE",
  "PROJECTS",
  "PREFERENCES",
  "TONE",
  "BOUNDARIES",
  "EMPLOYMENT",
] as const;
type ProfileFileKey = (typeof PROFILE_FILES_LITERAL)[number];

function slugifyForId(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Lightweight starter markdown — used when the employee hasn't filled in
 * the consent form yet. The /complete route later replaces these (only if
 * they still look like placeholders) with richer content from the wizard. */
function placeholderMarkdown(name: string, role: string): Record<ProfileFileKey, string> {
  const today = new Date().toISOString().slice(0, 10);
  const out = {} as Record<ProfileFileKey, string>;
  out.EMPLOYMENT = `# Employment — ${name}\n\n- Name: ${name}\n${role ? `- Role: ${role}\n` : ""}- Onboarded: ${today}\n`;
  out.EXPERTISE = `# Expertise — ${name}\n\n_To be filled in during onboarding._\n`;
  out.BOUNDARIES = `# Boundaries — ${name}\n\n_To be filled in during onboarding._\n`;
  out.CONTEXT = `# Context — ${name}\n\n_To be filled in during onboarding._\n`;
  out.DECISIONS = `# Decisions — ${name}\n\n_To be filled in during onboarding._\n`;
  out.PEOPLE = `# People — ${name}\n\n_To be filled in during onboarding._\n`;
  out.PROJECTS = `# Projects — ${name}\n\n_To be filled in during onboarding._\n`;
  out.PREFERENCES = `# Preferences — ${name}\n\n_To be filled in during onboarding._\n`;
  out.TONE = `# Tone — ${name}\n\n_To be filled in during onboarding._\n`;
  return out;
}

export type MaterializeOverrides = {
  name?: string;
  role?: string;
};

export type MaterializeResult = {
  employeeId: string;
  /** True if the directory already existed (idempotent re-call). */
  reused: boolean;
};

/**
 * Idempotently materialize an employee directory for an invite. Safe to call
 * multiple times for the same token — subsequent calls return the existing
 * employeeId without touching disk content.
 *
 * The invite's name may still be empty at first connect time (the employee
 * hasn't reached the profile step). In that case we fall back to the role or
 * a synthetic `pending-<tokenSlice>` slug. The /complete route may later
 * rename… actually, we lock in the employeeId at first call. The /complete
 * route reconciles the sidecar (name/role) but does NOT change the id, since
 * Composio is now bound to the original composio user id (`employee:<id>`).
 */
export async function materializeEmployeeFromInvite(
  token: string,
  overrides?: MaterializeOverrides,
): Promise<MaterializeResult> {
  const invite = findInvite(token);
  if (!invite) throw new Error("invite not found");

  // If the invite was previously marked completed, return that id.
  if (invite.employeeId) {
    return { employeeId: invite.employeeId, reused: true };
  }

  const nameRaw = (overrides?.name || invite.name || "").trim();
  const roleRaw = (overrides?.role || invite.role || "").trim();

  let slug = slugifyForId(nameRaw);
  if (!slug) slug = slugifyForId(roleRaw);
  if (!slug) slug = `pending-${token.slice(4, 10)}`;

  const employeeId = `${slug}-${token.slice(4, 10)}`;
  const dir = path.join(process.cwd(), "data", "employees", employeeId);
  const sidecarPath = path.join(dir, "employee.json");

  // Idempotency check: sidecar exists → return without touching anything.
  try {
    await fsp.access(sidecarPath);
    return { employeeId, reused: true };
  } catch {
    // not yet materialized
  }

  await fsp.mkdir(dir, { recursive: true });

  const name = nameRaw || `Pending (${token.slice(4, 10)})`;
  const role = roleRaw;
  const placeholders = placeholderMarkdown(name, role);

  // Only write a markdown file if it doesn't already exist.
  await Promise.all(
    PROFILE_FILES_LITERAL.map(async (key) => {
      const p = path.join(dir, `${key}.md`);
      try {
        await fsp.access(p);
      } catch {
        await fsp.writeFile(p, placeholders[key], "utf8");
      }
    }),
  );

  await fsp.writeFile(
    sidecarPath,
    JSON.stringify(
      {
        id: employeeId,
        name,
        role: role || null,
        integrations: [],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        via: { invite: token },
        pendingProfile: !nameRaw, // hint for /complete to overwrite the synthetic name
      },
      null,
      2,
    ),
    "utf8",
  );

  // Bind employeeId on the invite record so the GET connections endpoint
  // can resolve it before consent is finalised. Doesn't mark completed.
  bindInviteEmployee(token, employeeId);

  return { employeeId, reused: false };
}

export function releaseInviteClaim(token: string): void {
  const lockPath = path.join(path.dirname(file()), `.invite-${token}.lock`);
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // best-effort
  }
}
