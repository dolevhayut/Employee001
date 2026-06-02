// Drop-in shim for `@anthropic-ai/claude-agent-sdk`. Wired via tsconfig paths
// so any `import { ... } from "@anthropic-ai/claude-agent-sdk"` resolves here.
//
// Runtime: Azure OpenAI gpt-4o (gpt-5.1) behind DefaultAzureCredential.
// API surface: matches the subset of the Claude Agent SDK that Employee001
// actually imports — query, createSdkMcpServer, tool, session helpers, and
// all the structural types.

export { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./query";
export { createSdkMcpServer, tool } from "./mcp-server";
export {
  listSessions,
  getSessionMessages,
  getSessionInfo,
  renameSession,
  tagSession,
  deleteSession,
  forkSession,
} from "./sessions";

export type {
  // Permissions
  CanUseTool,
  PermissionResult,
  PermissionResultAllow,
  PermissionResultDeny,

  // Hooks
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  NotificationHookInput,
  StopHookInput,

  // MCP
  McpServerConfig,
  McpSdkServerConfigWithInstance,
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
  McpToolDefinition,
  McpToolHandler,

  // Agent surface
  AgentDefinition,
  Options,
  EffortLevel,
  SdkBeta,

  // Messages / sessions
  SDKMessage,
  SystemInitMessage,
  StreamEventMessage,
  AssistantMessage,
  UserMessage,
  ResultMessage,
  SDKSessionInfo,
  SessionMessage,
} from "./types";
