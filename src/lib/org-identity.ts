// Employee001 — the organization this workspace represents.
//
// Twins introduce themselves as working "at <org>", so the name and a
// one-line description live on disk instead of being hard-coded in prompts.
// Set from /setup and /settings → Workspace. Empty until the user sets it;
// prompts then fall back to a neutral phrasing.

import "server-only";
import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";

export type OrgIdentity = {
  name: string;
  description: string;
};

export const ORG_NAME_MAX = 80;
export const ORG_DESCRIPTION_MAX = 200;

const IDENTITY_FILE = dataDir("org", "identity.json");

// The values go into system prompts: keep them to a single plain line.
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeOrgIdentity(input: Partial<Record<keyof OrgIdentity, unknown>>): OrgIdentity {
  return {
    name: clean(input.name, ORG_NAME_MAX),
    description: clean(input.description, ORG_DESCRIPTION_MAX),
  };
}

export function readOrgIdentity(): OrgIdentity {
  try {
    const raw = JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf-8")) as Partial<OrgIdentity>;
    return normalizeOrgIdentity(raw);
  } catch {
    return { name: "", description: "" };
  }
}

export function writeOrgIdentity(input: Partial<Record<keyof OrgIdentity, unknown>>): OrgIdentity {
  const identity = normalizeOrgIdentity(input);
  fs.mkdirSync(path.dirname(IDENTITY_FILE), { recursive: true });
  const tmp = `${IDENTITY_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(identity, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, IDENTITY_FILE);
  return identity;
}

/** "at Acme — a two-sided marketplace for …", or "at your company" when unset. */
export function orgClause(identity: OrgIdentity = readOrgIdentity()): string {
  if (!identity.name) return "at your company";
  return identity.description
    ? `at ${identity.name} — ${identity.description}`
    : `at ${identity.name}`;
}

/** "the CEO of Acme", or "the CEO" when unset. */
export function ceoOf(identity: OrgIdentity = readOrgIdentity()): string {
  return identity.name ? `the CEO of ${identity.name}` : "the CEO";
}
