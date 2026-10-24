import { access, readFile } from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ensureTwinSandbox, spawnClaudeCodeProcess } from "@/lib/twin-sandbox";

describe.skipIf(process.env.SRT_E2E !== "1")("twin sandbox macOS integration", () => {
  it("runs a signed-in Claude Code query without shell quoting loss and denies Claude settings writes", async () => {
    process.env.EMPLOYEE001_SANDBOX = "1";
    process.env.EMPLOYEE001_MODEL_PROVIDER = "claude-code";
    await ensureTwinSandbox("system");
    // Quotes, $' and a long string in argv (the system prompt), where a
    // shell-quoting bug would break the command line.
    const systemPrompt = `Quotes: '$' "$&" \`x\` $'tail'. ${"filler words ".repeat(1_500)}`;
    const prompt = "Reply with exactly: sandbox-ok";
    let result = "";
    const stream = query({
      prompt,
      options: {
        model: "claude-haiku-4-5",
        systemPrompt,
        // Outside any repository: a repo's .claude settings change what loads.
        cwd: os.tmpdir(),
        tools: [],
        allowedTools: [],
        maxTurns: 1,
        settingSources: [],
        pathToClaudeCodeExecutable: process.env.SRT_E2E_CLAUDE ?? "claude",
        spawnClaudeCodeProcess,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          E001_SANDBOX_SCOPE: "system",
        },
      },
    });
    for await (const message of stream) if (message.type === "result" && message.subtype === "success") result = message.result;
    expect(result).toContain("sandbox-ok");

    const settings = path.join(process.env.HOME!, ".claude", "settings.json");
    await access(settings).catch(() => undefined);
    const before = await readFile(settings, "utf8").catch(() => "");
    const writeResult = await new Promise<number | null>((resolve) => {
      const child = spawnClaudeCodeProcess({
        command: process.execPath,
        args: ["-e", `require("fs").writeFileSync(${JSON.stringify(settings)}, "sandbox-denied")`],
        env: { PATH: process.env.PATH, HOME: process.env.HOME, E001_SANDBOX_SCOPE: "system" },
        signal: new AbortController().signal,
      });
      child.on("exit", (code) => resolve(code));
    });
    expect(writeResult).not.toBe(0);
    expect(await readFile(settings, "utf8").catch(() => "")).toBe(before);
  }, 120_000);
});
