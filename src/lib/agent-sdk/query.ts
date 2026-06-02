// The Claude Agent SDK's `query()` reimplemented against Azure OpenAI.
//
// Yields Claude-shaped SDKMessage events so downstream consumers
// (council-runner, shift-runner, twin-builder) work without modification:
//
//   system(init) → stream_event(content_block_delta:text_delta)
//                → assistant{ tool_use blocks }
//                → user{ tool_result blocks }
//                → ... loop ...
//                → result{ num_turns, total_cost_usd, subtype }
//
// The loop:
//   1. Build OpenAI tool list from allowedTools (built-ins) + MCP servers.
//   2. Stream a completion. Emit text deltas live.
//   3. When the model emits tool_calls, run canUseTool → PreToolUse hooks
//      → execute (built-in or MCP) → PostToolUse hooks → emit tool_result.
//   4. Loop until no more tool_calls OR maxTurns reached OR maxBudgetUsd hit.
//   5. Emit result.

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions";
import { streamChatCompletion } from "./llm-client";
import { BUILTIN_TOOLS, type ToolHandlerCtx } from "./tools-builtin";
import { recordSessionMessage, ensureSessionId } from "./sessions";
import type {
  Options,
  SDKMessage,
  PermissionResult,
  HookCallback,
  HookCallbackResult,
  HookInput,
  HookCallbackMatcher,
  HookEvent,
  PreToolUseHookInput,
  PostToolUseHookInput,
  StopHookInput,
  McpSdkServerConfigWithInstance,
  AgentDefinition,
} from "./types";

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "<<<DYNAMIC_BOUNDARY>>>";

// Cost per 1k tokens for the gpt-4o deployment (gpt-5.1 pricing — rough).
// Used to enforce maxBudgetUsd; the actual Azure billing is the source of
// truth, this is just a guard.
const COST_PER_1K_PROMPT = 0.00125;
const COST_PER_1K_COMPLETION = 0.01;

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  // Duck-typed walker — works against both zod v3 and v4 by inspecting
  // `_def` (v3) and `_zod.def` (v4) rather than `instanceof` against a
  // possibly-mismatched runtime. The OpenAI SDK pins one major; the rest of
  // the project pins another. Avoid the version war by reading shapes.
  const s = schema as {
    _def?: { typeName?: string; innerType?: unknown; options?: unknown; values?: unknown; type?: unknown };
    _zod?: { def?: { type?: string } };
    shape?: Record<string, unknown>;
    element?: unknown;
    options?: unknown;
    description?: string;
    value?: unknown;
    isOptional?: () => boolean;
  };
  const def = s._def ?? {};
  const name = (s._zod?.def?.type ?? def.typeName ?? "").toString();

  if (name.includes("object") || s.shape) {
    const shape =
      s.shape ?? (def as { shape?: Record<string, unknown> }).shape ?? {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const inner = value as { isOptional?: () => boolean };
      properties[key] = zodToJsonSchema(value);
      try {
        if (!inner.isOptional?.()) required.push(key);
      } catch { /* assume required */ required.push(key); }
    }
    const out: Record<string, unknown> = { type: "object", properties };
    if (required.length > 0) out.required = required;
    return out;
  }
  if (name.includes("string")) {
    return s.description
      ? { type: "string", description: s.description }
      : { type: "string" };
  }
  if (name.includes("number")) return { type: "number" };
  if (name.includes("boolean")) return { type: "boolean" };
  if (name.includes("array")) {
    const element = s.element ?? (def as { type?: unknown }).type;
    return { type: "array", items: zodToJsonSchema(element) };
  }
  if (name.includes("enum")) {
    const values = (s.options as unknown[]) ??
      (def.values as unknown[]) ?? [];
    return { type: "string", enum: values };
  }
  if (name.includes("optional") || name.includes("nullable")) {
    return zodToJsonSchema(def.innerType);
  }
  if (name.includes("literal")) {
    return { const: s.value ?? (def as { value?: unknown }).value };
  }
  if (name.includes("record")) return { type: "object" };
  if (name.includes("union")) {
    const opts = (def.options as unknown[]) ?? [];
    return { anyOf: opts.map(zodToJsonSchema) };
  }
  return {};
}

function renderSystemPrompt(prompt: Options["systemPrompt"]): string {
  if (!prompt) return "";
  if (typeof prompt === "string") return prompt;
  return prompt.join("\n\n");
}

