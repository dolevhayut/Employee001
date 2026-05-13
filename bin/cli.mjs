#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const HELP = `Employee001 — your company's organizational brain, running on your machine.

Usage:
  employee001 <command> [options]

Commands:
  setup     Interactive first-run wizard (writes .env, creates data/)
  start     Start the local server (binds to 127.0.0.1 by default)
  update    Check GitHub releases for a newer version
  doctor    Run a health check on your install
  help      Show this message

Common flags:
  --no-open       (start) Do not open browser
  --port <n>      (start) Override port (default 3000)

Docs: https://github.com/dolevhayut/Employee001
`;

const KNOWN = new Set(["setup", "start", "update", "doctor", "help"]);

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }

  if (!KNOWN.has(cmd)) {
    process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  // If the user runs `start` without ever having run `setup`, kick into setup first.
  if (cmd === "start" && !existsSync(resolve(process.cwd(), ".env"))) {
    process.stdout.write(
      "\nNo .env found in the current directory. Running setup first…\n\n",
    );
    const setup = await import(join(HERE, "commands", "setup.mjs"));
    await setup.default([]);
  }

  const mod = await import(join(HERE, "commands", `${cmd}.mjs`));
  await mod.default(args);
}

main().catch((err) => {
  process.stderr.write(`\nerror: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
