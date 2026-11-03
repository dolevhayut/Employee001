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
//   - Claude Code's own WebFetch, WebSearch, Read and Grep return web pages
//     and file text (a configured knowledge folder holds the user's own
//     files, never cleaned on the way in). A second PostToolUse hook rewrites
//     their output with updatedToolOutput, the SDK field that works for
//     built-in tools. The runtime checks a rewrite against the tool's output
//     shape and keeps the original if it doesn't match, so the response is
//     cleaned in place (every string, same keys and types), never rebuilt.

import type { HookCallback, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { stripHiddenChars, stripHiddenCharsDeep } from "./hidden-chars";
import { auditHiddenCharsRemoved, type HiddenCharSource } from "./hidden-chars-audit";

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

/** Built-in tools whose output is outside text: the audit source, and the
 *  tool input field that names what was fetched or read (for the audit ref). */
const CLEANED_BUILTIN_TOOLS = new Map<string, { source: HiddenCharSource; refKey: string; inputKey: string }>([
  ["WebFetch", { source: "web-tool", refKey: "url", inputKey: "url" }],
  ["WebSearch", { source: "web-tool", refKey: "query", inputKey: "query" }],
  ["Read", { source: "file-tool", refKey: "file", inputKey: "file_path" }],
  ["Grep", { source: "file-tool", refKey: "path", inputKey: "path" }],
]);

/**
 * PostToolUse hook: clean the output of Claude Code's WebFetch, WebSearch,
 * Read and Grep before the model sees it, audited as `web-tool` or
 * `file-tool`. Every Read and Grep is covered, not only those inside a
 * configured folder: membership would have to be resolved again here (cwd,
 * symlinks), and text the app already cleaned has nothing to remove, so it
 * is never rewritten. Like the MCP hook, it returns a rewrite only when
 * something was removed, and the two hooks never handle the same tool.
 */
export function buildCleanBuiltinToolOutputHook(employeeId: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const post = input as PostToolUseHookInput;
    const tool = CLEANED_BUILTIN_TOOLS.get(post.tool_name);
    if (!tool) return {};
    const clean = stripHiddenCharsDeep(post.tool_response);
    if (clean.total === 0) return {};
    try {
      const target = (post.tool_input as Record<string, unknown> | null | undefined)?.[tool.inputKey];
      // The reference can carry hidden characters too: log it cleaned.
      const ref = typeof target === "string" ? { [tool.refKey]: stripHiddenChars(target).text } : {};
      auditHiddenCharsRemoved({ source: tool.source, employeeId, removed: clean.removed, ref: { tool: post.tool_name, ...ref } });
    } catch {
      /* the audit is best-effort; the cleaning is not */
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        updatedToolOutput: clean.value,
      },
    };
  };
}
