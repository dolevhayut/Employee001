import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createBridge } from "../lib/mcp-bridge.mjs";

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function localEnv() {
  const envPath = resolve(process.cwd(), ".env");
  return existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
}

function defaultUrl(env) {
  return `http://127.0.0.1:${env.PORT ?? "3000"}/api/mcp`;
}

export default async function mcp(argv) {
  const urlIndex = argv.indexOf("--url");
  if (urlIndex >= 0 && !argv[urlIndex + 1]) {
    process.stderr.write("Missing value for --url\n");
    process.exitCode = 1;
    return;
  }
  const tokenIndex = argv.indexOf("--token");
  if (tokenIndex >= 0 && !argv[tokenIndex + 1]) {
    process.stderr.write("Missing value for --token\n");
    process.exitCode = 1;
    return;
  }

  const env = localEnv();
  const url = urlIndex >= 0 ? argv[urlIndex + 1] : defaultUrl(env);
  const token = tokenIndex >= 0 ? argv[tokenIndex + 1] : env.EMPLOYEE001_TOKEN;
  const bridge = createBridge({
    url,
    token,
    write: (line) => process.stdout.write(line),
    log: (message) => process.stderr.write(`${message}\n`),
  });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  // Handle requests concurrently: a slow ask_twin must not block pings or
  // other tool calls. JSON-RPC replies are matched by id, not order.
  const pending = new Set();
  for await (const line of input) {
    const task = bridge.handleLine(line).finally(() => pending.delete(task));
    pending.add(task);
  }
  await Promise.all(pending);
}