function buildToolset(
  options: Options
): {
  openAiTools: ChatCompletionTool[];
  resolveTool: (
    name: string
  ) =>
    | { kind: "builtin"; name: string }
    | { kind: "mcp"; server: string; tool: string }
    | null;
} {
  const allowed = new Set(options.allowedTools ?? []);
  const disallowed = new Set(options.disallowedTools ?? []);
  const openAiTools: ChatCompletionTool[] = [];
  const resolver = new Map<
    string,
    { kind: "builtin"; name: string } | { kind: "mcp"; server: string; tool: string }
  >();

  // Built-in tools
  for (const def of Object.values(BUILTIN_TOOLS)) {
    if (disallowed.has(def.name)) continue;
    if (allowed.size > 0 && !allowed.has(def.name)) continue;
    openAiTools.push(def.schema);
    resolver.set(def.name, { kind: "builtin", name: def.name });
  }

  // MCP server tools (in-process SDK servers only — http/sse/stdio out of scope here)
  for (const [serverName, config] of Object.entries(options.mcpServers ?? {})) {
    if (config.type !== "sdk") continue;
    const sdk = config as McpSdkServerConfigWithInstance;
    for (const tool of sdk.instance.tools) {
      const full = `mcp__${serverName}__${tool.name}`;
      if (disallowed.has(full)) continue;
      // mcp tools are always available unless explicitly disallowed; the
      // allowedTools list gates only built-ins (matching SDK behaviour for
      // MCP tools, which appear automatically).
      const params = zodToJsonSchema(tool.inputSchema);
      openAiTools.push({
        type: "function",
        function: {
          name: full,
          description: tool.description,
          parameters: params,
        },
      });
      resolver.set(full, { kind: "mcp", server: serverName, tool: tool.name });
    }
  }

  return {
    openAiTools,
    resolveTool: (name) => resolver.get(name) ?? null,
  };
}

