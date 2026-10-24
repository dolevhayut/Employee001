// One model turn for Relay (the handover interviewer and the package
// synthesis), through the Agent SDK so it uses whatever model provider the
// workspace is set up for (Anthropic, Bedrock, Vertex, Foundry, local) and
// honours EU residency. No tools of any kind: built-ins are switched off,
// there are no MCP servers, and anything that still asks is denied.

import "server-only";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildBaseOptions } from "@/lib/sdk-defaults";
import { canRunModel, modelErrorMessage, modelForProvider } from "@/lib/model-provider";
import { ensureTwinSandbox } from "@/lib/twin-sandbox";

let spentUsd = 0;
/** What Relay model calls have cost in this process (the eval reports it). */
export const relaySpentUsd = () => spentUsd;

export function relayModelReady(): { ok: true } | { ok: false; reason: string } {
  return canRunModel();
}

export async function relayTurn(args: {
  employeeId: string;
  model: string;
  system: string;
  prompt: string;
  onDelta?: (text: string) => void;
}): Promise<string> {
  const ready = canRunModel();
  if (!ready.ok) throw new Error(ready.reason);

  const runId = `relay_${args.employeeId}_${Date.now()}`;
  await ensureTwinSandbox(`relay:${args.employeeId}`);
  const stream = query({
    prompt: args.prompt,
    options: {
      ...buildBaseOptions({ surface: "relay", runId, employeeId: args.employeeId }),
      model: modelForProvider(args.model),
      systemPrompt: args.system,
      tools: [],
      allowedTools: [],
      mcpServers: {},
      maxTurns: 1,
      includePartialMessages: Boolean(args.onDelta),
      permissionMode: "default",
      canUseTool: async () => ({ behavior: "deny", message: "Relay runs have no tools." }),
      settingSources: [],
      persistSession: false,
    },
  });

  let streamed = "";
  let result = "";
  for await (const m of stream) {
    if (m.type === "stream_event" && args.onDelta) {
      const e = m.event;
      if (e.type === "content_block_delta" && e.delta.type === "text_delta" && e.delta.text) {
        streamed += e.delta.text;
        args.onDelta(e.delta.text);
      }
    } else if (m.type === "result") {
      if (typeof m.total_cost_usd === "number") spentUsd += m.total_cost_usd;
      if (m.subtype === "success") result = m.result;
      else throw new Error(modelErrorMessage(`Relay model run ended: ${m.subtype}`));
    }
  }
  return (result || streamed).trim();
}
