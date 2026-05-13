// Invite-link store. The CEO creates an invite, gets back a copyable URL,
// shares it with the employee on the LAN. The employee opens the URL and
// self-onboards. No mail server. No external dependencies.
//
// The invite token also serves as a LAN-token bypass for the /join and
// /onboarding routes — without it, employees on the LAN can't reach the
// app at all (they don't have the shared EMPLOYEE001_TOKEN).

import fs from "fs";
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
};

const INVITE_EXPIRY_DAYS = 14;

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
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createInvite(input: { name?: string; role?: string }): Invite {
  const token = `inv_${randomBytes(20).toString("hex")}`;
  const now = new Date();
  const expires = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 86400_000);
  const invite: Invite = {
    token,
    name: input.name?.trim() || undefined,
    role: input.role?.trim() || undefined,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  const list = readAll();
  list.push(invite);
  writeAll(list);
  return invite;
}

export function findInvite(token: string): Invite | undefined {
  if (!token.startsWith("inv_")) return undefined;
  return readAll().find((i) => i.token === token);
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
