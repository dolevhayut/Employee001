// Everything the Relay screens need about one twin's handover, in one read.

import "server-only";
import fs from "fs/promises";
import { dataDir } from "../app-home";
import { loadLifecycle, type LifecycleState } from "../twin-lifecycle";
import { scoreCoverage, type CoverageResult } from "./coverage";
import { relayModelReady } from "./model";
import { loadInterview, loadPackage, packageDigest, type InterviewMessage } from "./package-store";
import type { RoleContextPackage } from "./rcp.types";

export type HandoverState = LifecycleState & {
  employeeId: string;
  name: string;
  role: string;
  messages: InterviewMessage[];
  package: RoleContextPackage | null;
  /** Sent back with an approval: the server refuses if the notes changed. */
  packageDigest: string | null;
  coverage: CoverageResult | null;
  model: { ok: true } | { ok: false; reason: string };
};

/** Twin ids are directory names under data/employees. */
export const isTwinId = (id: string) => /^[a-z0-9_][a-z0-9_-]{1,63}$/.test(id) && !id.includes("..");

export async function loadHandoverState(employeeId: string): Promise<HandoverState | null> {
  if (!isTwinId(employeeId)) return null;
  let sidecar: { name?: string; role?: string | null };
  try {
    sidecar = JSON.parse(await fs.readFile(dataDir("employees", employeeId, "employee.json"), "utf8"));
  } catch {
    return null;
  }
  const [lifecycle, messages, rcp] = await Promise.all([
    loadLifecycle(employeeId),
    loadInterview(employeeId),
    loadPackage(employeeId),
  ]);
  return {
    ...lifecycle,
    employeeId,
    name: sidecar.name ?? employeeId,
    role: sidecar.role || "",
    messages,
    package: rcp,
    packageDigest: rcp ? packageDigest(rcp) : null,
    coverage: rcp ? scoreCoverage(rcp) : null,
    model: relayModelReady(),
  };
}
