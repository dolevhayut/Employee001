import fs from "fs";
import { dataDir } from "./app-home";
import { appendAuditEntry } from "./audit-log";
import { describeHiddenChars, hiddenCharTotal, stripHiddenChars, type HiddenCharCounts } from "./hidden-chars";

/** Where the cleaned text came from. */
export type HiddenCharSource =
  | "email"
  | "slack"
  | "slack-thread"
  | "knowledge-upload"
  | "knowledge-extract"
  | "knowledge-write"
  | "mcp-ask_twin"
  | "mcp"
  | "focus-preload"
  | "composio-tool"
  | "mcp-tool"
  | "knowledge-restore"
  | "org-skill-write"
  | "org-brain-write";

/** Audit owner for org-level writes (Org Brain, org skills): no employee. */
export const ORG_AUDIT_EMPLOYEE_ID = "org";

export const HIDDEN_CHARS_AUDIT_TOOL = "inboundHiddenCharsRemoved";

function employeeName(employeeId: string): string {
  if (employeeId === ORG_AUDIT_EMPLOYEE_ID) return "Organization";
  try {
    const raw = JSON.parse(fs.readFileSync(dataDir("employees", employeeId, "employee.json"), "utf8")) as { name?: unknown };
    return typeof raw.name === "string" && raw.name.trim() ? raw.name : employeeId;
  } catch {
    return employeeId;
  }
}

/**
 * Record in the hash-chained audit log that invisible characters were removed
 * from inbound text before a twin could read it. Only the counts and a
 * reference (work item, file name, message id) are kept, never the text:
 * the hidden payload itself must not be stored anywhere.
 */
export function auditHiddenCharsRemoved(input: {
  source: HiddenCharSource;
  employeeId: string;
  removed: HiddenCharCounts;
  ref?: Record<string, string | undefined>;
}): void {
  const total = hiddenCharTotal(input.removed);
  if (total === 0) return;
  const ref: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.ref ?? {})) if (typeof value === "string") ref[key] = value;
  appendAuditEntry({
    runId: `hidden-chars-${Date.now()}`,
    employeeId: input.employeeId,
    employeeName: employeeName(input.employeeId),
    toolName: HIDDEN_CHARS_AUDIT_TOOL,
    bareName: HIDDEN_CHARS_AUDIT_TOOL,
    input: {
      source: input.source,
      ...ref,
      removed: { ...input.removed },
      total,
      reason: `Removed ${describeHiddenChars(input.removed)} hidden character(s) from inbound ${input.source} text before a twin read it (possible prompt injection).`,
    },
    verdict: "executed",
    approvedBy: "policy:strip-hidden-chars",
    approvalChannel: "policy",
  });
}

/**
 * Clean one piece of untrusted text and audit the removal (counts and `ref`
 * only). The shared wrapper for write paths: returns the cleaned text.
 */
export function stripHiddenCharsAudited(
  text: string,
  audit: { source: HiddenCharSource; employeeId: string; ref?: Record<string, string | undefined> },
): { text: string; removed: HiddenCharCounts; total: number } {
  const result = stripHiddenChars(text);
  if (result.total > 0) auditHiddenCharsRemoved({ ...audit, removed: result.removed });
  return result;
}
