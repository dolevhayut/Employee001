// What a twin may do, given the consent its employee recorded.
//
// The onboarding wizard records { grantedAt, version, scopes } on the
// employee (since 71fbff1). This module turns those scopes into rules:
//   data-collection + integrations  → the twin may be trained (built/rebuilt)
//   integrations                    → personal Composio toolkits are loaded
//   transcripts                     → meeting/recording toolkits are loaded
//   third-party-actions             → the twin may act (send, post, create…)
//
// Twins with no record are "legacy" (created before consent was recorded, or
// the demo twins): they keep running as before, the profile shows "Consent not
// on file", and they can't be retrained until consent is requested. Marketplace
// hires are not people, so consent doesn't apply to them.

import type { ConsentScope, EmployeeConsent } from "./employees";
import type { ToolDecision } from "./tool-policy";

export type ConsentStatus =
  | { kind: "exempt" }
  | { kind: "legacy" }
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
  employee: { consent?: EmployeeConsent | null },
  isMarketplaceHire: boolean,
): ConsentStatus {
  if (isMarketplaceHire) return { kind: "exempt" };
  const scopes = employee.consent?.scopes;
  if (!Array.isArray(scopes)) return { kind: "legacy" };
  return { kind: "recorded", scopes: new Set(scopes) };
}

const has = (status: ConsentStatus, scope: ConsentScope) =>
  status.kind !== "recorded" || status.scopes.has(scope);

/** Why the twin can't be trained right now, or null if it can. */
export function buildBlockReason(status: ConsentStatus, name: string): string | null {
  if (status.kind === "exempt") return null;
  if (status.kind === "legacy") {
    return `${name} hasn't recorded consent, so the twin can't be trained on their data. Request consent from their profile first.`;
  }
  if (!status.scopes.has("data-collection") || !status.scopes.has("integrations")) {
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
  if (decision.kind !== "ask" || has(status, "third-party-actions") || !actsThroughEmployeeAccounts(toolName)) {
    return decision;
  }
  return {
    kind: "block",
    reason: "This employee's consent doesn't let the twin act on their behalf (send, post or change anything).",
  };
}
