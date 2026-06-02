// Azure OpenAI client for the Foundry deployment behind disableLocalAuth.
// Uses DefaultAzureCredential → AAD bearer with caching + refresh-on-401.
//
// Surfaces a single `streamChatCompletion()` that consumes OpenAI Chat
// Completions payloads (including tool_calls) and yields incremental
// `ChatStreamEvent`s. The agent loop in query.ts uses these to drive
// Claude-shaped events back out to the runners.

import { AzureOpenAI } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions/completions";
import { DefaultAzureCredential, type AccessToken } from "@azure/identity";

const SCOPE = "https://cognitiveservices.azure.com/.default";

let _credential: DefaultAzureCredential | null = null;
let _cachedToken: AccessToken | null = null;

function getCredential(): DefaultAzureCredential {
  if (!_credential) {
    _credential = new DefaultAzureCredential({
      tenantId: process.env.AZURE_TENANT_ID,
    });
  }
  return _credential;
}

async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  // refresh 60s before expiry
  if (
    !force &&
    _cachedToken &&
    _cachedToken.expiresOnTimestamp &&
    _cachedToken.expiresOnTimestamp - 60_000 > now
  ) {
    return _cachedToken.token;
  }
  const cred = getCredential();
  const token = await cred.getToken(SCOPE);
  if (!token) {
    throw new Error(
      "Could not acquire Azure AD token for Azure OpenAI. Check AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET (or az login)."
    );
  }
  _cachedToken = token;
  return token.token;
}

let _client: AzureOpenAI | null = null;
let _clientFingerprint = "";

function getClient(): AzureOpenAI {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o";
  if (!endpoint) {
    throw new Error(
      "AZURE_OPENAI_ENDPOINT is not set. Add it to .env.local (e.g. https://agent-builder-foundry.cognitiveservices.azure.com/)."
    );
  }
  const fingerprint = `${endpoint}|${apiVersion}|${deployment}`;
  if (_client && _clientFingerprint === fingerprint) return _client;

  _client = new AzureOpenAI({
    endpoint,
    apiVersion,
    deployment,
    azureADTokenProvider: () => getAccessToken(),
  });
  _clientFingerprint = fingerprint;
  return _client;
}

export function isAzureOpenAIConfigured(): boolean {
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_TENANT_ID
  );
}

// ─── Streamed event shape ────────────────────────────────────────────────────

export type ChatStreamEvent =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_call_start"; index: number; id: string; name: string }
  | { kind: "tool_call_args_delta"; index: number; argsDelta: string }
  | {
      kind: "done";
      finishReason: "stop" | "length" | "tool_calls" | "content_filter" | string;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      toolCalls: Array<{ id: string; name: string; arguments: string }>;
    }
  | { kind: "error"; message: string; status?: number };

export type StreamChatArgs = {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  maxCompletionTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  /** Override the deployment name (e.g. for cheaper models on subagents). */
  modelOverride?: string;
  /** Maps to OpenAI's `response_format` (json_object or json_schema). */
  responseFormat?: {
    type: "json_object" | "json_schema";
    schema?: unknown;
  };
};

/**
 * Stream a chat completion from Azure OpenAI. Yields incremental events as
 * the model produces text and tool calls. Handles 401 once by refreshing the
 * bearer token transparently.
 */
export async function* streamChatCompletion(
  args: StreamChatArgs
): AsyncIterable<ChatStreamEvent> {
  const tries = [false, true]; // first attempt + one refresh retry on 401
  let lastErr: unknown = null;

  for (const isRetry of tries) {
    if (isRetry) {
      await getAccessToken(true); // force refresh
      _client = null; // rebuild client so it picks up the new token
    }

    try {
      const client = getClient();
      const stream = await client.chat.completions.create(
        {
          // gpt-4o deployment (gpt-5.1 under it) — set via env-driven deployment
          model: args.modelOverride ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
          messages: args.messages,
          ...(args.tools && args.tools.length > 0
            ? { tools: args.tools, tool_choice: args.toolChoice ?? "auto" }
            : {}),
          // gpt-5.1 rejects max_tokens — uses max_completion_tokens.
          max_completion_tokens: args.maxCompletionTokens ?? 4096,
          // temperature: omit. gpt-5.1 only supports the default (1).
          stream: true,
          stream_options: { include_usage: true },
          ...(args.responseFormat
            ? {
                response_format:
                  args.responseFormat.type === "json_schema" && args.responseFormat.schema
                    ? {
                        type: "json_schema" as const,
                        json_schema: {
                          name: "structured_output",
                          schema: args.responseFormat.schema as Record<string, unknown>,
                          strict: true,
                        },
                      }
                    : { type: "json_object" as const },
              }
            : {}),
        },
        { signal: args.abortSignal }
      );

      // Accumulate tool_calls as the model streams them — OpenAI sends args
      // as multiple chunks per index.
      const toolCallsByIndex: Record<
        number,
        { id: string; name: string; arguments: string }
      > = {};
      let finishReason: string | undefined;
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          // usage frames come without choices
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }
          continue;
        }
        const delta = choice.delta as {
          content?: string | null;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: "function";
            function?: { name?: string; arguments?: string };
          }>;
        };
        if (delta.content) {
          yield { kind: "text_delta", text: delta.content };
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const slot =
              toolCallsByIndex[idx] ??
              (toolCallsByIndex[idx] = { id: "", name: "", arguments: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) {
              if (!slot.name) {
                slot.name = tc.function.name;
                yield {
                  kind: "tool_call_start",
                  index: idx,
                  id: slot.id || `call_${idx}`,
                  name: slot.name,
                };
              } else {
                slot.name = tc.function.name;
              }
            }
            if (tc.function?.arguments) {
              slot.arguments += tc.function.arguments;
              yield {
                kind: "tool_call_args_delta",
                index: idx,
                argsDelta: tc.function.arguments,
              };
            }
          }
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      const sortedCalls = Object.keys(toolCallsByIndex)
        .map(Number)
        .sort((a, b) => a - b)
        .map((i) => toolCallsByIndex[i])
        .map((c) => ({
          id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: c.name,
          arguments: c.arguments,
        }));

      yield {
        kind: "done",
        finishReason: finishReason ?? "stop",
        usage,
        toolCalls: sortedCalls,
      };
      return;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      // Retry once on 401 (token expired between issuance and use).
      if (!isRetry && status === 401) {
        continue;
      }
      const message =
        err instanceof Error ? err.message : String(err);
      yield { kind: "error", message, status };
      return;
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  yield { kind: "error", message };
}

/**
 * Non-streaming helper used by intent-planner and other "one-shot completion"
 * call sites. Returns just the assistant text.
 */
export async function completeChat(
  args: Omit<StreamChatArgs, "tools" | "toolChoice"> & {
    jsonResponse?: boolean;
  }
): Promise<string> {
  const tries = [false, true];
  let lastErr: unknown = null;
  for (const isRetry of tries) {
    if (isRetry) {
      await getAccessToken(true);
      _client = null;
    }
    try {
      const client = getClient();
      const res = await client.chat.completions.create(
        {
          model: args.modelOverride ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
          messages: args.messages,
          max_completion_tokens: args.maxCompletionTokens ?? 1024,
          stream: false,
          ...(args.jsonResponse
            ? { response_format: { type: "json_object" } }
            : {}),
        },
        { signal: args.abortSignal }
      );
      return res.choices[0]?.message?.content ?? "";
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (!isRetry && status === 401) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
