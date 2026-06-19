// Public-facing LLM client shim. Re-exports the internal Azure OpenAI client
// so call sites outside the agent-sdk shim can stream completions directly
// (e.g. employee-intent-planner, twin-build-runner) without reaching into
// the shim's private modules.

export {
  streamChatCompletion,
  completeChat,
  isAzureOpenAIConfigured,
  type ChatStreamEvent,
  type StreamChatArgs,
} from "@/lib/agent-sdk/llm-client";
