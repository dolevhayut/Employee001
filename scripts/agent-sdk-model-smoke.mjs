#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";

const models = process.argv.slice(2);
const targets = models.length > 0 ? models : ["claude-opus-5-5", "claude-fable-5-1"];

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required.");
  process.exit(1);
}

let failed = false;

for (const model of targets) {
  let result = null;
  try {
    for await (const message of query({
      prompt: "Reply with exactly: model smoke passed",
      options: {
        model,
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        settingSources: [],
        env: { ...process.env },
      },
    })) {
      if (message.type === "result") result = message;
    }
  } catch (error) {
    failed = true;
    console.error(`${model}: SDK invocation failed: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  if (result?.subtype === "success" && !result.is_error) {
    console.log(`${model}: ${result.result?.trim() || "model smoke passed"}`);
  } else {
    failed = true;
    console.error(`${model}: unexpected result: ${result?.subtype ?? "no result"}`);
  }
}

process.exit(failed ? 1 : 0);
