#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const HELP = `Employee001 — your company's organizational brain, running on your machine.

Usage:
  employee001 [command] [options]      (no command = start)

Get started:
  demo      Try Employee001 with 6 invented twins — no keys, nothing touches your files
  setup     Interactive first-run wizard for your own team (writes .env, creates data/)
  start     Start the local server (runs setup first if there's no .env)

More commands:
  update    Check GitHub releases for a newer version
  doctor    Run a health check on your install
  secure    Move plaintext .env secrets into your OS keychain
  export    Snapshot data/ to a tar.gz archive (excludes .env)
  import    Restore data/ from a tar.gz archive
  mcp       Connect Claude Code, Cursor and other MCP clients (stdio bridge to the running app)
  login     Sign in to the running app as yourself for MCP clients (approve a code in the browser)
  audit     Verify the audit log's hash chain (audit verify [exported-file])
  help      Show this message

Common flags:
  --no-open       (start) Do not open browser
  --port <n>      (start) Override port (default 3000)
  --live          (demo) Pass your model-provider environment through
  --keep          (demo) Keep the temporary demo data after stopping
  --strict        (start) Disable nonessential outbound traffic
                  (sets CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1)
  --egress        (doctor) After the health checks, list every outbound host
  --force         (import) Overwrite a non-empty data/ directory
  --encrypt       (export) Encrypt the archive with a passphrase
  --url <u>       (mcp) MCP endpoint (default $EMPLOYEE001_MCP_URL, else
                  http://127.0.0.1:<PORT>/api/mcp)
  --token <t>     (mcp) Bearer token (default $EMPLOYEE001_MCP_TOKEN, else
                  $EMPLOYEE001_TOKEN, else the same keys in ./.env)

Environment:
  EMPLOYEE001_HOME  Install folder (.env and data/). Default: the current folder.

Examples:
  employee001 demo
  employee001 export ~/Desktop/e001-backup.tar.gz
  employee001 import ~/Desktop/e001-backup.tar.gz

Docs: https://github.com/dolevhayut/Employee001
`;

const HOME_COMMANDS = new Set(["setup", "start", "doctor", "secure", "mcp", "login"]);

const KNOWN = new Set(["setup", "start", "update", "doctor", "secure", "export", "import", "mcp", "login", "audit", "demo", "help"]);

async function main() {
  // No command (or only flags, like `--port 4000`) starts the app, running
  // setup first in a folder without .env: `npx employee001` is the whole install.
  const first = process.argv[2];
  const cmd = !first || (first.startsWith("-") && first !== "--help" && first !== "-h") ? "start" : first;
  const args = cmd === first ? process.argv.slice(3) : process.argv.slice(2);

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }

  if (!KNOWN.has(cmd)) {
    process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  // EMPLOYEE001_HOME picks the install folder (.env + data/), as it already
  // does for export, import and audit. These commands work on the current
  // folder, so move there; path arguments of other commands stay relative to
  // where the user typed them.
  if (process.env.EMPLOYEE001_HOME && HOME_COMMANDS.has(cmd)) {
    const home = resolve(process.env.EMPLOYEE001_HOME);
    if (cmd === "setup" || cmd === "start") mkdirSync(home, { recursive: true });
    process.chdir(home);
  }

  // If the user runs `start` without ever having run `setup`, kick into setup
  // first. Setup doesn't launch the server itself here, so it boots once.
  if (cmd === "start" && !existsSync(resolve(process.cwd(), ".env"))) {
    process.stdout.write(
      `\nNo .env found in ${process.cwd()}. Running setup first…\n\n`,
    );
    const setup = await import(join(HERE, "commands", "setup.mjs"));
    const configured = await setup.default([], { launch: false });
    if (!configured) return;
  }

  const mod = await import(join(HERE, "commands", `${cmd}.mjs`));
  await mod.default(args);
}

main().catch((err) => {
  process.stderr.write(`\nerror: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
