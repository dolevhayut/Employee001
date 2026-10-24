// What a twin may do, given the consent its employee recorded.
//
// The onboarding wizard records { grantedAt, version, scopes } on the
// employee (since 71fbff1). This module turns those scopes into rules:
//   data-collection + integrations  → the twin may be trained (built/rebuilt)
//   integrations                    → personal Composio toolkits are loaded
//   transcripts                     → meeting/recording toolkits are loaded
//   third-party-actions             → the twin may act (send, post, create…)
//
// Deny by default: a twin with no record is "consent_required". It can't be
// trained, loads none of the employee's tools (transcripts included) and
// can't act through their accounts until the employee records consent. The
// UI shows a banner and the re-consent invite. Marketplace hires and the
// synthetic demo fixture (employee.json "synthetic": true) aren't people, so
// consent doesn't apply to them.

import type { ConsentScope, EmployeeConsent } from "./employees";
import type { ToolDecision } from "./tool-policy";

export type ConsentStatus =
  | { kind: "exempt"; reason: "marketplace" | "synthetic" }
  | { kind: "consent_required" }
  | { kind: "recorded"; scopes: ReadonlySet<ConsentScope> };

/** Toolkits whose data is meeting audio, video or transcripts. */
export const TRANSCRIPT_TOOLKITS = new Set([
  "zoom",
  "meet",
  "googlemeet",
  "google_meet",
  "microsoft_teams",
  "teams",
  "fireflies",
  "otter",
  "gong",
  "fathom",
  "tldv",
  "read_ai",
  "grain",
  "avoma",
]);

export function consentStatusFor(
  employee: { consent?: EmployeeConsent | null; synthetic?: boolean },
  isMarketplaceHire: boolean,
): ConsentStatus {
  if (isMarketplaceHire) return { kind: "exempt", reason: "marketplace" };
  if (employee.synthetic === true) return { kind: "exempt", reason: "synthetic" };
  const scopes = employee.consent?.scopes;
  if (!Array.isArray(scopes)) return { kind: "consent_required" };
  return { kind: "recorded", scopes: new Set(scopes) };
}

/** Granted only by an exemption or a recorded scope. No record, no grant. */
const has = (status: ConsentStatus, scope: ConsentScope) =>
  status.kind === "exempt" || (status.kind === "recorded" && status.scopes.has(scope));

/** Why the twin can't be trained right now, or null if it can. */
export function buildBlockReason(status: ConsentStatus, name: string): string | null {
  if (status.kind === "exempt") return null;
  if (status.kind === "consent_required") {
    return `${name} hasn't recorded consent, so the twin can't be trained on their data. Request consent from their profile first.`;
  }
  // Training needs data-collection. Reading their connected tools also needs
  // "integrations", but that's enforced per toolkit (toolkitAllowed), so a
  // twin built only from what the person wrote and uploaded doesn't need it.
  if (!status.scopes.has("data-collection")) {
    return `${name}'s consent doesn't cover training on their work data.`;
  }
  return null;
}

/** May the twin use this personal Composio toolkit? */
export function toolkitAllowed(status: ConsentStatus, toolkit: string): boolean {
  if (!has(status, "integrations")) return false;
  if (TRANSCRIPT_TOOLKITS.has(toolkit.toLowerCase()) && !has(status, "transcripts")) return false;
  return true;
}

/** May the twin act (send, post, change) through the employee's accounts? */
export function actionsAllowed(status: ConsentStatus): boolean {
  return has(status, "third-party-actions");
}

/** The employee's own accounts: their personal Composio server. Org-wide MCP
 *  servers and web fetches aren't the employee acting, so the normal
 *  approval gate covers them. */
function actsThroughEmployeeAccounts(toolName: string): boolean {
  return /^mcp__composio__/i.test(toolName);
}

/** Tighten a tool-policy decision with the employee's consent: without
 *  "third-party-actions", any action through the employee's own accounts that
 *  would need approval is refused instead. Reads (auto-allowed) are unaffected. */
export function applyConsent(decision: ToolDecision, toolName: string, status: ConsentStatus): ToolDecision {
  if (decision.kind === "block" || !actsThroughEmployeeAccounts(toolName)) return decision;
  // No consent at all: nothing runs through the employee's accounts, reads
  // included (normally their toolkits aren't even loaded; this is the backstop).
  if (status.kind === "consent_required") {
    return { kind: "block", reason: "This employee hasn't recorded consent, so the twin can't use their accounts." };
  }
  if (decision.kind !== "ask" || has(status, "third-party-actions")) {
    return decision;
  }
  return {
    kind: "block",
    reason: "This employee's consent doesn't let the twin act on their behalf (send, post or change anything).",
  };
}