async function fireHooks(
  hooks: Options["hooks"] | undefined,
  event: HookEvent,
  input: HookInput
): Promise<HookCallbackResult[]> {
  const results: HookCallbackResult[] = [];
  const matchers: HookCallbackMatcher[] = hooks?.[event] ?? [];
  for (const matcher of matchers) {
    for (const cb of matcher.hooks as HookCallback[]) {
      try {
        const out = await cb(input);
        results.push(out ?? {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[agent-sdk] hook ${event} failed: ${msg}`);
      }
    }
  }
  return results;
}

function findFirstPreToolUseDecision(
  results: HookCallbackResult[]
): { decision: "allow" | "deny"; reason?: string; updatedInput?: Record<string, unknown> } | null {
  for (const r of results) {
    const o = r.hookSpecificOutput;
    if (!o || o.hookEventName !== "PreToolUse") continue;
    if (o.permissionDecision) {
      return {
        decision: o.permissionDecision,
        reason: o.permissionDecisionReason,
        updatedInput: o.updatedInput,
      };
    }
    if (o.updatedInput) {
      return { decision: "allow", updatedInput: o.updatedInput };
    }
  }
  return null;
}

function gatherPostAdditionalContext(results: HookCallbackResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    const o = r.hookSpecificOutput;
    if (o && o.hookEventName === "PostToolUse" && o.additionalContext) {
      parts.push(o.additionalContext);
    }
  }
  return parts.join("\n");
}

// ─── Public surface: `query()` matching the SDK's signature ─────────────────

export function query(args: {
  prompt: string;
  options?: Options;
}): AsyncIterable<SDKMessage> {
  const { prompt, options = {} } = args;
  return queryStream(prompt, options);
}

async function* queryStream(
  initialPrompt: string,
  options: Options
): AsyncIterable<SDKMessage> {
  const sessionId = ensureSessionId(options.resume, options.forkSession);
  yield { type: "system", subtype: "init", session_id: sessionId };

  const systemPromptText = renderSystemPrompt(options.systemPrompt);
  const cleanedSystem = systemPromptText.replace(
    new RegExp(SYSTEM_PROMPT_DYNAMIC_BOUNDARY, "g"),
    ""
  );
  const messages: ChatCompletionMessageParam[] = [];
  if (cleanedSystem) messages.push({ role: "system", content: cleanedSystem });
  messages.push({ role: "user", content: initialPrompt });
  recordSessionMessage(sessionId, { role: "user", content: initialPrompt });

  const { openAiTools, resolveTool } = buildToolset(options);

  const maxTurns = options.maxTurns ?? 10;
  const maxBudget = options.maxBudgetUsd ?? Infinity;
  let turns = 0;
  let costUsd = 0;
  let stopSubtype: "success" | "error_max_turns" | "error_max_budget_usd" | "error_during_execution" =
    "success";
  let lastError: string | null = null;

  const baseCtx: ToolHandlerCtx = {
    cwd: options.cwd ?? process.cwd(),
    abortSignal: options.abortController?.signal,
    agents: options.agents,
    askUserQuestion: undefined, // bound below
    spawnTask: undefined,
  };

  // AskUserQuestion routes through canUseTool's existing approval bus —
  // the upstream handler calls handleAskUserQuestion which fills `answers`
  // in updatedInput. We adapt: when canUseTool returns an allow with
  // updatedInput, surface those answers to the model as the tool result.
  baseCtx.askUserQuestion = async () => {
    // The tool handler path is bypassed; canUseTool returns answers in
    // updatedInput. See the tool-call execution branch below.
    return {};
  };

  // Task spawning: run a fresh `query()` against the named subagent
  // definition with isolated context. Returns concatenated assistant text.
  baseCtx.spawnTask = async ({ subagent_type, prompt: subPrompt }, ctx) => {
    const def = ctx.agents?.[subagent_type];
    if (!def) return `Unknown subagent: ${subagent_type}`;
    let text = "";
    const subStream = queryStream(subPrompt, {
      ...options,
      systemPrompt: def.prompt,
      allowedTools: def.tools ?? options.allowedTools,
      maxTurns: 6,
      mcpServers: options.mcpServers, // subagents inherit MCP tools
      agents: undefined, // no recursive task spawning
      hooks: undefined, // subagents don't fire parent hooks
      canUseTool: undefined,
      // No resume — fresh session for the subagent.
      resume: undefined,
    });
    for await (const evt of subStream) {
      if (evt.type === "stream_event") {
        const ev = evt.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          text += ev.delta.text;
        }
      }
    }
    return text || "(subagent returned no output)";
  };

  try {
    while (turns < maxTurns) {
      turns++;

      const stream = streamChatCompletion({
        messages,
        tools: openAiTools.length > 0 ? openAiTools : undefined,
        abortSignal: options.abortController?.signal,
        maxCompletionTokens: 4096,
        responseFormat: options.outputFormat,
      });

      let textBuf = "";
      const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
      let streamError: string | null = null;
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

      for await (const evt of stream) {
        if (evt.kind === "text_delta") {
          textBuf += evt.text;
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: evt.text },
            },
          };
        } else if (evt.kind === "done") {
          toolCalls.push(...evt.toolCalls);
          usage = evt.usage;
        } else if (evt.kind === "error") {
          streamError = evt.message;
        }
      }

      if (usage) {
        costUsd +=
          (usage.promptTokens * COST_PER_1K_PROMPT) / 1000 +
          (usage.completionTokens * COST_PER_1K_COMPLETION) / 1000;
      }

      if (streamError) {
        stopSubtype = "error_during_execution";
        lastError = streamError;
        // Emit a partial assistant message with whatever text we got
        if (textBuf) {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: textBuf }],
            },
          };
        }
        break;
      }

      // Emit the assistant message (text + tool_use blocks). Push it onto the
      // messages array for the next turn so the model sees its own tool calls.
      const assistantContent: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      > = [];
      if (textBuf) assistantContent.push({ type: "text", text: textBuf });
      for (const call of toolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          input = { _raw: call.arguments };
        }
        assistantContent.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input,
        });
      }

      if (assistantContent.length > 0) {
        yield {
          type: "assistant",
          message: { role: "assistant", content: assistantContent },
        };
      }

      // Push the OpenAI-shaped assistant message so the next turn carries
      // the tool calls correctly.
      messages.push({
        role: "assistant",
        content: textBuf || null,
        tool_calls: toolCalls.length > 0
          ? toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: c.arguments || "{}" },
            }))
          : undefined,
      } as ChatCompletionMessageParam);

      if (textBuf) {
        recordSessionMessage(sessionId, { role: "assistant", content: textBuf });
      }

      if (toolCalls.length === 0) {
        break; // natural stop
      }

      // Budget check
      if (costUsd > maxBudget) {
        stopSubtype = "error_max_budget_usd";
        break;
      }

      // Execute each tool call sequentially. Hooks + canUseTool gate each one.
      const toolResultBlocks: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }> = [];

      for (const call of toolCalls) {
        let rawInput: Record<string, unknown> = {};
        try {
          rawInput = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          rawInput = { _raw: call.arguments };
        }
        let input: Record<string, unknown> = rawInput;
        let toolText = "";
        let toolError = false;

        const resolved = resolveTool(call.name);

        // 1. PreToolUse hooks
        const preInput: PreToolUseHookInput = {
          hook_event_name: "PreToolUse",
          tool_name: call.name,
          tool_input: input,
        };
        const preResults = await fireHooks(options.hooks, "PreToolUse", preInput);
        const preDecision = findFirstPreToolUseDecision(preResults);
        if (preDecision?.decision === "deny") {
          toolText = preDecision.reason ?? "Hook denied tool use.";
          toolError = true;
        } else {
          if (preDecision?.updatedInput) {
            input = preDecision.updatedInput;
          }
          // 2. canUseTool gate
          if (options.canUseTool && options.permissionMode !== "bypassPermissions") {
            try {
              const verdict: PermissionResult = await options.canUseTool(
                call.name,
                input
              );
              if (verdict.behavior === "deny") {
                toolText = verdict.message;
                toolError = true;
              } else if (verdict.updatedInput !== undefined) {
                input = verdict.updatedInput as Record<string, unknown>;
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              toolText = `Permission check failed: ${msg}`;
              toolError = true;
            }
          }
        }

        // 3. Execute the tool (if still allowed)
        const t0 = Date.now();
        if (!toolError) {
          if (!resolved) {
            toolText = `Unknown tool: ${call.name}`;
            toolError = true;
          } else if (resolved.kind === "builtin") {
            const def = BUILTIN_TOOLS[resolved.name as keyof typeof BUILTIN_TOOLS];
            const out = await def.handler(input, baseCtx);
            toolText = out.text;
            toolError = Boolean(out.isError);
          } else {
            // MCP tool
            const server = options.mcpServers?.[resolved.server];
            if (!server || server.type !== "sdk") {
              toolText = `MCP server ${resolved.server} is not in-process.`;
              toolError = true;
            } else {
              const sdk = server as McpSdkServerConfigWithInstance;
              const toolDef = sdk.instance.tools.find((t) => t.name === resolved.tool);
              if (!toolDef) {
                toolText = `MCP tool ${resolved.tool} not found.`;
                toolError = true;
              } else {
                try {
                  const result = await toolDef.handler(input);
                  toolText = result.content
                    .map((c) => (c.type === "text" ? c.text : `[image:${c.mimeType}]`))
                    .join("\n");
                  toolError = Boolean(result.isError);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  toolText = `MCP handler error: ${msg}`;
                  toolError = true;
                }
              }
            }
          }
        }

        const durationMs = Date.now() - t0;

        // 4. PostToolUse hooks
        const postInput: PostToolUseHookInput = {
          hook_event_name: "PostToolUse",
          tool_name: call.name,
          tool_input: input,
          tool_response: toolText,
          duration_ms: durationMs,
        };
        const postResults = await fireHooks(options.hooks, "PostToolUse", postInput);
        const additional = gatherPostAdditionalContext(postResults);
        if (additional) toolText = `${toolText}\n\n${additional}`;

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: toolText,
          is_error: toolError || undefined,
        });

        // Push the OpenAI-shaped tool message back into context for the next turn.
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolText,
        } as ChatCompletionMessageParam);
      }

      if (toolResultBlocks.length > 0) {
        yield {
          type: "user",
          message: {
            role: "user",
            content: toolResultBlocks,
          },
        };
      }

      if (costUsd > maxBudget) {
        stopSubtype = "error_max_budget_usd";
        break;
      }
    }

    if (turns >= maxTurns && stopSubtype === "success") {
      // Inspect the last assistant turn: if it ended with tool calls but we
      // ran out of turns, that's max_turns. If it ended naturally, success.
      const last = messages[messages.length - 1];
      if ((last as { tool_calls?: unknown[] }).tool_calls?.length) {
        stopSubtype = "error_max_turns";
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    stopSubtype = "error_during_execution";
  }

  // Fire Stop hook before yielding the result
  const stopInput: StopHookInput = {
    hook_event_name: "Stop",
    stop_hook_active: stopSubtype === "success",
  };
  await fireHooks(options.hooks, "Stop", stopInput);

  yield {
    type: "result",
    subtype: stopSubtype,
    num_turns: turns,
    total_cost_usd: Number(costUsd.toFixed(6)),
    is_error: stopSubtype === "error_during_execution",
    errors: lastError ? [lastError] : undefined,
  };
}

export type { AgentDefinition };
