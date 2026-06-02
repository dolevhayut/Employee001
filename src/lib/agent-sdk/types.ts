// Type surface of the Claude Agent SDK that the Employee001 codebase actually
// imports. This shim re-exports them so the rest of the code can keep using
// `import type { ... } from "@anthropic-ai/claude-agent-sdk"` unchanged, while
// the runtime swaps Anthropic for Azure OpenAI gpt-4o under the hood.
//
// The shapes here are intentionally narrow — we only define what's consumed.
// Anything not listed is "we don't use it; if the SDK had it, the shim
// doesn't promise it."

import type { z } from "zod";

export type EffortLevel = "low" | "medium" | "high";
export type SdkBeta = string;

export type PermissionResultAllow = {
  behavior: "allow";
  updatedInput?: unknown;
};
export type PermissionResultDeny = {
  behavior: "deny";
  message: string;
};
export type PermissionResult = PermissionResultAllow | PermissionResultDeny;

export type CanUseTool = (
  toolName: string,
  input: unknown
) => Promise<PermissionResult>;

// ─── Hook event surface ──────────────────────────────────────────────────────

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "Stop"
  | "UserPromptSubmit";

export type BaseHookInput = {
  hook_event_name: HookEvent;
  agent_id?: string;
  agent_type?: string;
};

export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
};
export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: unknown;
  duration_ms?: number;
};
export type NotificationHookInput = BaseHookInput & {
  hook_event_name: "Notification";
  notification_type: string;
  message: string;
  title?: string;
};
export type StopHookInput = BaseHookInput & {
  hook_event_name: "Stop";
  stop_hook_active?: boolean;
};

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | NotificationHookInput
  | StopHookInput;

export type HookCallback = (
  input: HookInput
) => Promise<HookCallbackResult>;

export type HookCallbackResult = {
  hookSpecificOutput?:
    | {
        hookEventName: "PreToolUse";
        permissionDecision?: "allow" | "deny";
        permissionDecisionReason?: string;
        updatedInput?: Record<string, unknown>;
      }
    | {
        hookEventName: "PostToolUse";
        additionalContext?: string;
      };
};

export type HookCallbackMatcher = {
  matcher?: string;
  hooks: HookCallback[];
};

// ─── MCP server surface ──────────────────────────────────────────────────────

export type McpToolHandler = (
  input: Record<string, unknown>
) => Promise<{
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}>;

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: McpToolHandler;
};

export type McpSdkServerConfigWithInstance = {
  type: "sdk";
  name: string;
  version?: string;
  instance: {
    tools: McpToolDefinition[];
  };
};

export type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};
export type McpSSEServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};
export type McpStdioServerConfig = {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpServerConfig =
  | McpSdkServerConfigWithInstance
  | McpHttpServerConfig
  | McpSSEServerConfig
  | McpStdioServerConfig;

// ─── Agent (Task tool) definitions ──────────────────────────────────────────

export type AgentDefinition = {
  description: string;
  tools?: string[];
  model?: string;
  effort?: EffortLevel;
  prompt: string;
};

// ─── Options passed to query() ──────────────────────────────────────────────

export type Options = {
  model?: string;
  fallbackModel?: string;
  effort?: EffortLevel;
  thinking?: { type: "adaptive" | "off" | "deep" };
  disallowedTools?: string[];
  betas?: SdkBeta[];
  env?: Record<string, string | undefined>;
  abortController?: AbortController;
  title?: string;
  promptSuggestions?: boolean;
  agentProgressSummaries?: boolean;
  strictMcpConfig?: boolean;
  cwd?: string;
  systemPrompt?: string | string[];
  allowedTools?: string[];
  agents?: Record<string, AgentDefinition>;
  toolConfig?: Record<string, unknown>;
  mcpServers?: Record<string, McpServerConfig>;
  maxTurns?: number;
  maxBudgetUsd?: number;
  includePartialMessages?: boolean;
  permissionMode?: "default" | "bypassPermissions";
  canUseTool?: CanUseTool;
  settingSources?: string[];
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  resume?: string;
  forkSession?: boolean;
  /**
   * Forwarded by intent-planner / org-brain-builder for structured outputs.
   * Maps to `response_format: { type: "json_object" | "json_schema" }` on the
   * Azure OpenAI side. Accepted at the call site even if not yet wired end
   * to end — feature-flagged for downstream surfaces that need it.
   */
  outputFormat?: {
    type: "json_object" | "json_schema";
    schema?: unknown;
  };
  /**
   * Turn on file checkpointing for long-running builder runs. Surfaced for
   * compatibility with twin-builder — the Azure port keeps its own append-
   * only run log via `appendRunLog`, so this is a no-op at the SDK layer.
   */
  enableFileCheckpointing?: boolean;
  /**
   * Passthrough escape hatch used by twin-builder for SDK-specific extras
   * like "replay-user-messages". Unused in the Azure port (no replay
   * mechanic at the LLM layer), but accepted so call sites compile.
   */
  extraArgs?: Record<string, unknown>;
};

// ─── Streamed events yielded by query() ─────────────────────────────────────
//
// These mirror Anthropic Claude Agent SDK's `SDKMessage` shape closely enough
// that downstream consumers (council-runner / shift-runner / twin-builder)
// work without modification.

export type SystemInitMessage = {
  type: "system";
  subtype: "init";
  session_id: string;
};

export type StreamEventMessage = {
  type: "stream_event";
  event:
    | {
        type: "content_block_delta";
        delta:
          | { type: "text_delta"; text: string }
          | { type: "thinking_delta"; thinking: string };
      }
    | { type: "message_start" }
    | { type: "message_stop" };
};

export type AssistantTextBlock = { type: "text"; text: string };
export type AssistantToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type AssistantBlock = AssistantTextBlock | AssistantToolUseBlock;

export type AssistantMessage = {
  type: "assistant";
  message: {
    role: "assistant";
    content: AssistantBlock[];
  };
};

export type UserToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: "text"; text: string }>;
  is_error?: boolean;
};

export type UserMessage = {
  type: "user";
  message: {
    role: "user";
    content: UserToolResultBlock[] | string;
  };
};

export type ResultMessage = {
  type: "result";
  subtype?: "success" | "error_max_turns" | "error_max_budget_usd" | "error_during_execution";
  num_turns?: number;
  total_cost_usd?: number;
  is_error?: boolean;
  errors?: string[];
  api_error_status?: number | null;
};

export type SDKMessage =
  | SystemInitMessage
  | StreamEventMessage
  | AssistantMessage
  | UserMessage
  | ResultMessage;

// ─── Session helpers ────────────────────────────────────────────────────────

export type SDKSessionInfo = {
  sessionId: string;
  cwd?: string;
  title?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type SessionMessage = {
  role: "user" | "assistant" | "system";
  content: unknown;
  ts?: string;
};
