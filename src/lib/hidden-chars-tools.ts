// Hidden-character cleaning for tool results: what a connected tool (Gmail,
// Slack, tickets, an org MCP server) returns is outside text, and it reaches
// the twin without passing intake.
//
//   - Composio tools run in-process, so each handler is wrapped and its
//     CallToolResult (text content and structuredContent alike) is cleaned
//     before the SDK sees it.
//   - Org custom MCP servers are remote: the SDK talks to them directly. A
//     PostToolUse hook rewrites their output instead (the SDK's
//     updatedMCPToolOutput), only when something was actually removed.

import type { HookCallback, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { stripHiddenChars, stripHiddenCharsDeep } from "./hidden-chars";
import { auditHiddenCharsRemoved } from "./hidden-chars-audit";

type ToolHandler = (args: never, extra: unknown) => Promise<unknown>;
type ToolLike = { name: string; handler: ToolHandler };

/**
 * Wrap each tool's handler so its result is cleaned of invisible characters
 * before the twin reads it; each removal is audited as `composio-tool` with
 * the tool name (counts only). A thrown error's message is cleaned too.
 */
export function withHiddenCharCleaning<T extends ToolLike>(tools: readonly T[], employeeId: string): T[] {
  return tools.map((tool) => {
    const handler = tool.handler;
    const wrapped = async (args: never, extra: unknown) => {
      let result: unknown;
      try {
        result = await handler(args, extra);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const clean = stripHiddenChars(err.message);
        if (clean.total === 0) throw err;
        auditHiddenCharsRemoved({ source: "composio-tool", employeeId, removed: clean.removed, ref: { tool: tool.name } });
        throw new Error(clean.text);
      }
      const clean = stripHiddenCharsDeep(result);
      if (clean.total === 0) return result;
      auditHiddenCharsRemoved({ source: "composio-tool", employeeId, removed: clean.removed, ref: { tool: tool.name } });
      return clean.value;
    };
    return { ...tool, handler: wrapped as T["handler"] };
  });
}

/**
 * PostToolUse hook: clean the output of every MCP tool (`mcp__*`) before
 * the model sees it, audited as `mcp-tool`. Returns a rewrite only when
 * something was removed: hooks run in parallel on the original output, so
 * an identity rewrite could clobber another hook's real one. Composio
 * results are already clean by then, so they pass through unchanged.
 */
export function buildCleanMcpOutputHook(employeeId: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const post = input as PostToolUseHookInput;
    if (!post.tool_name.startsWith("mcp__")) return {};
    const clean = stripHiddenCharsDeep(post.tool_response);
    if (clean.total === 0) return {};
    try {
      auditHiddenCharsRemoved({ source: "mcp-tool", employeeId, removed: clean.removed, ref: { tool: post.tool_name } });
    } catch {
      /* the audit is best-effort; the cleaning is not */
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        updatedMCPToolOutput: clean.value,
      },
    };
  };
}
