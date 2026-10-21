// Reads an employee's recorded consent from disk (see consent-policy.ts).

import "server-only";
import fs from "fs";
import { dataDir } from "./app-home";
import { consentStatusFor, type ConsentStatus } from "./consent-policy";
import type { EmployeeConsent } from "./employees";
import { getHiredAgentIds } from "./hired-agents";

export function loadConsentStatus(employeeId: string): ConsentStatus {
  let consent: EmployeeConsent | undefined;
  let synthetic = false;
  try {
    const sidecar = JSON.parse(fs.readFileSync(dataDir("employees", employeeId, "employee.json"), "utf8")) as {
      consent?: EmployeeConsent;
      synthetic?: unknown;
    };
    consent = sidecar.consent;
    synthetic = sidecar.synthetic === true;
  } catch {
    // No sidecar (marketplace hire or a missing twin): treat as no record.
  }
  return consentStatusFor({ consent, synthetic }, getHiredAgentIds().includes(employeeId));
}
