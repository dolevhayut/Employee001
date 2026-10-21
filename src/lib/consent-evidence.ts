// Evidence of an employee's consent, written to the hash-chained audit log
// when they finish the invite wizard: who (employee id and name, the invite
// that identified them), when, which consent text (version + SHA-256 of the
// exact wording in the language shown), which scopes, and from where (IP,
// user agent, channel). The chain makes the row tamper-evident; if consent is
// later revoked, purge redacts the personal fields but the row's digest stays.

import { createHash } from "node:crypto";
import { appendAuditEntry } from "./audit-log";
import { CONSENT_SCOPES, type EmployeeConsent } from "./employees";
import { onboardingEn, onboardingHe } from "./i18n/catalog/onboarding";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The wording an employee agrees to: the consent step's strings plus the
 *  scope definitions, in a stable order. */
export function consentText(locale: "en" | "he"): string {
  const catalog: Record<string, string> = locale === "he" ? onboardingHe : onboardingEn;
  const keys = Object.keys(catalog)
    .filter((k) => /^onboarding\.(consent|before|rights|scope|terms|required|optional)/.test(k))
    .sort();
  const scopes = CONSENT_SCOPES.map((s) => `${s.id}|${s.required ? "required" : "optional"}|${s.label}|${s.desc}`);
  return [...keys.map((k) => `${k}=${catalog[k]}`), ...scopes].join("\n");
}

export function consentTextDigest(locale: "en" | "he"): string {
  return sha256(consentText(locale));
}

export type ConsentEvidenceInput = {
  employeeId: string;
  employeeName: string;
  inviteToken: string;
  consent: EmployeeConsent;
  locale?: string;
  headers: Headers;
  channel?: "invite";
};

/** First hop of X-Forwarded-For, else X-Real-IP. Empty when direct/local. */
function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || headers.get("x-real-ip") || "").slice(0, 64);
}

export function buildConsentEvidence(input: ConsentEvidenceInput): Record<string, unknown> {
  const locale = input.locale === "he" ? "he" : "en";
  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    inviteTokenSha256: sha256(input.inviteToken),
    grantedAt: input.consent.grantedAt,
    consentVersion: input.consent.version,
    consentTextLocale: locale,
    consentTextSha256: consentTextDigest(locale),
    scopes: [...input.consent.scopes].sort(),
    ip: clientIp(input.headers),
    userAgent: (input.headers.get("user-agent") ?? "").slice(0, 300),
    channel: input.channel ?? "invite",
  };
}

/** Append the evidence row. Returns false if the audit write failed. */
export function recordConsentEvidence(input: ConsentEvidenceInput): boolean {
  const evidence = buildConsentEvidence(input);
  return appendAuditEntry({
    runId: `consent-${Date.now()}`,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    toolName: "consentRecorded",
    bareName: "consentRecorded",
    input: evidence,
    verdict: "executed",
    requesterId: `invite:${String(evidence.inviteTokenSha256).slice(0, 16)}`,
    approvalChannel: "ui",
    approvedBy: `employee:${input.employeeId}`,
  });
}
