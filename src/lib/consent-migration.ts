// One-time (idempotent) migration for consent deny-by-default (0.7.x): every
// twin without a consent record, that isn't synthetic demo data, is marked
// "consent_required" on its employee.json so the UI can show the banner and
// the audit log shows when access was withdrawn.

import "server-only";
import fs from "fs";
import path from "path";
import { dataDir } from "./app-home";
import { appendAuditEntry } from "./audit-log";
import { pseudonymFor } from "./audit-pseudonym";
import { inviteOnboardingInProgress } from "./invites";

export type ConsentRequiredTwin = { id: string; name: string; since?: string };

type Sidecar = { name?: string; consent?: { scopes?: unknown }; synthetic?: unknown; pendingProfile?: unknown; via?: { invite?: unknown }; consentState?: string; consentRequiredSince?: string };

function readSidecars(): Array<{ id: string; file: string; sidecar: Sidecar }> {
  const root = dataDir("employees");
  if (!fs.existsSync(root)) return [];
  const out: Array<{ id: string; file: string; sidecar: Sidecar }> = [];
  for (const id of fs.readdirSync(root)) {
    const file = path.join(root, id, "employee.json");
    try {
      out.push({ id, file, sidecar: JSON.parse(fs.readFileSync(file, "utf8")) as Sidecar });
    } catch { /* no sidecar: not a twin yet (invite in progress) */ }
  }
  return out;
}

// An invite can materialize a directory to connect a toolkit before the
// onboarding form is submitted. Consent is expected to be absent at that
// point, so it is not a consent-required twin yet.
const needsConsent = (s: Sidecar) =>
  s.synthetic !== true &&
  s.pendingProfile !== true &&
  !inviteOnboardingInProgress(s.via?.invite) &&
  !Array.isArray(s.consent?.scopes);

/** Mark twins with no consent record. Returns the ids marked this time. */
export function markTwinsConsentRequired(now = new Date()): string[] {
  const marked: string[] = [];
  for (const { id, file, sidecar } of readSidecars()) {
    if (!needsConsent(sidecar) || sidecar.consentState === "consent_required") continue;
    const next = { ...sidecar, consentState: "consent_required", consentRequiredSince: now.toISOString() };
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
    marked.push(id);
  }
  if (marked.length) {
    appendAuditEntry({
      runId: `migration-${now.getTime()}`,
      employeeId: "system",
      employeeName: "system",
      toolName: "consentMigration",
      bareName: "consentMigration",
      input: { markedConsentRequired: marked.map(pseudonymFor), rule: "deny-by-default: no recorded consent, no training, tools, transcripts or actions" },
      verdict: "executed",
    });
  }
  return marked;
}

/** Twins waiting for their employee's consent, for the workspace banner. */
export function listConsentRequired(): ConsentRequiredTwin[] {
  return readSidecars()
    .filter(({ sidecar }) => needsConsent(sidecar))
    .map(({ id, sidecar }) => ({ id, name: sidecar.name ?? id, ...(sidecar.consentRequiredSince ? { since: sidecar.consentRequiredSince } : {}) }));
}
