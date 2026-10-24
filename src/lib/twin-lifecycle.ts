// Relay lifecycle of a twin: active → handover → retired.
//
// A retired twin belongs to someone who has left. It stays so colleagues can
// keep asking what that person knew, but only with their consent, given
// during the handover (the retention consent below). Without it, leaving
// means deleting the twin (the existing purge). Every transition is written
// to the hash-chained audit log.

import "server-only";
import fs from "fs/promises";
import { readFileSync } from "fs";
import { createHash, randomUUID } from "node:crypto";
import path from "path";
import { dataDir } from "./app-home";
import { appendAuditEntry } from "./audit-log";
import { withSidecarLock } from "./sidecar-lock";
import { onboardingEn, onboardingHe } from "./i18n/catalog/onboarding";
import type { RetentionConsent, TwinLifecycle } from "./employees";

export type LifecycleState = {
  lifecycle: TwinLifecycle;
  handoverStartedAt?: string;
  retiredAt?: string;
  retention?: RetentionConsent;
  /** Set when the employee said no to keeping their twin. */
  retentionDeclinedAt?: string;
};

export type LifecycleAction = "start-handover" | "cancel-handover" | "retire";

/** The state an action leads to, or an error saying why it isn't allowed. */
export function nextLifecycle(
  state: LifecycleState,
  action: LifecycleAction,
): { ok: true; lifecycle: TwinLifecycle } | { ok: false; error: string } {
  const from = state.lifecycle;
  switch (action) {
    case "start-handover":
      return from === "active" ? { ok: true, lifecycle: "handover" } : { ok: false, error: `Twin is ${from}, not active` };
    case "cancel-handover":
      return from === "handover" ? { ok: true, lifecycle: "active" } : { ok: false, error: `Twin is ${from}, not in handover` };
    case "retire":
      if (from !== "handover") return { ok: false, error: `Start a handover before retiring (twin is ${from})` };
      if (!state.retention) {
        return { ok: false, error: "The employee hasn't agreed to keep their twin after they leave. Delete the twin instead." };
      }
      return { ok: true, lifecycle: "retired" };
  }
}

export const isRetired = (e: { lifecycle?: TwinLifecycle } | null | undefined) => e?.lifecycle === "retired";

/** The retention consent wording, in a stable order, for the evidence digest. */
export function retentionConsentText(locale: "en" | "he"): string {
  const catalog: Record<string, string> = locale === "he" ? onboardingHe : onboardingEn;
  return Object.keys(catalog)
    .filter((k) => k.startsWith("relayConsent."))
    .sort()
    .map((k) => `${k}=${catalog[k]}`)
    .join("\n");
}

export function retentionConsentDigest(locale: "en" | "he"): string {
  return createHash("sha256").update(retentionConsentText(locale)).digest("hex");
}

const sidecarPath = (id: string) => dataDir("employees", id, "employee.json");

type Sidecar = Record<string, unknown> & { name?: string } & Partial<LifecycleState>;

async function readSidecar(id: string): Promise<Sidecar> {
  return JSON.parse(await fs.readFile(sidecarPath(id), "utf8")) as Sidecar;
}

