import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

export default async function start(argv) {
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
  const portFlagIdx = argv.indexOf("--port");
  const portArg = portFlagIdx >= 0 ? argv[portFlagIdx + 1] : undefined;

  const port = portArg ?? fileEnv.PORT ?? process.env.PORT ?? "3000";
  const bind = fileEnv.EMPLOYEE001_BIND ?? process.env.EMPLOYEE001_BIND ?? "127.0.0.1";

  const serverScript = join(PKG_ROOT, ".next", "standalone", "server.js");
  if (!existsSync(serverScript)) {
    process.stderr.write(
      `Could not find ${serverScript}\n` +
        "Build artifact is missing. If you're developing locally, run `npm run build` first.\n",
    );
    process.exitCode = 1;
    return;
  }

  const childEnv = {
    ...process.env,
    ...fileEnv,
    HOSTNAME: bind,
    PORT: String(port),
    NODE_ENV: "production",
  };

  const isLoopback =
    !bind || bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
  const token = fileEnv.EMPLOYEE001_TOKEN ?? process.env.EMPLOYEE001_TOKEN;

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
      openInBrowser(`http://localhost:${port}`);
      opened = true;
    }
  }, 1500);

  const forward = (sig) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
