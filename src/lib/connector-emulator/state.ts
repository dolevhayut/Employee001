// Emulator state in the workspace (data/connector-emulator/): which E001
// employee is which CompanySim person, the outbox of everything "sent", and a
// log of every call. All of it lives in EMPLOYEE001_HOME, so an eval's
// throwaway workspace gets its own.

import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/app-home";

export const EMULATED_TOOLKITS = ["gmail", "outlook", "slack", "jira", "googledrive", "share_point", "microsoft_teams"] as const;
export type EmulatedToolkit = (typeof EMULATED_TOOLKITS)[number];

export type EmulatorConfig = {
  /** E001 employee id → the CompanySim person whose accounts they connected. */
  employees: Record<string, { personId: string; toolkits?: EmulatedToolkit[] }>;
};

const file = (...parts: string[]) => dataDir("connector-emulator", ...parts);

export function loadEmulatorConfig(): EmulatorConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(file("config.json"), "utf8")) as EmulatorConfig;
    return { employees: raw.employees ?? {} };
  } catch {
    return { employees: {} };
  }
}

export function saveEmulatorConfig(config: EmulatorConfig): void {
  fs.mkdirSync(file(), { recursive: true });
  fs.writeFileSync(file("config.json"), JSON.stringify(config, null, 2) + "\n");
}

/** Map one employee (merging into the existing config). */
export function connectEmulatedEmployee(employeeId: string, personId: string, toolkits?: EmulatedToolkit[]): void {
  const config = loadEmulatorConfig();
  config.employees[employeeId] = { personId, ...(toolkits ? { toolkits } : {}) };
  saveEmulatorConfig(config);
}

export function emulatedAccount(employeeId: string): { personId: string; toolkits: EmulatedToolkit[] } | null {
  const entry = loadEmulatorConfig().employees[employeeId];
  if (!entry?.personId) return null;
  return { personId: entry.personId, toolkits: entry.toolkits?.length ? entry.toolkits : [...EMULATED_TOOLKITS] };
}

export type OutboxEntry = {
  id: string;
  at: string;
  employeeId: string;
  personId: string;
  toolkit: string;
  slug: string;
  /** The arguments as executed: after canUseTool, approval edits and the disclosure hook. */
  arguments: Record<string, unknown>;
  result: unknown;
};

export function readOutbox(): OutboxEntry[] {
  try {
    return JSON.parse(fs.readFileSync(file("outbox.json"), "utf8")) as OutboxEntry[];
  } catch {
    return [];
  }
}

export function appendOutbox(entry: OutboxEntry): void {
  const all = readOutbox();
  all.push(entry);
  fs.mkdirSync(file(), { recursive: true });
  const target = file("outbox.json");
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n");
  fs.renameSync(tmp, target);
}

export type CallLogEntry = {
  at: string;
  employeeId: string;
  slug: string;
  arguments: Record<string, unknown>;
  successful: boolean;
  error?: string;
  /** Argument names the captured contract doesn't define (a real call may reject or drop them). */
  unknownArguments?: string[];
};

export function appendCallLog(entry: CallLogEntry): void {
  fs.mkdirSync(file(), { recursive: true });
  fs.appendFileSync(file("calls.jsonl"), JSON.stringify(entry) + "\n");
}

export function readCallLog(): CallLogEntry[] {
  try {
    return fs.readFileSync(file("calls.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CallLogEntry);
  } catch {
    return [];
  }
}

/** Contracts live in the repo (evals/connectors/contracts); never shipped. */
export function contractsDir(): string {
  return process.env.EMPLOYEE001_CONNECTOR_CONTRACTS ?? path.join(process.cwd(), "evals", "connectors", "contracts");
}
