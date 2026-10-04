// Server-only persistence for an employee's explicit tool-policy choices.

import "server-only";
import fs from "fs/promises";
import path from "path";
import { withSidecarLock } from "./sidecar-lock";

export type ToolPolicyOverride = "allow" | "ask" | "off";
export type ToolPolicyOverrides = Record<string, ToolPolicyOverride>;

// Keep the data-root decision in one place so moving to dataDir() is a
// one-line change.
function employeeDataDir(employeeId: string): string {
  return path.join(process.cwd(), "data", "employees", employeeId);
}

function overridesPath(employeeId: string): string {
  return path.join(employeeDataDir(employeeId), "tool-policy-overrides.json");
}

function validToolName(toolName: string): boolean {
  return toolName.trim().length > 0;
}

function sanitizeOverrides(value: unknown): ToolPolicyOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const overrides: ToolPolicyOverrides = {};
  for (const [toolName, override] of Object.entries(value)) {
    if (
      validToolName(toolName) &&
      (override === "allow" || override === "ask" || override === "off")
    ) {
      overrides[toolName] = override;
    }
  }
  return overrides;
}

async function readOverrides(employeeId: string): Promise<ToolPolicyOverrides> {
  try {
    return sanitizeOverrides(JSON.parse(await fs.readFile(overridesPath(employeeId), "utf8")));
  } catch {
    return {};
  }
}

async function writeOverrides(employeeId: string, overrides: ToolPolicyOverrides): Promise<void> {
  await fs.mkdir(employeeDataDir(employeeId), { recursive: true });
  await fs.writeFile(overridesPath(employeeId), JSON.stringify(overrides, null, 2), "utf8");
}

/** Return the valid persisted overrides for one employee. */
export async function getToolPolicyOverrides(employeeId: string): Promise<ToolPolicyOverrides> {
  return readOverrides(employeeId);
}

/** Set one explicit policy choice without dropping concurrent changes. */
export async function setToolPolicyOverride(
  employeeId: string,
  toolName: string,
  override: ToolPolicyOverride,
): Promise<void> {
  if (!validToolName(toolName)) throw new Error("Tool name is required.");

  await withSidecarLock(employeeId, async () => {
    const overrides = await readOverrides(employeeId);
    overrides[toolName] = override;
    await writeOverrides(employeeId, overrides);
  });
}

/** Remove one explicit choice, returning the tool to the standard policy. */
export async function clearToolPolicyOverride(employeeId: string, toolName: string): Promise<void> {
  if (!validToolName(toolName)) return;

  await withSidecarLock(employeeId, async () => {
    const overrides = await readOverrides(employeeId);
    delete overrides[toolName];
    await writeOverrides(employeeId, overrides);
  });
}
