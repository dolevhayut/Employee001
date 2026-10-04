import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkNodeVersion } from "../lib/node-version.mjs";
import { adoptData } from "../lib/adopt-data.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// bin/commands/start.mjs → ../../  is the package root
const PKG_ROOT = resolve(HERE, "..", "..");

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function openInBrowser(url) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // ignore — user can open manually
  }
}

export function buildChildEnv({ home, port, bind, env = {}, strict = false, inheritEnv = true }) {
  const childEnv = {
    ...(inheritEnv ? process.env : {}),
    ...env,
    EMPLOYEE001_HOME: resolve(home),
    HOSTNAME: bind,
    PORT: String(port),
    NODE_ENV: "production",
  };
  if (strict) childEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return childEnv;
}

export function launchServer({ home, port, bind, env = {}, open = "/", noOpen = false, strict = false, inheritEnv = true }) {
  const absoluteHome = resolve(home);
  const serverScript = join(PKG_ROOT, ".next", "standalone", "server.js");
  if (!existsSync(serverScript)) {
    process.stderr.write(
      `Could not find ${serverScript}\n` +
        "Build artifact is missing. If you're developing locally, run `npm run build` first.\n",
    );
    process.exitCode = 1;
    return null;
  }

  const childEnv = buildChildEnv({ home: absoluteHome, port, bind, env, strict, inheritEnv });
  const adoption = adoptData({ home: absoluteHome, pkgRoot: PKG_ROOT, env: childEnv });
  if (adoption.warning) {
    process.stderr.write(`Warning: could not check earlier install data: ${adoption.warning.message ?? adoption.warning}\n`);
  }
  if (adoption.adopted) {
    process.stdout.write(
      `Found your twins from an earlier install at ${adoption.source} and copied them to ${adoption.target} (the old copy is untouched).\n`,
    );
  }

  const isLoopback =
    !bind || bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
  const token = env.EMPLOYEE001_TOKEN ?? process.env.EMPLOYEE001_TOKEN;

  const banner = ["", "  Employee001", `  → http://localhost:${port}`];
  if (isLoopback) {
    banner.push(`  Bound to ${bind} — not reachable from your network.`);
  } else {
    banner.push(`  Bound to ${bind} — exposed on your network. Use a firewall or Tailscale.`);
    if (token) {
      banner.push("");
      banner.push("  Access requires a token. From another device on your LAN:");
      banner.push(`    http://<this-machine>:${port}/?token=${token}`);
      banner.push("  (the token is then set as a cookie for 30 days)");
    } else {
      banner.push("");
      banner.push("  WARNING: EMPLOYEE001_TOKEN is not set. The proxy will refuse every");
      banner.push("  request until you set one. Re-run `employee001 setup`.");
    }
  }
  if (strict) {
    banner.push("  Strict: nonessential traffic disabled (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1).");
  }
  banner.push("");
  banner.push("  Press Ctrl+C to stop.");
  banner.push("");
  process.stdout.write(banner.join("\n"));

  const child = spawn(process.execPath, [serverScript], {
    cwd: dirname(serverScript),
    env: childEnv,
    stdio: "inherit",
  });

  let opened = false;
  setTimeout(() => {
    if (!noOpen && !opened) {
      openInBrowser(`http://localhost:${port}${open}`);
      opened = true;
    }
  }, 1500);

  const forward = (sig) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
  return child;
}

export default async function start(argv) {
  const nodeVersion = checkNodeVersion();
  if (nodeVersion.level === "error") {
    process.stderr.write(`${nodeVersion.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (nodeVersion.level === "warn") process.stderr.write(`${nodeVersion.message}\n`);

  const cwd = process.cwd();
  const envPath = resolve(cwd, ".env");

  if (!existsSync(envPath)) {
    process.stderr.write(
      "No .env found. Run `employee001 setup` first.\n",
    );
    process.exitCode = 1;
    return;
  }

  const fileEnv = parseEnv(readFileSync(envPath, "utf8"));

  const noOpen = argv.includes("--no-open");
  const strict = argv.includes("--strict");
  const portFlagIdx = argv.indexOf("--port");
  const portArg = portFlagIdx >= 0 ? argv[portFlagIdx + 1] : undefined;

  const port = portArg ?? fileEnv.PORT ?? process.env.PORT ?? "3000";
  const bind = fileEnv.EMPLOYEE001_BIND ?? process.env.EMPLOYEE001_BIND ?? "127.0.0.1";

  launchServer({ home: cwd, port, bind, env: fileEnv, noOpen, strict });
}