/** Write via a temp file and rename, so a reader never sees a half-written record. */
async function writeSidecar(id: string, value: Sidecar): Promise<void> {
  const tmp = `${sidecarPath(id)}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, sidecarPath(id));
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT";

/** Profile files a retired twin's colleagues and the org brain must no longer
 *  reach. On retirement they move here: four path segments deep, outside the
 *  peer read scope, the org-brain index and the profile file API. Deleting
 *  the twin deletes them with everything else. */
export const WITHHELD_DIR = "retired-withheld";
export const WITHHELD_FILES = ["PEOPLE.md", "PREFERENCES.md", "EMPLOYMENT.md"] as const;

async function withholdPrivateFiles(id: string): Promise<string[]> {
  const dir = dataDir("employees", id);
  const moved: string[] = [];
  await fs.mkdir(path.join(dir, WITHHELD_DIR), { recursive: true });
  for (const name of WITHHELD_FILES) {
    try {
      await fs.rename(path.join(dir, name), path.join(dir, WITHHELD_DIR, name));
      moved.push(name);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return moved;
}

function stateOf(s: Sidecar): LifecycleState {
  return {
    lifecycle: s.lifecycle === "handover" || s.lifecycle === "retired" ? s.lifecycle : "active",
    ...(s.handoverStartedAt ? { handoverStartedAt: s.handoverStartedAt } : {}),
    ...(s.retiredAt ? { retiredAt: s.retiredAt } : {}),
    ...(s.retention ? { retention: s.retention } : {}),
    ...(s.retentionDeclinedAt ? { retentionDeclinedAt: s.retentionDeclinedAt } : {}),
  };
}

/**
 * The twin's lifecycle. A missing record is active (nothing to restrict). A
 * record that exists but can't be read fails closed as retired: the run loses
 * its tools rather than a retired twin getting them back.
 */
export async function loadLifecycle(id: string): Promise<LifecycleState> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return stateOf(await readSidecar(id));
    } catch (err) {
      if (isMissing(err)) return { lifecycle: "active" };
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  return { lifecycle: "retired" };
}

/** Synchronous check for code paths that can't await (intake, routing).
 *  Fails closed the same way as loadLifecycle. */
export function isRetiredSync(id: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (JSON.parse(readFileSync(sidecarPath(id), "utf8")) as Sidecar).lifecycle === "retired";
    } catch (err) {
      if (isMissing(err)) return false;
    }
  }
  return true;
}

export type Actor = { userId?: string; role?: string };

function audit(id: string, name: string, toolName: string, input: Record<string, unknown>, actor: Actor) {
  appendAuditEntry({
    runId: `relay-${Date.now()}`,
    employeeId: id,
    employeeName: name,
    toolName,
    bareName: toolName,
    input,
    verdict: "executed",
    approvalChannel: "ui",
    ...(actor.userId ? { requesterId: actor.userId } : {}),
  });
}

/** Apply a lifecycle action to the twin's record. */
export async function applyLifecycleAction(
  id: string,
  action: LifecycleAction,
  actor: Actor = {},
): Promise<{ ok: true; state: LifecycleState } | { ok: false; error: string; status: number }> {
  return withSidecarLock(id, async () => {
    let sidecar: Sidecar;
    try {
      sidecar = await readSidecar(id);
    } catch {
      return { ok: false as const, error: "Twin not found", status: 404 };
    }
    const before = stateOf(sidecar);
    const next = nextLifecycle(before, action);
    if (!next.ok) return { ok: false as const, error: next.error, status: 409 };

    const now = new Date().toISOString();
    const updated: Sidecar = { ...sidecar, lifecycle: next.lifecycle };
    if (action === "start-handover") updated.handoverStartedAt = now;
    if (action === "cancel-handover") {
      delete updated.handoverStartedAt;
      delete updated.retention;
      delete updated.retentionDeclinedAt;
    }
    const withheld = action === "retire" ? await withholdPrivateFiles(id) : [];
    if (action === "retire") updated.retiredAt = now;
    await writeSidecar(id, updated);

    audit(id, sidecar.name ?? id, `relay.${action}`, { from: before.lifecycle, to: next.lifecycle, ...(withheld.length ? { withheld } : {}) }, actor);
    return { ok: true as const, state: stateOf(updated) };
  });
}

/** Record the departing employee's answer to the retention consent. A "no"
 *  clears any earlier "yes", so retiring is refused and the twin gets deleted. */
export async function recordRetentionConsent(
  id: string,
  args: { agree: boolean; locale: "en" | "he"; actor?: Actor; headers?: Headers; onBehalf?: boolean },
): Promise<{ ok: true; state: LifecycleState } | { ok: false; error: string; status: number }> {
  return withSidecarLock(id, async () => {
    let sidecar: Sidecar;
    try {
      sidecar = await readSidecar(id);
    } catch {
      return { ok: false as const, error: "Twin not found", status: 404 };
    }
    if (stateOf(sidecar).lifecycle !== "handover") {
      return { ok: false as const, error: "Consent is given during a handover", status: 409 };
    }
    const updated: Sidecar = { ...sidecar };
    const textDigest = retentionConsentDigest(args.locale);
    const now = new Date().toISOString();
    if (args.agree) {
      updated.retention = { grantedAt: now, textDigest, locale: args.locale, ...(args.onBehalf ? { onBehalf: true } : {}) };
      delete updated.retentionDeclinedAt;
    } else {
      delete updated.retention;
      updated.retentionDeclinedAt = now;
    }
    await writeSidecar(id, updated);

    const forwarded = args.headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
    audit(id, sidecar.name ?? id, args.agree ? "relay.retentionConsentGranted" : "relay.retentionConsentDeclined", {
      consentTextLocale: args.locale,
      onBehalf: args.onBehalf === true,
      consentTextSha256: textDigest,
      ip: (forwarded || args.headers?.get("x-real-ip") || "").slice(0, 64),
      userAgent: (args.headers?.get("user-agent") ?? "").slice(0, 300),
    }, args.actor ?? {});
    return { ok: true as const, state: stateOf(updated) };
  });
}
