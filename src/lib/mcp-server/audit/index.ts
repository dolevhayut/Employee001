import { randomUUID } from "node:crypto";
import { appendAuditEntry } from "@/lib/audit-log";

// One audit row per MCP request: who (person id), when (the log stamps `ts`),
// and which tool. A JSON-RPC batch writes one row per call in it.

export const SHARED_TOKEN_IDENTITY = "shared-token";
export const UNAUTHENTICATED_IDENTITY = "unauthenticated";

const MAX_BODY_CHARS = 1_000_000;
const MAX_CALLS = 50;

/**
 * Tool (or protocol method) named by each JSON-RPC message in a request body.
 * Returns null when the request is too big to audit in full; the caller must
 * refuse it rather than run calls that have no audit row.
 */
export function toolsInBody(body: string): string[] | null {
  if (body.length > MAX_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return ["(unparseable request)"];
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (messages.length > MAX_CALLS) return null;
  const names: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
    if (typeof method !== "string") continue;
    const tool = method === "tools/call" && typeof params?.name === "string" ? params.name : method;
    names.push(tool.slice(0, 120));
  }
  return names.length > 0 ? names : ["(no method)"];
}

export type McpAuditOutcome = { verdict: "executed" } | { verdict: "hard_blocked"; reason: string };

/** Write one audit row per tool. Returns false if any row could not be written. */
export function auditMcpRequest(personId: string, tools: string[], outcome: McpAuditOutcome): boolean {
  let ok = true;
  for (const tool of tools) {
    const written = appendAuditEntry({
      runId: `mcp-${randomUUID()}`,
      employeeId: "mcp",
      employeeName: "mcp",
      toolName: `mcp__employee001__${tool}`,
      bareName: tool,
      input: { personId, tool },
      verdict: outcome.verdict,
      ...(outcome.verdict === "hard_blocked" ? { blockReason: outcome.reason } : {}),
      requesterId: personId,
    });
    if (!written) ok = false;
  }
  return ok;
}
